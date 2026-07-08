import { invoke } from '@tauri-apps/api/core'
import { CodexAppServerClient } from './api'
import { TauriCodexProcessSpawner } from './tauri-process'
import { getConfigLeaseRegistry } from './config-lease'
import type { CodexInitializeResult, CodexSessionOptions } from './types'

export const GLOBAL_CODEX_APP_SERVER_SESSION_ID = 'Parlo-global-codex-app-server'

/** Error code / message for in-flight turns aborted by process restart (KD25). */
export const CODEX_RESTART_ERROR =
  'Codex app-server restarted; regenerate the last message to continue.'

type GlobalCodexRuntimeState = {
  client: CodexAppServerClient
  processSignature: string
  initPromise: Promise<CodexInitializeResult>
  lastConfigHash?: string
}

let globalRuntime: GlobalCodexRuntimeState | null = null
const threadRuntimeSignatures = new Map<string, string>()

/**
 * Single exclusive chain for write/reload/spawn/shutdown (DESIGN_CODEX_HOST §3.2.1).
 * Replaces dual ensureChain + unguarded apply.
 */
let runtimeMutationChain: Promise<unknown> = Promise.resolve()

/** Active turn abort controllers — aborted before process restart. */
const activeTurnControllers = new Map<string, AbortController>()

export function buildCodexProcessSignature(options: CodexSessionOptions): string {
  // The Codex app-server reads provider env vars from its process environment.
  // If the selected chat/provider changes from Parlo Gateway to xAI/OpenAI/etc, or
  // if an OAuth/API key is refreshed, reloading config.toml is not enough: the
  // running process will still be missing the env value referenced by env_key.
  // Keep the secret value redacted, but include a stable hash so changes restart
  // the process with the correct environment.
  return JSON.stringify({
    codexBinaryPath: options.codexBinaryPath,
    codexHome: options.codexHome,
    transport: options.transport,
    env: redactedEnvSignature(options.env),
    agentsMd: options.agentsMd,
    customAgents: options.customAgents,
  })
}

function redactedEnvSignature(env: CodexSessionOptions['env']) {
  return Object.fromEntries(
    Object.entries(env ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        {
          length: value.length,
          hash: hashEnvValue(value),
        },
      ])
  )
}

function hashEnvValue(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function buildCodexRuntimeSignature(options: CodexSessionOptions): string {
  return JSON.stringify({
    cwd: options.cwd,
    model: options.model,
    modelProvider: options.modelProvider,
    approvalPolicy: options.approvalPolicy,
    sandbox: options.sandbox,
    configToml: options.configToml,
    mcpRefreshConfig: options.mcpRefreshConfig,
    subagentMaxThreads: options.subagentMaxThreads,
    subagentMaxDepth: options.subagentMaxDepth,
    permissionProfile: options.permissionProfile,
    addDirs: options.addDirs,
    advancedConfigSnippet: options.advancedConfigSnippet,
  })
}

export function getGlobalCodexClientOrNull(): CodexAppServerClient | null {
  return globalRuntime?.client ?? null
}

/**
 * Run exclusive runtime mutation (spawn, config write, reload, shutdown).
 */
export function runExclusiveRuntimeMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = runtimeMutationChain.then(fn, fn)
  runtimeMutationChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function registerActiveTurnController(
  threadId: string,
  controller: AbortController
): void {
  activeTurnControllers.set(threadId, controller)
  getConfigLeaseRegistry().markActiveTurn(threadId, true)
}

export function clearActiveTurnController(threadId: string): void {
  activeTurnControllers.delete(threadId)
  getConfigLeaseRegistry().markActiveTurn(threadId, false)
}

async function failInflightTurnsBeforeRestart(): Promise<void> {
  for (const [threadId, controller] of activeTurnControllers) {
    try {
      controller.abort(CODEX_RESTART_ERROR)
    } catch {
      // ignore
    }
    const client = globalRuntime?.client
    if (client) {
      await client.interruptTurn(threadId).catch(() => {})
    }
  }
  activeTurnControllers.clear()
}

async function ensureGlobalCodexAppServerInternal(
  spawnOptions: CodexSessionOptions
): Promise<CodexAppServerClient> {
  const processSignature = buildCodexProcessSignature(spawnOptions)

  if (globalRuntime?.processSignature === processSignature) {
    try {
      await globalRuntime.initPromise
    } catch (error) {
      globalRuntime = null
      threadRuntimeSignatures.clear()
      throw error
    }
    if (globalRuntime.client.isRunning()) {
      return globalRuntime.client
    }
    await failInflightTurnsBeforeRestart()
    await globalRuntime.client.shutdownCodex().catch(() => {})
    globalRuntime = null
    threadRuntimeSignatures.clear()
  }

  if (globalRuntime) {
    await failInflightTurnsBeforeRestart()
    await globalRuntime.client.shutdownCodex()
    globalRuntime = null
    threadRuntimeSignatures.clear()
  }

  const client = new CodexAppServerClient({
    spawner: new TauriCodexProcessSpawner({
      sessionIdFactory: () => GLOBAL_CODEX_APP_SERVER_SESSION_ID,
    }),
    options: spawnOptions,
  })

  const initPromise = client.startCodexSession()
  globalRuntime = {
    client,
    processSignature,
    initPromise,
  }

  await initPromise
  return client
}

export async function ensureGlobalCodexAppServer(
  spawnOptions: CodexSessionOptions
): Promise<CodexAppServerClient> {
  return runExclusiveRuntimeMutation(() =>
    ensureGlobalCodexAppServerInternal(spawnOptions)
  )
}

export async function applyCodexRuntimeOptions(
  client: CodexAppServerClient,
  threadId: string,
  options: CodexSessionOptions
): Promise<void> {
  const runtimeSignature = buildCodexRuntimeSignature(options)
  if (threadRuntimeSignatures.get(threadId) === runtimeSignature) return

  await runExclusiveRuntimeMutation(async () => {
    // Re-check after waiting for the chain — another apply may have landed.
    if (threadRuntimeSignatures.get(threadId) === runtimeSignature) return
    await writeCodexConfigToDisk(options)
    await client.refreshMcpServers().catch(() => {})
    await client.reloadUserConfig().catch(() => {})
    threadRuntimeSignatures.set(threadId, runtimeSignature)
  })
}

/**
 * Apply lease config + ensure process under a single exclusive mutation.
 */
export async function applyLeaseAndEnsureProcess(
  threadId: string,
  options: CodexSessionOptions
): Promise<CodexAppServerClient> {
  return runExclusiveRuntimeMutation(async () => {
    const client = await ensureGlobalCodexAppServerInternal(options)
    const runtimeSignature = buildCodexRuntimeSignature(options)
    if (threadRuntimeSignatures.get(threadId) !== runtimeSignature) {
      await writeCodexConfigToDisk(options)
      await client.refreshMcpServers().catch(() => {})
      await client.reloadUserConfig().catch(() => {})
      threadRuntimeSignatures.set(threadId, runtimeSignature)
    }
    return client
  })
}

export async function shutdownGlobalCodexAppServer(): Promise<void> {
  await runExclusiveRuntimeMutation(async () => {
    if (!globalRuntime) return
    await failInflightTurnsBeforeRestart()
    await globalRuntime.client.shutdownCodex()
    globalRuntime = null
    threadRuntimeSignatures.clear()
  })
}

export function clearGlobalCodexThreadBinding(threadId: string): void {
  threadRuntimeSignatures.delete(threadId)
  clearActiveTurnController(threadId)
  getConfigLeaseRegistry().release(threadId)
  globalRuntime?.client.clearThreadBinding(threadId)
}

export function resetGlobalCodexRuntimeForTests(): void {
  globalRuntime = null
  threadRuntimeSignatures.clear()
  activeTurnControllers.clear()
  runtimeMutationChain = Promise.resolve()
}

async function writeCodexConfigToDisk(options: CodexSessionOptions) {
  if (!options.codexHome) return

  await invoke('write_codex_app_server_config', {
    codexHome: options.codexHome,
    configToml: options.configToml ?? '',
    agentsMd: options.agentsMd ?? null,
    customAgents: options.customAgents
      ? JSON.stringify(options.customAgents)
      : null,
  })
}
