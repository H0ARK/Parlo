import type { UIMessage } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import { invoke } from '@tauri-apps/api/core'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useWorkspaceDirectories } from '@/stores/workspace-directory-store'
import { useCodexProviderProfiles } from '@/stores/codex-provider-profile-store'
import { useCodexAppServerRuntime } from '@/stores/codex-app-server-runtime-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  buildCodexSessionOptions as buildCodexSessionOptionsLegacy,
  buildRouteAndPolicy,
  buildSessionPolicy,
  buildModelRoute,
  CODEX_APP_SERVER_PROVIDER_ID as CODEX_PROVIDER_ID,
  CODEX_FALLBACK_MODEL_ID,
  defaultCodexBinaryPath,
  PARLO_HOSTED_LOCAL_PROVIDERS,
  resolveAppCodexHome,
  resolveCodexStartupModel,
  resolveCodexTargetProvider,
  resolveCodexAuthProvider,
  resolveCodexProviderApiKey,
  resolveCodexWorkspaceDir,
  type BuildCodexSessionOptionsOverrides,
} from './model-route'
import {
  applyLeaseAndBuildSessionOptions,
  getConfigLeaseRegistry,
} from './config-lease'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'
import { buildCodexMcpServersConfig } from './mcp-config-bridge'
import type {
  CodexAppServerClient,
  CodexCommandExecParams,
  CodexFileSystemCopyParams,
  CodexFileSystemRemoveParams,
  CodexMcpToolCallParams,
  CodexProcessSpawnParams,
} from './api'
import { CODEX_APP_SERVER_METHOD_FALLBACKS } from './method-aliases'
import {
  GLOBAL_CODEX_APP_SERVER_SESSION_ID,
  applyCodexRuntimeOptions,
  clearGlobalCodexThreadBinding,
  ensureGlobalCodexAppServer,
  getGlobalCodexClientOrNull,
  resetGlobalCodexRuntimeForTests,
  shutdownGlobalCodexAppServer,
} from './global-codex-runtime'
import {
  persistCodexThreadId,
  readPersistedCodexThreadId,
} from './codex-thread-persistence'
import { codexEventsToUIMessageStream } from './ui-stream'
import {
  type CodexUserInputQuestion,
  useCodexUserInput,
} from '@/stores/codex-user-input-store'
import type {
  CodexAppServerEvent,
  CodexSessionOptions,
  CodexWireServerRequest,
} from './types'

export const CODEX_APP_SERVER_PROVIDER_ID = CODEX_PROVIDER_ID

type CodexChatBackendRequest = {
  threadId: string
  messageId?: string
  messages: UIMessage[]
  provider: ModelProvider
  model: Model
  abortSignal?: AbortSignal
}

const GLOBAL_CODEX_THREAD_PLACEHOLDER = '__global__'

const CODEX_NOT_RUNNING_ERROR =
  'Codex app-server is not running yet. Wait for app startup to finish.'

export const isCodexAppServerProvider = (providerId: string | undefined) =>
  providerId === CODEX_APP_SERVER_PROVIDER_ID

export type { BuildCodexSessionOptionsOverrides }

/**
 * Build Codex session options, registering a ConfigLease and applying
 * multi-provider / union-env flags when enabled (defaults = legacy single route).
 */
export function buildCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model,
  overrides: BuildCodexSessionOptionsOverrides = {}
): CodexSessionOptions {
  const { route, policy } = buildRouteAndPolicy(provider, model, overrides)
  const flags = useCodexHostFlags.getState()

  getConfigLeaseRegistry().upsert({
    threadId,
    route,
    policy,
    activeTurn: false,
  })

  if (flags.perProviderEnvKeys || flags.multiProviderMerge) {
    const { mcpServers, settings } = useMCPServers.getState()
    return applyLeaseAndBuildSessionOptions(threadId, route, policy, {
      unionEnv: flags.perProviderEnvKeys,
      multiProviderMerge: flags.multiProviderMerge,
      mcpServers,
      mcpToolTimeoutSeconds: settings.toolCallTimeoutSeconds,
    })
  }

  return buildCodexSessionOptionsLegacy(threadId, provider, model, overrides)
}

export async function resolveCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model,
  overrides: BuildCodexSessionOptionsOverrides = {}
): Promise<CodexSessionOptions> {
  const modelProviderState = useModelProvider.getState()
  const activeProfileId = useCodexProviderProfiles.getState().activeProfileId
  const activeProfile = activeProfileId
    ? useCodexProviderProfiles.getState().profiles[activeProfileId]
    : undefined
  if (provider.provider === CODEX_APP_SERVER_PROVIDER_ID && !activeProfile) {
    return buildCodexSessionOptions(threadId, provider, model, overrides)
  }
  const targetProvider = resolveCodexTargetProvider(
    provider,
    model,
    activeProfile
  )
  const authProvider = resolveCodexAuthProvider(
    targetProvider,
    provider,
    modelProviderState
  )
  const apiKey =
    overrides.apiKeyOverride ??
    (await resolveCodexProviderApiKey(authProvider))
  return buildCodexSessionOptions(threadId, provider, model, {
    ...overrides,
    apiKeyOverride: apiKey,
    targetProvider,
    activeProfile,
  })
}

export { buildModelRoute, buildSessionPolicy, resolveCodexStartupModel }

export async function sendCodexAppServerChatMessage({
  threadId,
  messageId,
  messages,
  provider,
  model,
  abortSignal,
}: CodexChatBackendRequest): Promise<ReadableStream<UIMessageChunk>> {
  const { text: messageText, images } =
    extractLatestUserTextAndImagesForCodex(messages)
  if (!messageText && images.length === 0) {
    throw new Error('Cannot send an empty message to Codex app-server.')
  }

  // Validate that the workspace directory exists before spawning
  const cwd = resolveCodexWorkspaceDir(threadId)
  if (cwd && cwd !== './') {
    const exists = await invoke<boolean>('exists_sync', { args: [cwd] }).catch(
      () => false
    )
    if (!exists) {
      throw new Error(
        `Workspace directory does not exist: "${cwd}". Please select a valid folder in the workspace bar below the chat input or link a valid project.`
      )
    }
  }

  const resolvedModel = resolveCodexStartupModel(provider, model)

  await ensureCodexTargetProviderReady(threadId, provider, resolvedModel)

  const client = await prepareThreadCodexRuntime(threadId, provider, resolvedModel)
  const events = bridgeCodexApprovalRequests(
    client.sendToCodex(threadId, messageText, {
      clientUserMessageId: messageId,
      images,
    }),
    client,
    threadId
  )

  let removeAbortListener: (() => void) | undefined
  if (abortSignal?.aborted) {
    await client.interruptTurn(threadId)
  } else if (abortSignal) {
    const interruptOnAbort = () => {
      void client.interruptTurn(threadId)
    }
    abortSignal.addEventListener('abort', interruptOnAbort, { once: true })
    removeAbortListener = () => {
      abortSignal.removeEventListener('abort', interruptOnAbort)
    }
  }

  return withCodexStreamCleanup(
    codexEventsToUIMessageStream(events, {
      messageId,
      interrupt: async () => {
        await client.interruptTurn(threadId)
      },
    }),
    threadId,
    removeAbortListener
  )
}

export function approveCodexAppServerAction(
  threadId: string,
  requestId: string | number,
  decision: {
    approved: boolean
    rememberForSession?: boolean
    method?: string
    params?: Record<string, unknown>
    availableDecisions?: unknown[]
  }
) {
  const client = requireCodexSession(threadId)
  const params = {
    ...(decision.params ?? {}),
    ...(decision.availableDecisions
      ? { availableDecisions: decision.availableDecisions }
      : {}),
  }
  const request = {
    id: requestId,
    method: decision.method ?? 'item/commandExecution/requestApproval',
    ...(Object.keys(params).length ? { params } : {}),
  }
  client.approveAction(
    requestId,
    codexApprovalResponse(
      request,
      decision.approved,
      decision.rememberForSession
    )
  )
}

export async function shutdownCodexAppServerChatSession(threadId: string) {
  clearGlobalCodexThreadBinding(threadId)
}

async function ensureCodexTargetProviderReady(
  threadId: string,
  provider: ModelProvider,
  model: Model
) {
  if (!PARLO_HOSTED_LOCAL_PROVIDERS.has(provider.provider)) return

  const appState = useAppState.getState()
  const serviceHub = getServiceHub()
  const localApi = useLocalApiServer.getState()

  appState.updateLoadingModel(true)
  appState.updateThreadLoadingModel(threadId, true)
  try {
    await serviceHub.models().startModel(provider, model.id, true)

    appState.setServerStatus('pending')
    const { ensureLocalApiServerRunning } = await import(
      '@/lib/ensure-local-api-server'
    )
    await ensureLocalApiServerRunning({
      host: localApi.serverHost,
      port: localApi.serverPort,
      prefix: localApi.apiPrefix,
      apiKey: localApi.apiKey,
      trustedHosts: localApi.trustedHosts,
      isCorsEnabled: localApi.corsEnabled,
      isVerboseEnabled: localApi.verboseLogs,
      proxyTimeout: localApi.proxyTimeout,
    })
    appState.setServerStatus('running')
  } catch (error) {
    appState.setServerStatus('stopped')
    throw new Error(
      `Failed to prepare local provider for Codex: ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`
    )
  } finally {
    appState.updateLoadingModel(false)
    appState.updateThreadLoadingModel(threadId, false)
  }
}

function requireCodexClient(): CodexAppServerClient {
  const client = getGlobalCodexClientOrNull()
  if (!client) {
    throw new Error(CODEX_NOT_RUNNING_ERROR)
  }
  return client
}

function requireCodexSession(parloThreadId: string) {
  void parloThreadId
  return requireCodexClient()
}

async function prepareThreadCodexRuntime(
  threadId: string,
  provider: ModelProvider,
  model: Model,
  runtimeOverrides: { cwd?: string } = {}
): Promise<CodexAppServerClient> {
  const resolvedOptions = await resolveCodexSessionOptions(threadId, provider, model)
  const options = {
    ...resolvedOptions,
    ...(runtimeOverrides.cwd ? { cwd: runtimeOverrides.cwd } : {}),
  }
  const spawnOptions = toGlobalSpawnOptions(options)
  const client = await ensureGlobalCodexAppServer(spawnOptions)
  client.setThreadOptions(threadId, options)

  const persistedCodexThreadId = readPersistedCodexThreadId(threadId)
  if (persistedCodexThreadId) {
    client.seedCodexThreadBinding(threadId, persistedCodexThreadId)
  }

  await applyCodexRuntimeOptions(client, threadId, spawnOptions)
  return client
}

function toGlobalSpawnOptions(options: CodexSessionOptions): CodexSessionOptions {
  return {
    ...options,
    codexHome: resolveAppCodexHome(),
    cwd: './',
  }
}

export function buildGlobalCodexSpawnOptions(): CodexSessionOptions {
  const modelProviderState = useModelProvider.getState()
  const provider = modelProviderState.getProviderByName(CODEX_APP_SERVER_PROVIDER_ID)
  const selectedModel =
    provider?.models.find((candidate) => candidate.id === CODEX_FALLBACK_MODEL_ID) ??
    provider?.models.find((candidate) => candidate.active) ??
    provider?.models[0] ??
    { id: CODEX_FALLBACK_MODEL_ID }

  if (provider) {
    return toGlobalSpawnOptions(
      buildCodexSessionOptions(
        GLOBAL_CODEX_THREAD_PLACEHOLDER,
        provider,
        selectedModel
      )
    )
  }

  // No registered codex provider: still project gateway defaults for bootstrap.
  const bootstrapProvider: ModelProvider = {
    active: true,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    settings: [],
    models: [selectedModel],
    persist: true,
  }
  return toGlobalSpawnOptions(
    buildCodexSessionOptions(
      GLOBAL_CODEX_THREAD_PLACEHOLDER,
      bootstrapProvider,
      selectedModel
    )
  )
}

export async function compactCodexThread(parloThreadId: string) {
  return requireCodexSession(parloThreadId).compactThread(parloThreadId)
}

export async function interruptCodexTurn(parloThreadId: string) {
  return requireCodexSession(parloThreadId).interruptTurn(parloThreadId)
}

export async function rollbackCodexThread(parloThreadId: string, numTurns = 1) {
  return requireCodexSession(parloThreadId).rollbackThread(parloThreadId, numTurns)
}

export async function reloadCodexUserConfig(parloThreadId: string) {
  return requireCodexSession(parloThreadId).reloadUserConfig()
}

export async function refreshCodexMcpServers(parloThreadId: string) {
  return requireCodexSession(parloThreadId).refreshMcpServers()
}

async function* bridgeCodexApprovalRequests(
  events: AsyncIterable<CodexAppServerEvent>,
  client: CodexAppServerClient,
  threadId: string
): AsyncGenerator<CodexAppServerEvent> {
  for await (const event of events) {
    if (event.type === 'error' && isMissingCodexProviderEnvError(event.error)) {
      await shutdownGlobalCodexAppServer().catch(() => {})
      clearGlobalCodexThreadBinding(threadId)
      yield {
        type: 'error',
        error: new Error(
          'Codex provider credentials were missing from the running app-server. The Codex session was reset; regenerate to start with the current provider credentials.'
        ),
      }
      continue
    }

    if (event.type === 'thread_started' && event.threadId) {
      persistCodexThreadId(threadId, event.threadId)
    }

    yield event

    if (event.type === 'approval_request') {
      const approved = await requestCodexApproval(event.request, threadId)
      client.approveAction(
        event.request.id,
        codexApprovalResponse(event.request, approved, false)
      )
      continue
    }

    if (event.type === 'server_request') {
      const response = await resolveServerRequest(event.request)
      if (response !== undefined) {
        client.approveAction(event.request.id, response)
      }
    }
  }
}

function isMissingCodexProviderEnvError(error: Error) {
  return /Missing environment variable:\s*`?PARLO_CODEX_PROVIDER_API_KEY`?/i.test(
    error.message
  )
}

async function requestCodexApproval(
  request: CodexWireServerRequest,
  threadId: string
) {
  const details = codexApprovalDetails(request)
  const params = isRecord(request.params) ? request.params : {}
  const codexThreadId =
    stringValue(params.threadId) || stringValue((request as { threadId?: unknown }).threadId)
  return useRuntimePermission.getState().requestPermission({
    actionId: details.actionId,
    actionLabel: details.toolName,
    category: details.category,
    resourceLabel: details.resourceLabel,
    risk: details.risk,
    rememberKey: details.rememberKey,
    details: {
      parloThreadId: threadId,
      threadId,
      ...(codexThreadId ? { codexThreadId } : {}),
      ...(codexThreadId && codexThreadId !== threadId
        ? { source: 'subagent' as const }
        : {}),
      requestId: request.id,
      method: request.method,
      ...(Object.keys(params).length ? { requestParams: params } : {}),
      ...(Array.isArray(params.availableDecisions)
        ? { availableDecisions: params.availableDecisions }
        : {}),
      ...details.parameters,
    },
  })
}

function codexApprovalResponse(
  request: CodexWireServerRequest,
  approved: boolean,
  rememberForSession?: boolean
) {
  if (!shouldUseLegacyApprovalResponse(request)) {
    if (approved) {
      if (
        rememberForSession &&
        hasAvailableDecision(request, 'acceptForSession')
      ) {
        return { decision: 'acceptForSession' }
      }
      if (hasAvailableDecision(request, 'accept')) return { decision: 'accept' }
      return { decision: 'accept' }
    }

    if (hasAvailableDecision(request, 'decline')) return { decision: 'decline' }
    return { decision: 'cancel' }
  }

  if (request.method === 'mcpServer/elicitation/request') {
    return { action: approved ? 'accept' : 'decline' }
  }

  return {
    decision: approved
      ? rememberForSession
        ? 'approved_for_session'
        : 'approved'
      : 'denied',
  }
}

function hasAvailableDecision(
  request: CodexWireServerRequest,
  decision: string
) {
  if (!isRecord(request.params)) return false
  const available = request.params.availableDecisions
  if (!Array.isArray(available)) return false

  return available.some((candidate) => {
    if (typeof candidate === 'string') return candidate === decision
    if (isRecord(candidate) && decision in candidate) return true
    return false
  })
}

function shouldUseLegacyApprovalResponse(request: CodexWireServerRequest) {
  return (
    request.method === 'mcpServer/elicitation/request' ||
    !hasAvailableDecision(request, 'accept')
  )
}

async function resolveServerRequest(request: CodexWireServerRequest) {
  if (request.method === 'item/permissions/requestApproval') {
    const params = isRecord(request.params) ? request.params : {}
    return {
      permissions: isRecord(params.permissions)
        ? compactObject(params.permissions)
        : {},
    }
  }

  if (request.method === 'attestation/generate') {
    return { token: 'v1.Parlo-offline' }
  }

  if (request.method === 'item/tool/requestUserInput') {
    return await resolveToolUserInputRequest(request)
  }

  if (request.method === 'item/tool/call') {
    // "Disconnect Parlo": when the Codex engine (app-server) is the agent brain,
    // we no longer act as a tool proxy. Codex performs tool use against the
    // MCP servers we have declared for it in config.toml (mcp-config-bridge).
    // Any host-mediated item/tool/call is rejected with guidance.
    // (Approvals and user-input requests are still mediated here for UX.)
    return {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text:
            'Host tool proxy disabled. Codex executes tools directly via MCP servers ' +
            'declared in its per-session config.toml (sourced from Parlo MCP settings).',
        },
      ],
    }
  }

  return {}
}

async function resolveToolUserInputRequest(request: CodexWireServerRequest) {
  const params = isRecord(request.params) ? request.params : {}
  const questions = parseCodexUserInputQuestions(params.questions)
  const answers = await useCodexUserInput.getState().requestUserInput(questions)
  return { answers }
}

function parseCodexUserInputQuestions(
  value: unknown
): CodexUserInputQuestion[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((question) => {
    if (!isRecord(question)) return []
    const id = stringValue(question.id)
    if (!id) return []

    const label =
      stringValue(question.question) ??
      stringValue(question.prompt) ??
      stringValue(question.header) ??
      id
    const description =
      stringValue(question.description) ?? stringValue(question.subtitle)

    const rawOptions = question.options
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap((option) => {
          if (typeof option === 'string') {
            return [{ label: option, value: option }]
          }
          if (!isRecord(option)) return []
          const optionValue =
            stringValue(option.value) ??
            stringValue(option.id) ??
            stringValue(option.label)
          if (!optionValue) return []
          return [
            {
              label: stringValue(option.label) ?? optionValue,
              value: optionValue,
            },
          ]
        })
      : undefined

    return [
      {
        id,
        label,
        ...(description ? { description } : {}),
        ...(options && options.length > 0 ? { options } : {}),
      },
    ]
  })
}

function codexApprovalDetails(request: CodexWireServerRequest) {
  const params = isRecord(request.params) ? request.params : {}

  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'execCommandApproval'
  ) {
    return {
      toolName: 'Codex command',
      actionId: 'codex.command-approval',
      category: 'shell' as const,
      risk: 'high' as const,
      resourceLabel: commandValue(params.command) ?? stringValue(params.cwd),
      rememberKey: commandValue(params.command)
        ? `codex:command:${commandValue(params.command)}`
        : undefined,
      parameters: compactObject({
        command: commandValue(params.command),
        cwd: stringValue(params.cwd),
        reason: stringValue(params.reason),
        codexThreadId: stringValue(params.threadId),
      }),
    }
  }

  if (
    request.method === 'item/fileChange/requestApproval' ||
    request.method === 'applyPatchApproval'
  ) {
    return {
      toolName: 'Codex file change',
      actionId: 'codex.file-change-approval',
      category: 'file' as const,
      risk: 'high' as const,
      resourceLabel: stringValue(params.grantRoot),
      rememberKey: stringValue(params.grantRoot)
        ? `codex:file-change:${stringValue(params.grantRoot)}`
        : undefined,
      parameters: compactObject({
        grantRoot: stringValue(params.grantRoot),
        reason: stringValue(params.reason),
        codexThreadId: stringValue(params.threadId),
      }),
    }
  }

  if (request.method === 'mcpServer/elicitation/request') {
    return {
      toolName: `MCP: ${stringValue(params.serverName) ?? 'server'}`,
      actionId: 'codex.mcp-elicitation',
      category: 'app' as const,
      risk: 'medium' as const,
      resourceLabel: stringValue(params.serverName),
      rememberKey: stringValue(params.serverName)
        ? `codex:mcp:${stringValue(params.serverName)}`
        : undefined,
      parameters: compactObject({
        message: stringValue(params.message),
        mode: stringValue(params.mode),
        url: stringValue(params.url),
        serverName: stringValue(params.serverName),
      }),
    }
  }

  return {
    toolName: 'Codex action',
    actionId: 'codex.action-approval',
    category: 'app' as const,
    risk: 'medium' as const,
    resourceLabel: request.method,
    rememberKey: `codex:action:${request.method}`,
    parameters: {
      method: request.method,
      params,
      // Include threadId so UI can highlight if this approval is from a subagent/child
      threadId:
        stringValue(params?.threadId) ||
        stringValue((request as { threadId?: unknown }).threadId),
    },
  }
}

export function clearCodexAppServerChatSessionsForTests() {
  resetGlobalCodexRuntimeForTests()
}

/**
 * Send additional input ("steer") to a specific Codex sub-thread (child agent).
 * This is the high-level API for the UI to "open up" a subagent and talk to it directly.
 * Events from the steer will flow back through the normal stream (tagged with the sub threadId).
 */
export async function steerCodexSubThread(
  parloThreadId: string,
  targetCodexThreadId: string,
  text: string,
  options?: {
    clientUserMessageId?: string
    images?: Array<{ data: string; mediaType: string }>
  }
) {
  return requireCodexSession(parloThreadId).steerThread(
    targetCodexThreadId,
    text,
    options?.clientUserMessageId,
    options?.images
  )
}

/**
 * Steer a subagent and stream live Codex events (with approval bridging) until the
 * sub-thread turn completes. Powers the subagent inspector's live activity panel.
 */
export async function* steerCodexSubThreadEvents(
  parloThreadId: string,
  targetCodexThreadId: string,
  text: string,
  options?: {
    clientUserMessageId?: string
    images?: Array<{ data: string; mediaType: string }>
  }
): AsyncGenerator<CodexAppServerEvent> {
  const client = requireCodexClient()
  const events = bridgeCodexApprovalRequests(
    client.steerThreadWithEvents(
      targetCodexThreadId,
      text,
      options?.clientUserMessageId,
      options?.images
    ),
    client,
    parloThreadId
  )
  yield* events
}

/**
 * Start a Codex review against real git state. Delivery defaults to detached so
 * findings surface as analysis on top of the authoritative git-diff review panel.
 */
export async function startCodexReview(
  parloThreadId: string,
  target:
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title?: string }
    | { type: 'custom'; instructions: string } = { type: 'uncommittedChanges' },
  options?: { userFacingHint?: string }
) {
  return requireCodexSession(parloThreadId).startReview(parloThreadId, target, {
    delivery: 'detached',
    userFacingHint:
      options?.userFacingHint ??
      'Review workspace changes. Provide structured analysis only — the host git-diff panel is the authoritative diff source.',
  })
}

/**
 * High-level access to Codex app-server runtime capabilities (the "next layer"
 * after static config/MCP/AGENTS emission).
 * These delegate to the active session for a Parlo thread (Codex owns the
 * planning/execution; Parlo owns the curation UI + approvals + workspace).
 * Skills, plugins, hooks, MCP OAuth, remote control, and live config are
 * all available via the app-server when the profile/chat is codex-backed.
 */
export async function listCodexSkills(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(parloThreadId).listSkills(params)
}

export async function setCodexSkillExtraRoots(parloThreadId: string, roots: string[]) {
  return requireCodexSession(parloThreadId).setSkillExtraRoots(roots)
}

export async function listCodexHooks(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(parloThreadId).listHooks(params)
}

export async function listCodexPlugins(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(parloThreadId).listPlugins(params)
}

export async function listInstalledCodexPlugins(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(parloThreadId).listInstalledPlugins(params)
}

export async function listCodexApps(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(parloThreadId).listApps(params)
}

export async function installCodexPlugin(parloThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(parloThreadId).installPlugin(params)
}

export async function uninstallCodexPlugin(parloThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(parloThreadId).uninstallPlugin(params)
}

export async function readCodexPlugin(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).readPlugin(params)
}

export async function readCodexPluginSkill(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).readPluginSkill(params)
}

export async function addCodexMarketplace(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).addMarketplace(params)
}

export async function removeCodexMarketplace(
  parloThreadId: string,
  marketplaceName: string
) {
  return requireCodexSession(parloThreadId).removeMarketplace(marketplaceName)
}

export async function upgradeCodexMarketplace(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).upgradeMarketplace(params)
}

export async function writeCodexSkillConfig(parloThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(parloThreadId).writeSkillConfig(params)
}

export async function setCodexExperimentalFeatureEnablement(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).setExperimentalFeatureEnablement(params)
}

export async function addCodexEnvironment(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).addEnvironment(params)
}

export async function execCodexCommand(
  parloThreadId: string,
  params: CodexCommandExecParams
) {
  return requireCodexSession(parloThreadId).execCommand(params)
}

export async function writeCodexCommandInput(
  parloThreadId: string,
  processId: string,
  params: { deltaBase64?: string; closeStdin?: boolean }
) {
  return requireCodexSession(parloThreadId).writeCommandStdin(processId, params)
}

export async function resizeCodexCommandTerminal(
  parloThreadId: string,
  processId: string,
  size: { rows: number; cols: number }
) {
  return requireCodexSession(parloThreadId).resizeCommandPty(processId, size)
}

export async function terminateCodexCommand(
  parloThreadId: string,
  processId: string
) {
  return requireCodexSession(parloThreadId).terminateCommand(processId)
}

export async function spawnCodexProcess(
  parloThreadId: string,
  params: CodexProcessSpawnParams
) {
  return requireCodexSession(parloThreadId).spawnProcess(params)
}

export async function writeCodexProcessInput(
  parloThreadId: string,
  processHandle: string,
  params: { deltaBase64?: string; closeStdin?: boolean }
) {
  return requireCodexSession(parloThreadId).writeProcessStdin(processHandle, params)
}

export async function resizeCodexProcessTerminal(
  parloThreadId: string,
  processHandle: string,
  size: { rows: number; cols: number }
) {
  return requireCodexSession(parloThreadId).resizeProcessPty(processHandle, size)
}

export async function killCodexProcess(
  parloThreadId: string,
  processHandle: string
) {
  return requireCodexSession(parloThreadId).killProcess(processHandle)
}

export async function readCodexDirectory(
  parloThreadId: string,
  path: string
) {
  return requireCodexSession(parloThreadId).readDirectory(path)
}

export async function readCodexFile(
  parloThreadId: string,
  path: string
) {
  return requireCodexSession(parloThreadId).readFile(path)
}

export async function getCodexMetadata(
  parloThreadId: string,
  path: string
) {
  return requireCodexSession(parloThreadId).getMetadata(path)
}

export async function writeCodexFile(
  parloThreadId: string,
  path: string,
  dataBase64: string
) {
  return requireCodexSession(parloThreadId).writeFile(path, dataBase64)
}

export async function createCodexDirectory(
  parloThreadId: string,
  path: string,
  recursive?: boolean
) {
  return requireCodexSession(parloThreadId).createDirectory(path, recursive)
}

export async function removeCodexFileSystemPath(
  parloThreadId: string,
  params: CodexFileSystemRemoveParams
) {
  return requireCodexSession(parloThreadId).removeFileSystemPath(params)
}

export async function copyCodexFileSystemPath(
  parloThreadId: string,
  params: CodexFileSystemCopyParams
) {
  return requireCodexSession(parloThreadId).copyFileSystemPath(params)
}

export async function watchCodexFileSystem(
  parloThreadId: string,
  watchId: string,
  path: string
) {
  return requireCodexSession(parloThreadId).watchFileSystem(watchId, path)
}

export async function unwatchCodexFileSystem(
  parloThreadId: string,
  watchId: string
) {
  return requireCodexSession(parloThreadId).unwatchFileSystem(watchId)
}

export async function listCodexModels(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listModels(params)
}

export async function readCodexModelProviderCapabilities(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).readModelProviderCapabilities(params)
}

export async function listCodexExperimentalFeatures(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listExperimentalFeatures(params)
}

export async function startCodexMcpOauthLogin(parloThreadId: string, server: string) {
  return requireCodexSession(parloThreadId).startMcpOauthLogin(server)
}

export async function listCodexMcpServerStatus(parloThreadId: string, params: Record<string, unknown> = {}) {
  return requestCodexAppServerMethodWithFallback(
    parloThreadId,
    'mcpServerStatus/list',
    params
  )
}

export async function readCodexAccount(
  parloThreadId: string,
  refreshToken = false
) {
  return requireCodexSession(parloThreadId).readAccount(refreshToken)
}

export async function startCodexAccountLogin(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).startAccountLogin(params)
}

export async function cancelCodexAccountLogin(
  parloThreadId: string,
  loginId: string
) {
  return requireCodexSession(parloThreadId).cancelAccountLogin(loginId)
}

export async function logoutCodexAccount(parloThreadId: string) {
  return requireCodexSession(parloThreadId).logoutAccount()
}

export async function readCodexAccountRateLimits(parloThreadId: string) {
  return requireCodexSession(parloThreadId).readAccountRateLimits()
}

export async function readCodexAccountUsage(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).readAccountUsage(params)
}

export async function sendCodexAddCreditsNudgeEmail(
  parloThreadId: string,
  creditType: 'credits' | 'usage_limit'
) {
  return requireCodexSession(parloThreadId).sendAddCreditsNudgeEmail(creditType)
}

export async function listCodexPermissionProfiles(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listPermissionProfiles(params)
}

export async function listCodexCollaborationModes(parloThreadId: string) {
  return requireCodexSession(parloThreadId).listCollaborationModes()
}

export async function listCodexThreads(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listThreads(params)
}

export async function searchCodexThreads(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/search',
    params
  )
}

export async function startCodexThread(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer('thread/start', params)
}

export async function resumeCodexThread(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/resume',
    params
  )
}

export async function listLoadedCodexThreads(parloThreadId: string) {
  return requireCodexSession(parloThreadId).listLoadedThreads()
}

export async function readCodexThread(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).readThread(codexThreadId, params)
}

export async function listCodexThreadTurns(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listThreadTurns(codexThreadId, params)
}

export async function listCodexThreadTurnItems(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listThreadTurnItems({
    threadId: codexThreadId,
    ...params,
  })
}

export async function startCodexTurn(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer('turn/start', params)
}

export async function forkCodexThread(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).forkThread(codexThreadId, params)
}

export async function archiveCodexThread(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).archiveThread(codexThreadId)
}

export async function unarchiveCodexThread(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).unarchiveThread(codexThreadId)
}

export async function setCodexThreadName(
  parloThreadId: string,
  codexThreadId: string,
  name: string
) {
  return requireCodexSession(parloThreadId).setThreadName(codexThreadId, name)
}

export async function setCodexThreadGoal(
  parloThreadId: string,
  codexThreadId: string,
  goal: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).setThreadGoal(codexThreadId, goal)
}

export async function getCodexThreadGoal(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).getThreadGoal(codexThreadId)
}

export async function clearCodexThreadGoal(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).clearThreadGoal(codexThreadId)
}

export async function setCodexThreadMemoryMode(
  parloThreadId: string,
  codexThreadId: string,
  memoryMode: 'enabled' | 'disabled'
) {
  return requireCodexSession(parloThreadId).setThreadMemoryMode(codexThreadId, memoryMode)
}

export async function updateCodexThreadMetadata(
  parloThreadId: string,
  codexThreadId: string,
  metadata: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).updateThreadMetadata(codexThreadId, {
    metadata,
  })
}

export async function updateCodexThreadSettings(
  parloThreadId: string,
  codexThreadId: string,
  settings: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).updateThreadSettings(codexThreadId, {
    settings,
  })
}

export async function unsubscribeCodexThread(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).unsubscribeThread(codexThreadId)
}

export async function interruptCodexThreadTurn(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer('turn/interrupt', {
    threadId: codexThreadId,
    ...params,
  })
}

export async function compactCodexThreadById(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requestCodexAppServerMethodWithFallback(
    parloThreadId,
    'thread/compact/start',
    {
      threadId: codexThreadId,
      ...params,
    }
  )
}

export async function reloadCodexThread(
  parloThreadId: string,
  codexThreadId: string
) {
  return readCodexThread(parloThreadId, codexThreadId)
}

export async function rollbackCodexThreadById(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer('thread/rollback', {
    threadId: codexThreadId,
    ...params,
  })
}

export async function startCodexThreadReview(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requestCodexAppServerMethodWithFallback(
    parloThreadId,
    'review/start',
    {
      threadId: codexThreadId,
      ...params,
    }
  )
}

export async function injectCodexThreadItems(
  parloThreadId: string,
  codexThreadId: string,
  items: unknown[]
) {
  return requireCodexSession(parloThreadId).injectThreadItems(
    codexThreadId,
    items
  )
}

export async function cleanCodexBackgroundTerminals(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).cleanBackgroundTerminals(
    codexThreadId
  )
}

export async function startCodexThreadRealtime(
  parloThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).startThreadRealtime(
    codexThreadId,
    params
  )
}

export async function appendCodexThreadRealtimeAudio(
  parloThreadId: string,
  codexThreadId: string,
  audioBase64: string
) {
  return requireCodexSession(parloThreadId).appendThreadRealtimeAudio(
    codexThreadId,
    audioBase64
  )
}

export async function appendCodexThreadRealtimeText(
  parloThreadId: string,
  codexThreadId: string,
  text: string
) {
  return requireCodexSession(parloThreadId).appendThreadRealtimeText(
    codexThreadId,
    text
  )
}

export async function stopCodexThreadRealtime(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).stopThreadRealtime(codexThreadId)
}

export async function listCodexThreadRealtimeVoices(
  parloThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/realtime/listVoices',
    { threadId: codexThreadId }
  )
}

export async function approveCodexGuardianDeniedAction(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/approveGuardianDeniedAction',
    params
  )
}

export async function incrementCodexThreadElicitation(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/increment_elicitation',
    params
  )
}

export async function decrementCodexThreadElicitation(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'thread/decrement_elicitation',
    params
  )
}

export async function resetCodexMemory(
  parloThreadId: string
) {
  return requireCodexSession(parloThreadId).resetMemory()
}

export async function readCodexConversationSummary(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'getConversationSummary',
    params
  )
}

export async function readCodexGitDiffToRemote(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'gitDiffToRemote',
    params
  )
}

export async function readCodexAuthStatus(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'getAuthStatus',
    params
  )
}

export async function enableCodexRemoteControl(parloThreadId: string) {
  return requireCodexSession(parloThreadId).enableRemoteControl()
}

export async function disableCodexRemoteControl(parloThreadId: string) {
  return requireCodexSession(parloThreadId).disableRemoteControl()
}

export async function readCodexRemoteControlStatus(parloThreadId: string) {
  return requireCodexSession(parloThreadId).readRemoteControlStatus()
}

export async function startCodexRemoteControlPairing(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).startRemoteControlPairing(params)
}

export async function readCodexRemoteControlPairingStatus(
  parloThreadId: string,
  params: { pairingCode?: string; manualPairingCode?: string }
) {
  return requireCodexSession(parloThreadId).readRemoteControlPairingStatus(params)
}

export async function listCodexRemoteControlClients(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).listRemoteControlClients(params)
}

export async function revokeCodexRemoteControlClient(
  parloThreadId: string,
  clientId: string
) {
  return requireCodexSession(parloThreadId).revokeRemoteControlClient({
    clientId,
  })
}

export async function readCodexConfig(parloThreadId: string) {
  return requireCodexSession(parloThreadId).readConfig()
}

export async function readCodexConfigRequirements(parloThreadId: string) {
  return requireCodexSession(parloThreadId).readConfigRequirements()
}

export async function detectCodexExternalAgentConfig(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).detectExternalAgentConfig(params)
}

export async function importCodexExternalAgentConfig(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).importExternalAgentConfig(params)
}

export async function writeCodexConfigValue(
  parloThreadId: string,
  keyPath: string | string[],
  value: unknown
) {
  return callCodexAppServer(parloThreadId, 'config/value/write', {
    keyPath,
    value,
  })
}

export async function writeCodexConfigBatch(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).batchWriteConfig(params)
}

export async function startCodexWindowsSandbox(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).startWindowsSandboxSetup(params)
}

export async function readCodexWindowsSandboxReadiness(parloThreadId: string) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'windowsSandbox/readiness'
  )
}

export async function startCodexFuzzyFileSearchSession(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'fuzzyFileSearch/sessionStart',
    params
  )
}

export async function updateCodexFuzzyFileSearchSession(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'fuzzyFileSearch/sessionUpdate',
    params
  )
}

export async function stopCodexFuzzyFileSearchSession(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'fuzzyFileSearch/sessionStop',
    params
  )
}

export async function listCodexPluginShares(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'plugin/share/list',
    params
  )
}

export async function checkoutCodexPluginShare(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'plugin/share/checkout',
    params
  )
}

export async function updateCodexPluginShareTargets(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'plugin/share/updateTargets',
    params
  )
}

export async function deleteCodexPluginShare(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'plugin/share/delete',
    params
  )
}

export async function saveCodexPluginShare(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'plugin/share/save',
    params
  )
}

export async function runCodexMockExperimentalMethod(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(parloThreadId).requestAppServer(
    'mock/experimentalMethod',
    params
  )
}

export async function uploadCodexFeedback(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).uploadFeedback(params)
}

export async function readCodexMcpResource(
  parloThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(parloThreadId).readMcpResource(params)
}

export async function callCodexMcpTool(
  parloThreadId: string,
  params: CodexMcpToolCallParams
) {
  return requireCodexSession(parloThreadId).callMcpTool(params)
}

export async function reloadCodexMcpConfig(
  parloThreadId: string,
  params: Record<string, unknown> = {}
) {
  return callCodexAppServer(parloThreadId, 'config/mcpServer/reload', params)
}

export type CodexCliRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

type CodexCliSubcommandInput = {
  command?: string
  cwd?: string
  codexHome?: string
  env?: Record<string, string>
}

/**
 * Run a Codex CLI subcommand against a profile's CODEX_HOME.
 * Bridges non-interactive / diagnostic CLI features into Parlo Studio.
 */
export async function runCodexCliSubcommand(input: {
  command: string
  args?: string[]
  cwd?: string
  codexHome?: string
  env?: Record<string, string>
}): Promise<CodexCliRunResult> {
  return invoke<CodexCliRunResult>('run_codex_cli_subcommand', {
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd ?? null,
    codexHome: input.codexHome ?? null,
    extraEnv: input.env ?? null,
  })
}

export async function runCodexCliCommand(input: {
  command: string
  args?: string[]
  cwd?: string
  codexHome?: string
  env?: Record<string, string>
}) {
  return runCodexCliSubcommand(input)
}

export async function runCodexCliNamedCommand(input: {
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
  subcommand: string
  args?: string[]
}) {
  return runCodexCliSubcommand({
    command: input.command ?? 'codex',
    args: [input.subcommand, ...(input.args ?? [])],
    cwd: input.cwd,
    codexHome: input.codexHome,
    env: input.env,
  })
}

export async function runCodexCliHelp(input?: {
  args?: string[]
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'help',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliAppServer(input?: {
  args?: string[]
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'app-server',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliReview(input?: {
  args?: string[]
  prompt?: string
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  const args = [...(input?.args ?? [])]
  if (input?.prompt?.trim()) {
    args.push(input.prompt.trim())
  }

  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'review',
    args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliDoctor(input?: {
  args?: string[]
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'doctor',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliFeatures(input?: {
  args?: string[]
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'features',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliMcp(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'mcp',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliMcpServer(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'mcp-server',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliApp(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'app',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliPlugin(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'plugin',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliCloud(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'cloud',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliRemoteControl(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'remote-control',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliArchive(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'archive',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliUnarchive(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'unarchive',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliFork(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'fork',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliResume(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'resume',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliSandbox(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'sandbox',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliUpdate(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'update',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliExecServer(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'exec-server',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexCliDebug(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'debug',
    args: input?.args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexLogin(input?: {
  status?: boolean
  apiKey?: string
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  const args = ['login']
  if (input?.status) {
    args.push('status')
  }
  if (input?.apiKey?.trim()) {
    args.push('--api-key', input.apiKey.trim())
  }
  return runCodexCliSubcommand({
    command: input?.command ?? 'codex',
    args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexLogout(input?: {
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliSubcommand({
    command: input?.command ?? 'codex',
    args: ['logout'],
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexVersion(input?: {
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  return runCodexCliSubcommand({
    command: input?.command ?? 'codex',
    args: ['-V'],
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

export async function runCodexApply(input: {
  taskId: string
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  const taskId = input.taskId.trim()
  if (!taskId) {
    throw new Error('apply task id is required.')
  }
  return runCodexCliSubcommand({
    command: input.command ?? 'codex',
    args: ['apply', taskId],
    codexHome: input.codexHome,
    cwd: input.cwd,
    env: input.env,
  })
}

export async function runCodexCompletion(input?: {
  shell?: string
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  const args = ['completion']
  const shell = input?.shell?.trim()
  if (shell) {
    args.push(shell)
  }
  return runCodexCliSubcommand({
    command: input?.command ?? 'codex',
    args,
    codexHome: input?.codexHome,
    cwd: input?.cwd,
    env: input?.env,
  })
}

/**
 * Run Codex non-interactively (`codex exec`). Bridges the CLI exec path for
 * automation, CI-style tasks, and Studio diagnostics outside app-server chat.
 */
export async function runCodexExec(input: {
  prompt: string
  command?: string
  codexHome?: string
  cwd?: string
  addDirs?: string[]
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  jsonOutput?: boolean
  outputLastMessage?: string
  extraArgs?: string[]
  env?: Record<string, string>
}) {
  const args = ['exec']
  if (input.sandbox) args.push('--sandbox', input.sandbox)
  if (input.jsonOutput) args.push('--json')
  if (input.outputLastMessage) {
    args.push('-o', input.outputLastMessage)
  }
  if (input.cwd) args.push('-C', input.cwd)
  for (const dir of input.addDirs ?? []) {
    if (dir.trim()) args.push('--add-dir', dir.trim())
  }
  if (input.extraArgs?.length) args.push(...input.extraArgs)
  args.push(input.prompt)
  return runCodexCliSubcommand({
    command: input.command ?? 'codex',
    args,
    codexHome: input.codexHome,
    cwd: input.cwd,
    env: input.env,
  })
}

export function getCodexAppServerRuntimeLogs(
  sessionId: string = GLOBAL_CODEX_APP_SERVER_SESSION_ID,
  maxChars = 16000
) {
  return useCodexAppServerRuntime.getState().getLogText(sessionId, maxChars)
}

function looksLikeMissingMethodError(error: unknown) {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error ?? '')
  return (
    /method.*not found/i.test(message) ||
    /unknown method/i.test(message) ||
    /MethodNotFound/i.test(message) ||
    /Method was not found/i.test(message) ||
    /"code":-?32601/.test(message)
  )
}

async function requestCodexAppServerMethodWithFallback<T>(
  parloThreadId: string,
  primaryMethod: string,
  params: Record<string, unknown> = {}
) {
  const fallbackMethod = CODEX_APP_SERVER_METHOD_FALLBACKS[primaryMethod]
  if (!fallbackMethod) {
    return requireCodexSession(parloThreadId).requestAppServer(
      primaryMethod,
      params
    ) as T
  }
  return requestAppServerMethodWithFallback(
    parloThreadId,
    primaryMethod,
    fallbackMethod,
    params
  )
}

async function requestAppServerMethodWithFallback<T>(
  parloThreadId: string,
  primaryMethod: string,
  fallbackMethod: string,
  params: Record<string, unknown> = {}
) {
  try {
    return (await requireCodexSession(parloThreadId).requestAppServer(
      primaryMethod,
      params
    )) as T
  } catch (error) {
    if (looksLikeMissingMethodError(error)) {
      return (await requireCodexSession(parloThreadId).requestAppServer(
        fallbackMethod,
        params
      )) as T
    }
    throw error
  }
}

// Generic escape hatch for other advanced app-server calls surfaced in the client
// (remoteControl/*, marketplace/*, collaborationMode, environment, apps, config read/write, etc.)
export async function callCodexAppServer(parloThreadId: string, method: string, params?: Record<string, unknown>) {
  return requestCodexAppServerMethodWithFallback(
    parloThreadId,
    method,
    params ?? {}
  )
}

/**
 * Eagerly start the Codex app-server process for a thread so it is ready
 * when the user sends their first message. Call this when a Codex thread is
 * opened (e.g. on thread switch) rather than waiting for sendCodexAppServerChatMessage.
 * Safe to call multiple times — if the session is already running it is a no-op.
 */
export async function warmupCodexSession(
  threadId: string,
  provider: ModelProvider,
  model: Model
): Promise<void> {
  if (!isCodexAppServerProvider(provider.provider)) return
  const resolvedModel = resolveCodexStartupModel(provider, model)
  await prepareThreadCodexRuntime(threadId, provider, resolvedModel).catch(() => {
    // Warmup failures are non-fatal; the real send will surface the error
  })
}

export async function prepareCodexCapabilitySession(
  threadId: string,
  options: { cwd?: string } = {}
): Promise<void> {
  const modelProviderState = useModelProvider.getState()
  const provider =
    modelProviderState.getProviderByName(CODEX_APP_SERVER_PROVIDER_ID) ?? {
      active: true,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      settings: [],
      models: [{ id: CODEX_FALLBACK_MODEL_ID }],
      persist: true,
    }
  const model =
    provider.models.find((candidate) => candidate.id === CODEX_FALLBACK_MODEL_ID) ??
    provider.models.find((candidate) => candidate.active) ??
    provider.models[0] ??
    { id: CODEX_FALLBACK_MODEL_ID }

  await prepareThreadCodexRuntime(threadId, provider, model, options)
}

type CodexImageInput = {
  data: string // base64 without data: prefix, or full data url (will normalize)
  mediaType: string
}

function extractLatestUserTextAndImagesForCodex(messages: UIMessage[]): {
  text: string
  images: CodexImageInput[]
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue

    const textParts = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text?.trim() ?? '')
      .filter(Boolean)

    const text = textParts.join('\n')

    const images: CodexImageInput[] = []
    for (const part of message.parts) {
      if (part.type === 'file') {
        const p = part as { mediaType?: string; data?: string; url?: string }
        const mediaType = p.mediaType || ''
        if (mediaType.startsWith('image/')) {
          let data = p.data || p.url || ''
          // Normalize data url to raw base64 if needed
          if (data.startsWith('data:')) {
            const comma = data.indexOf(',')
            if (comma > -1) data = data.substring(comma + 1)
          }
          if (data) {
            images.push({ data, mediaType })
          }
        }
      }
    }

    if (text || images.length > 0) {
      return { text, images }
    }
  }
  return { text: '', images: [] }
}

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function commandValue(value: unknown) {
  if (Array.isArray(value)) {
    const command = value.filter((part) => typeof part === 'string').join(' ')
    return command.length > 0 ? command : undefined
  }
  return stringValue(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function withCodexStreamCleanup(
  stream: ReadableStream<UIMessageChunk>,
  threadId: string,
  onCleanup?: () => void
) {
  const reader = stream.getReader()
  const cleanup = () => {
    onCleanup?.()
    useAppState.getState().updatePromptProgress(undefined)
    useAppState.getState().updateLoadingModel(false)
    useAppState.getState().updateThreadPromptProgress(threadId, undefined)
    useAppState.getState().updateThreadLoadingModel(threadId, false)
    if (useAppState.getState().currentStreamThreadId === threadId) {
      useAppState.getState().setCurrentStreamThreadId(undefined)
    }
  }

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          cleanup()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        cleanup()
        controller.error(error)
      }
    },
    async cancel(reason) {
      cleanup()
      await reader.cancel(reason)
    },
  })
}
