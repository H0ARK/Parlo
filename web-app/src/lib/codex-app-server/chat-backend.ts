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
import { buildLocalApiBaseUrl } from '@/lib/local-api-gateway'
import { getServiceHub } from '@/hooks/useServiceHub'
import { providerRemoteAuthKeyChain } from '@/lib/provider-api-keys'
import {
  gatewayWireApiForProvider as codexWireApiForProvider,
  resolveXaiRuntimeModelId,
  xaiModelSupportsReasoningEffort,
} from '@/lib/provider-gateway'
import { buildCodexConfigToml } from './config'
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

export const CODEX_APP_SERVER_PROVIDER_ID = 'codex'

type CodexChatBackendRequest = {
  threadId: string
  messageId?: string
  messages: UIMessage[]
  provider: ModelProvider
  model: Model
  abortSignal?: AbortSignal
}

const JAN_HOSTED_LOCAL_PROVIDERS = new Set(['llamacpp', 'mlx'])
const GLOBAL_CODEX_THREAD_PLACEHOLDER = '__global__'
const CODEX_FALLBACK_MODEL_ID = 'gpt-5.5'
const CODEX_JAN_GATEWAY_PROVIDER_ID = 'jan-gateway'
const CODEX_JAN_GATEWAY_API_KEY_ENV = 'JAN_LOCAL_API_SERVER_API_KEY'

const CODEX_NOT_RUNNING_ERROR =
  'Codex app-server is not running yet. Wait for app startup to finish.'

export const isCodexAppServerProvider = (providerId: string | undefined) =>
  providerId === CODEX_APP_SERVER_PROVIDER_ID

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
  if (!JAN_HOSTED_LOCAL_PROVIDERS.has(provider.provider)) return

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

function requireCodexSession(janThreadId: string) {
  void janThreadId
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
      buildCodexSessionOptions(GLOBAL_CODEX_THREAD_PLACEHOLDER, provider, selectedModel)
    )
  }

  return toGlobalSpawnOptions({
    codexBinaryPath: defaultCodexBinaryPath(),
    codexHome: resolveAppCodexHome(),
    transport: 'app-server',
    cwd: './',
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    ...buildJanGatewayCodexConfig(selectedModel.id),
    mcpRefreshConfig: {
      mcp_servers: {},
      mcp_oauth_credentials_store_mode: 'auto',
    },
    env: {},
  })
}

export async function compactCodexThread(janThreadId: string) {
  return requireCodexSession(janThreadId).compactThread(janThreadId)
}

export async function interruptCodexTurn(janThreadId: string) {
  return requireCodexSession(janThreadId).interruptTurn(janThreadId)
}

export async function rollbackCodexThread(janThreadId: string, numTurns = 1) {
  return requireCodexSession(janThreadId).rollbackThread(janThreadId, numTurns)
}

export async function reloadCodexUserConfig(janThreadId: string) {
  return requireCodexSession(janThreadId).reloadUserConfig()
}

export async function refreshCodexMcpServers(janThreadId: string) {
  return requireCodexSession(janThreadId).refreshMcpServers()
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
  return /Missing environment variable:\s*`?JAN_CODEX_PROVIDER_API_KEY`?/i.test(
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
      janThreadId: threadId,
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
    return { token: 'v1.jan-offline' }
  }

  if (request.method === 'item/tool/requestUserInput') {
    return await resolveToolUserInputRequest(request)
  }

  if (request.method === 'item/tool/call') {
    // "Disconnect Jan": when the Codex engine (app-server) is the agent brain,
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
            'declared in its per-session config.toml (sourced from Jan MCP settings).',
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
  janThreadId: string,
  targetCodexThreadId: string,
  text: string,
  options?: {
    clientUserMessageId?: string
    images?: Array<{ data: string; mediaType: string }>
  }
) {
  return requireCodexSession(janThreadId).steerThread(
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
  janThreadId: string,
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
    janThreadId
  )
  yield* events
}

/**
 * Start a Codex review against real git state. Delivery defaults to detached so
 * findings surface as analysis on top of the authoritative git-diff review panel.
 */
export async function startCodexReview(
  janThreadId: string,
  target:
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title?: string }
    | { type: 'custom'; instructions: string } = { type: 'uncommittedChanges' },
  options?: { userFacingHint?: string }
) {
  return requireCodexSession(janThreadId).startReview(janThreadId, target, {
    delivery: 'detached',
    userFacingHint:
      options?.userFacingHint ??
      'Review workspace changes. Provide structured analysis only — the host git-diff panel is the authoritative diff source.',
  })
}

/**
 * High-level access to Codex app-server runtime capabilities (the "next layer"
 * after static config/MCP/AGENTS emission).
 * These delegate to the active session for a Jan thread (Codex owns the
 * planning/execution; Jan owns the curation UI + approvals + workspace).
 * Skills, plugins, hooks, MCP OAuth, remote control, and live config are
 * all available via the app-server when the profile/chat is codex-backed.
 */
export async function listCodexSkills(janThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(janThreadId).listSkills(params)
}

export async function setCodexSkillExtraRoots(janThreadId: string, roots: string[]) {
  return requireCodexSession(janThreadId).setSkillExtraRoots(roots)
}

export async function listCodexHooks(janThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(janThreadId).listHooks(params)
}

export async function listCodexPlugins(janThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(janThreadId).listPlugins(params)
}

export async function listInstalledCodexPlugins(janThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(janThreadId).listInstalledPlugins(params)
}

export async function listCodexApps(janThreadId: string, params: Record<string, unknown> = {}) {
  return requireCodexSession(janThreadId).listApps(params)
}

export async function installCodexPlugin(janThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(janThreadId).installPlugin(params)
}

export async function uninstallCodexPlugin(janThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(janThreadId).uninstallPlugin(params)
}

export async function readCodexPlugin(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).readPlugin(params)
}

export async function readCodexPluginSkill(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).readPluginSkill(params)
}

export async function addCodexMarketplace(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).addMarketplace(params)
}

export async function removeCodexMarketplace(
  janThreadId: string,
  marketplaceName: string
) {
  return requireCodexSession(janThreadId).removeMarketplace(marketplaceName)
}

export async function upgradeCodexMarketplace(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).upgradeMarketplace(params)
}

export async function writeCodexSkillConfig(janThreadId: string, params: Record<string, unknown>) {
  return requireCodexSession(janThreadId).writeSkillConfig(params)
}

export async function setCodexExperimentalFeatureEnablement(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).setExperimentalFeatureEnablement(params)
}

export async function addCodexEnvironment(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).addEnvironment(params)
}

export async function execCodexCommand(
  janThreadId: string,
  params: CodexCommandExecParams
) {
  return requireCodexSession(janThreadId).execCommand(params)
}

export async function writeCodexCommandInput(
  janThreadId: string,
  processId: string,
  params: { deltaBase64?: string; closeStdin?: boolean }
) {
  return requireCodexSession(janThreadId).writeCommandStdin(processId, params)
}

export async function resizeCodexCommandTerminal(
  janThreadId: string,
  processId: string,
  size: { rows: number; cols: number }
) {
  return requireCodexSession(janThreadId).resizeCommandPty(processId, size)
}

export async function terminateCodexCommand(
  janThreadId: string,
  processId: string
) {
  return requireCodexSession(janThreadId).terminateCommand(processId)
}

export async function spawnCodexProcess(
  janThreadId: string,
  params: CodexProcessSpawnParams
) {
  return requireCodexSession(janThreadId).spawnProcess(params)
}

export async function writeCodexProcessInput(
  janThreadId: string,
  processHandle: string,
  params: { deltaBase64?: string; closeStdin?: boolean }
) {
  return requireCodexSession(janThreadId).writeProcessStdin(processHandle, params)
}

export async function resizeCodexProcessTerminal(
  janThreadId: string,
  processHandle: string,
  size: { rows: number; cols: number }
) {
  return requireCodexSession(janThreadId).resizeProcessPty(processHandle, size)
}

export async function killCodexProcess(
  janThreadId: string,
  processHandle: string
) {
  return requireCodexSession(janThreadId).killProcess(processHandle)
}

export async function readCodexDirectory(
  janThreadId: string,
  path: string
) {
  return requireCodexSession(janThreadId).readDirectory(path)
}

export async function readCodexFile(
  janThreadId: string,
  path: string
) {
  return requireCodexSession(janThreadId).readFile(path)
}

export async function getCodexMetadata(
  janThreadId: string,
  path: string
) {
  return requireCodexSession(janThreadId).getMetadata(path)
}

export async function writeCodexFile(
  janThreadId: string,
  path: string,
  dataBase64: string
) {
  return requireCodexSession(janThreadId).writeFile(path, dataBase64)
}

export async function createCodexDirectory(
  janThreadId: string,
  path: string,
  recursive?: boolean
) {
  return requireCodexSession(janThreadId).createDirectory(path, recursive)
}

export async function removeCodexFileSystemPath(
  janThreadId: string,
  params: CodexFileSystemRemoveParams
) {
  return requireCodexSession(janThreadId).removeFileSystemPath(params)
}

export async function copyCodexFileSystemPath(
  janThreadId: string,
  params: CodexFileSystemCopyParams
) {
  return requireCodexSession(janThreadId).copyFileSystemPath(params)
}

export async function watchCodexFileSystem(
  janThreadId: string,
  watchId: string,
  path: string
) {
  return requireCodexSession(janThreadId).watchFileSystem(watchId, path)
}

export async function unwatchCodexFileSystem(
  janThreadId: string,
  watchId: string
) {
  return requireCodexSession(janThreadId).unwatchFileSystem(watchId)
}

export async function listCodexModels(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listModels(params)
}

export async function readCodexModelProviderCapabilities(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).readModelProviderCapabilities(params)
}

export async function listCodexExperimentalFeatures(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listExperimentalFeatures(params)
}

export async function startCodexMcpOauthLogin(janThreadId: string, server: string) {
  return requireCodexSession(janThreadId).startMcpOauthLogin(server)
}

export async function listCodexMcpServerStatus(janThreadId: string, params: Record<string, unknown> = {}) {
  return requestCodexAppServerMethodWithFallback(
    janThreadId,
    'mcpServerStatus/list',
    params
  )
}

export async function readCodexAccount(
  janThreadId: string,
  refreshToken = false
) {
  return requireCodexSession(janThreadId).readAccount(refreshToken)
}

export async function startCodexAccountLogin(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).startAccountLogin(params)
}

export async function cancelCodexAccountLogin(
  janThreadId: string,
  loginId: string
) {
  return requireCodexSession(janThreadId).cancelAccountLogin(loginId)
}

export async function logoutCodexAccount(janThreadId: string) {
  return requireCodexSession(janThreadId).logoutAccount()
}

export async function readCodexAccountRateLimits(janThreadId: string) {
  return requireCodexSession(janThreadId).readAccountRateLimits()
}

export async function readCodexAccountUsage(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).readAccountUsage(params)
}

export async function sendCodexAddCreditsNudgeEmail(
  janThreadId: string,
  creditType: 'credits' | 'usage_limit'
) {
  return requireCodexSession(janThreadId).sendAddCreditsNudgeEmail(creditType)
}

export async function listCodexPermissionProfiles(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listPermissionProfiles(params)
}

export async function listCodexCollaborationModes(janThreadId: string) {
  return requireCodexSession(janThreadId).listCollaborationModes()
}

export async function listCodexThreads(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listThreads(params)
}

export async function searchCodexThreads(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/search',
    params
  )
}

export async function startCodexThread(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer('thread/start', params)
}

export async function resumeCodexThread(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/resume',
    params
  )
}

export async function listLoadedCodexThreads(janThreadId: string) {
  return requireCodexSession(janThreadId).listLoadedThreads()
}

export async function readCodexThread(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).readThread(codexThreadId, params)
}

export async function listCodexThreadTurns(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listThreadTurns(codexThreadId, params)
}

export async function listCodexThreadTurnItems(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listThreadTurnItems({
    threadId: codexThreadId,
    ...params,
  })
}

export async function startCodexTurn(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer('turn/start', params)
}

export async function forkCodexThread(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).forkThread(codexThreadId, params)
}

export async function archiveCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).archiveThread(codexThreadId)
}

export async function unarchiveCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).unarchiveThread(codexThreadId)
}

export async function setCodexThreadName(
  janThreadId: string,
  codexThreadId: string,
  name: string
) {
  return requireCodexSession(janThreadId).setThreadName(codexThreadId, name)
}

export async function setCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string,
  goal: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).setThreadGoal(codexThreadId, goal)
}

export async function getCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).getThreadGoal(codexThreadId)
}

export async function clearCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).clearThreadGoal(codexThreadId)
}

export async function setCodexThreadMemoryMode(
  janThreadId: string,
  codexThreadId: string,
  memoryMode: 'enabled' | 'disabled'
) {
  return requireCodexSession(janThreadId).setThreadMemoryMode(codexThreadId, memoryMode)
}

export async function updateCodexThreadMetadata(
  janThreadId: string,
  codexThreadId: string,
  metadata: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).updateThreadMetadata(codexThreadId, {
    metadata,
  })
}

export async function updateCodexThreadSettings(
  janThreadId: string,
  codexThreadId: string,
  settings: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).updateThreadSettings(codexThreadId, {
    settings,
  })
}

export async function unsubscribeCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).unsubscribeThread(codexThreadId)
}

export async function interruptCodexThreadTurn(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer('turn/interrupt', {
    threadId: codexThreadId,
    ...params,
  })
}

export async function compactCodexThreadById(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requestCodexAppServerMethodWithFallback(
    janThreadId,
    'thread/compact/start',
    {
      threadId: codexThreadId,
      ...params,
    }
  )
}

export async function reloadCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  return readCodexThread(janThreadId, codexThreadId)
}

export async function rollbackCodexThreadById(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer('thread/rollback', {
    threadId: codexThreadId,
    ...params,
  })
}

export async function startCodexThreadReview(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requestCodexAppServerMethodWithFallback(
    janThreadId,
    'review/start',
    {
      threadId: codexThreadId,
      ...params,
    }
  )
}

export async function injectCodexThreadItems(
  janThreadId: string,
  codexThreadId: string,
  items: unknown[]
) {
  return requireCodexSession(janThreadId).injectThreadItems(
    codexThreadId,
    items
  )
}

export async function cleanCodexBackgroundTerminals(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).cleanBackgroundTerminals(
    codexThreadId
  )
}

export async function startCodexThreadRealtime(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).startThreadRealtime(
    codexThreadId,
    params
  )
}

export async function appendCodexThreadRealtimeAudio(
  janThreadId: string,
  codexThreadId: string,
  audioBase64: string
) {
  return requireCodexSession(janThreadId).appendThreadRealtimeAudio(
    codexThreadId,
    audioBase64
  )
}

export async function appendCodexThreadRealtimeText(
  janThreadId: string,
  codexThreadId: string,
  text: string
) {
  return requireCodexSession(janThreadId).appendThreadRealtimeText(
    codexThreadId,
    text
  )
}

export async function stopCodexThreadRealtime(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).stopThreadRealtime(codexThreadId)
}

export async function listCodexThreadRealtimeVoices(
  janThreadId: string,
  codexThreadId: string
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/realtime/listVoices',
    { threadId: codexThreadId }
  )
}

export async function approveCodexGuardianDeniedAction(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/approveGuardianDeniedAction',
    params
  )
}

export async function incrementCodexThreadElicitation(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/increment_elicitation',
    params
  )
}

export async function decrementCodexThreadElicitation(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'thread/decrement_elicitation',
    params
  )
}

export async function resetCodexMemory(
  janThreadId: string
) {
  return requireCodexSession(janThreadId).resetMemory()
}

export async function readCodexConversationSummary(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'getConversationSummary',
    params
  )
}

export async function readCodexGitDiffToRemote(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'gitDiffToRemote',
    params
  )
}

export async function readCodexAuthStatus(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'getAuthStatus',
    params
  )
}

export async function enableCodexRemoteControl(janThreadId: string) {
  return requireCodexSession(janThreadId).enableRemoteControl()
}

export async function disableCodexRemoteControl(janThreadId: string) {
  return requireCodexSession(janThreadId).disableRemoteControl()
}

export async function readCodexRemoteControlStatus(janThreadId: string) {
  return requireCodexSession(janThreadId).readRemoteControlStatus()
}

export async function startCodexRemoteControlPairing(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).startRemoteControlPairing(params)
}

export async function readCodexRemoteControlPairingStatus(
  janThreadId: string,
  params: { pairingCode?: string; manualPairingCode?: string }
) {
  return requireCodexSession(janThreadId).readRemoteControlPairingStatus(params)
}

export async function listCodexRemoteControlClients(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).listRemoteControlClients(params)
}

export async function revokeCodexRemoteControlClient(
  janThreadId: string,
  clientId: string
) {
  return requireCodexSession(janThreadId).revokeRemoteControlClient({
    clientId,
  })
}

export async function readCodexConfig(janThreadId: string) {
  return requireCodexSession(janThreadId).readConfig()
}

export async function readCodexConfigRequirements(janThreadId: string) {
  return requireCodexSession(janThreadId).readConfigRequirements()
}

export async function detectCodexExternalAgentConfig(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).detectExternalAgentConfig(params)
}

export async function importCodexExternalAgentConfig(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).importExternalAgentConfig(params)
}

export async function writeCodexConfigValue(
  janThreadId: string,
  keyPath: string | string[],
  value: unknown
) {
  return callCodexAppServer(janThreadId, 'config/value/write', {
    keyPath,
    value,
  })
}

export async function writeCodexConfigBatch(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).batchWriteConfig(params)
}

export async function startCodexWindowsSandbox(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).startWindowsSandboxSetup(params)
}

export async function readCodexWindowsSandboxReadiness(janThreadId: string) {
  return requireCodexSession(janThreadId).requestAppServer(
    'windowsSandbox/readiness'
  )
}

export async function startCodexFuzzyFileSearchSession(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'fuzzyFileSearch/sessionStart',
    params
  )
}

export async function updateCodexFuzzyFileSearchSession(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'fuzzyFileSearch/sessionUpdate',
    params
  )
}

export async function stopCodexFuzzyFileSearchSession(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'fuzzyFileSearch/sessionStop',
    params
  )
}

export async function listCodexPluginShares(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'plugin/share/list',
    params
  )
}

export async function checkoutCodexPluginShare(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'plugin/share/checkout',
    params
  )
}

export async function updateCodexPluginShareTargets(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'plugin/share/updateTargets',
    params
  )
}

export async function deleteCodexPluginShare(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'plugin/share/delete',
    params
  )
}

export async function saveCodexPluginShare(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'plugin/share/save',
    params
  )
}

export async function runCodexMockExperimentalMethod(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return requireCodexSession(janThreadId).requestAppServer(
    'mock/experimentalMethod',
    params
  )
}

export async function uploadCodexFeedback(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).uploadFeedback(params)
}

export async function readCodexMcpResource(
  janThreadId: string,
  params: Record<string, unknown>
) {
  return requireCodexSession(janThreadId).readMcpResource(params)
}

export async function callCodexMcpTool(
  janThreadId: string,
  params: CodexMcpToolCallParams
) {
  return requireCodexSession(janThreadId).callMcpTool(params)
}

export async function reloadCodexMcpConfig(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  return callCodexAppServer(janThreadId, 'config/mcpServer/reload', params)
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
 * Bridges non-interactive / diagnostic CLI features into Jan Studio.
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

export async function runCodexCliProto(input?: {
  args?: string[]
} & CodexCliSubcommandInput) {
  return runCodexCliNamedCommand({
    command: input?.command,
    subcommand: 'proto',
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
  janThreadId: string,
  primaryMethod: string,
  params: Record<string, unknown> = {}
) {
  const fallbackMethod = CODEX_APP_SERVER_METHOD_FALLBACKS[primaryMethod]
  if (!fallbackMethod) {
    return requireCodexSession(janThreadId).requestAppServer(
      primaryMethod,
      params
    ) as T
  }
  return requestAppServerMethodWithFallback(
    janThreadId,
    primaryMethod,
    fallbackMethod,
    params
  )
}

async function requestAppServerMethodWithFallback<T>(
  janThreadId: string,
  primaryMethod: string,
  fallbackMethod: string,
  params: Record<string, unknown> = {}
) {
  try {
    return (await requireCodexSession(janThreadId).requestAppServer(
      primaryMethod,
      params
    )) as T
  } catch (error) {
    if (looksLikeMissingMethodError(error)) {
      return (await requireCodexSession(janThreadId).requestAppServer(
        fallbackMethod,
        params
      )) as T
    }
    throw error
  }
}

// Generic escape hatch for other advanced app-server calls surfaced in the client
// (remoteControl/*, marketplace/*, collaborationMode, environment, apps, config read/write, etc.)
export async function callCodexAppServer(janThreadId: string, method: string, params?: Record<string, unknown>) {
  return requestCodexAppServerMethodWithFallback(
    janThreadId,
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

function resolveCodexStartupModel(
  provider: ModelProvider,
  requestedModel: Model
): Model {
  const available = provider.models ?? []
  if (available.some((candidate) => candidate.id === requestedModel.id)) {
    return requestedModel
  }

  const fallback =
    available.find((candidate) => candidate.id === CODEX_FALLBACK_MODEL_ID) ??
    available.find((candidate) => candidate.active) ??
    available[0]

  if (!fallback) {
    return requestedModel
  }

  if (requestedModel.id !== fallback.id) {
    console.warn(
      `[Codex] Selected model '${requestedModel.id}' is not available for provider '${provider.provider}'; falling back to '${fallback.id}'.`
    )
  }

  return fallback
}

function resolveCodexStartupModelId(
  provider: ModelProvider,
  requestedModelId: string
): string {
  const available = provider.models ?? []
  const requested = requestedModelId.trim()
  if (available.some((candidate) => candidate.id === requested)) return requested

  const fallback =
    available.find((candidate) => candidate.id === CODEX_FALLBACK_MODEL_ID) ??
    available.find((candidate) => candidate.active) ??
    available[0]

  if (!fallback) return requestedModelId

  if (requested !== fallback.id) {
    console.warn(
      `[Codex] Requested model '${requested}' is not available for provider '${provider.provider}'; using '${fallback.id}'.`
    )
  }

  return fallback.id
}


export type BuildCodexSessionOptionsOverrides = {
  apiKeyOverride?: string
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
  const targetProvider = resolveCodexTargetProvider(provider, model, activeProfile)
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

export function buildCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model,
  overrides: BuildCodexSessionOptionsOverrides & {
    targetProvider?: string
    activeProfile?: ReturnType<
      typeof useCodexProviderProfiles.getState
    >['profiles'][string]
  } = {}
): CodexSessionOptions {
  const modelProviderState = useModelProvider.getState()
  const activeProfile =
    overrides.activeProfile ??
    (useCodexProviderProfiles.getState().activeProfileId
      ? useCodexProviderProfiles.getState().profiles[
          useCodexProviderProfiles.getState().activeProfileId!
        ]
      : undefined)
  const codexSettingsProvider =
    provider.provider === CODEX_APP_SERVER_PROVIDER_ID
      ? provider
      : modelProviderState.getProviderByName(CODEX_APP_SERVER_PROVIDER_ID) ??
        provider
  const usesCodexSettingsProvider =
    provider.provider === CODEX_APP_SERVER_PROVIDER_ID

  const targetProvider =
    overrides.targetProvider ??
    resolveCodexTargetProvider(provider, model, activeProfile)
  if (provider.provider === CODEX_APP_SERVER_PROVIDER_ID && !activeProfile) {
    return {
      codexBinaryPath:
        settingValue(codexSettingsProvider, 'codex-binary-path') ||
        defaultCodexBinaryPath(),
      codexHome: resolveAppCodexHome(),
      transport: normalizeCodexTransport(
        settingValue(codexSettingsProvider, 'codex-transport')
      ),
      cwd: resolveCodexWorkspaceDir(threadId),
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      mcpRefreshConfig: {
        mcp_servers: buildCodexMcpServersConfig(useMCPServers.getState().mcpServers, {
          toolTimeoutSeconds: useMCPServers.getState().settings.toolCallTimeoutSeconds,
        }),
        mcp_oauth_credentials_store_mode: 'auto',
      },
      ...buildJanGatewayCodexConfig(resolveCodexStartupModelId(provider, model.id)),
    }
  }
  const codexConfigProvider = codexManagedProviderId(targetProvider)

  const baseUrl = activeProfile
    ? activeProfile.baseUrl
    : usesCodexSettingsProvider && !isGrokModelId(model.id)
      ? settingValue(provider, 'base-url') ||
        provider.base_url ||
        defaultBaseUrlForProvider(targetProvider)
      : targetProvider === 'xai'
        ? resolveXaiBaseUrl(provider, modelProviderState)
        : provider.base_url ||
          settingValue(provider, 'base-url') ||
          defaultBaseUrlForProvider(targetProvider)

  let apiKey = overrides.apiKeyOverride
  if (apiKey === undefined) {
    if (activeProfile) {
      const mappedProviderName = mapProfileProviderType(
        activeProfile.providerType
      )
      const janProvider =
        modelProviderState.getProviderByName(mappedProviderName)
      apiKey =
        janProvider?.api_key ||
        (janProvider ? settingValue(janProvider, 'api-key') : '')
    } else {
      const authProvider = resolveCodexAuthProvider(
        targetProvider,
        provider,
        modelProviderState
      )
      apiKey =
        authProvider.api_key || settingValue(authProvider, 'api-key')
    }
  }

  const codexBinaryPath =
    settingValue(codexSettingsProvider, 'codex-binary-path') ||
    defaultCodexBinaryPath()
  const transport = normalizeCodexTransport(
    activeProfile?.transport ||
      settingValue(codexSettingsProvider, 'codex-transport')
  )
  const cwd = resolveCodexWorkspaceDir(threadId)
  const codexHome = resolveAppCodexHome(activeProfile?.codexHome)
  const configuredApiKeyEnv = activeProfile?.apiKeyEnv?.trim() || undefined
  const envKey =
    configuredApiKeyEnv || (apiKey ? 'JAN_CODEX_PROVIDER_API_KEY' : undefined)
  const { mcpServers, settings: mcpSettings } = useMCPServers.getState()
  const rawTargetModel =
    (activeProfile && activeProfile.model.trim()) || model.id
  const modelId = resolveCodexStartupModelId(provider, rawTargetModel)
  const targetModel =
    targetProvider === 'xai'
      ? resolveXaiRuntimeModelId(modelId)
      : modelId
  const approvalPolicy: CodexSessionOptions['approvalPolicy'] =
    activeProfile?.approvalPolicy || 'on-request'
  const sandbox: CodexSessionOptions['sandbox'] =
    activeProfile?.sandbox || 'workspace-write'
  const agentsMd = activeProfile?.agentsMd
  const subagentMaxThreads = activeProfile?.subagentMaxThreads
  const subagentMaxDepth = activeProfile?.subagentMaxDepth
  const permissionProfile = activeProfile?.permissionProfile
  const addDirs = activeProfile?.addDirs
  const customAgents = activeProfile?.customAgents
  const advancedConfigSnippet = activeProfile?.advancedConfigSnippet

  return {
    codexBinaryPath,
    codexHome,
    transport,
    cwd,
    model: targetModel,
    modelProvider: codexConfigProvider,
    approvalPolicy,
    sandbox,
    agentsMd,
    subagentMaxThreads,
    subagentMaxDepth,
    permissionProfile,
    addDirs,
    customAgents,
    advancedConfigSnippet,
    configToml: buildCodexConfigToml({
      model: targetModel,
      modelProvider: codexConfigProvider,
      modelContextWindow: codexModelContextWindowForModel(targetModel),
      modelReasoningEffort:
        targetProvider === 'xai' &&
        !xaiModelSupportsReasoningEffort(modelId)
          ? 'none'
          : undefined,
      providers: [
        {
          id: codexConfigProvider,
          name: targetProvider,
          baseUrl,
          apiKeyEnvVar: envKey,
          wireApi: codexWireApiForProvider(targetProvider),
        },
      ],
      mcpServers,
      mcpToolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      agents:
        subagentMaxThreads || subagentMaxDepth
          ? { max_threads: subagentMaxThreads, max_depth: subagentMaxDepth }
          : undefined,
      defaultPermissions: permissionProfile,
      advancedConfigSnippet: activeProfile?.advancedConfigSnippet,
    } as import('./config').CodexConfigTomlOptions),
    mcpRefreshConfig: {
      mcp_servers: buildCodexMcpServersConfig(mcpServers, {
        toolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      }),
      mcp_oauth_credentials_store_mode: 'auto',
    },
    env: apiKey && envKey ? { [envKey]: apiKey } : {},
  }
}

function buildJanGatewayCodexConfig(
  modelId: string
): {
  model: string
  modelProvider: string
  configToml: string
  env: Record<string, string | undefined>
} {
  const localApi = useLocalApiServer.getState()
  const baseUrl = buildLocalApiBaseUrl({
    host: localApi.serverHost,
    port: localApi.serverPort,
    prefix: localApi.apiPrefix,
  })
  const apiKey = localApi.apiKey.trim()

  return {
    model: modelId,
    modelProvider: CODEX_JAN_GATEWAY_PROVIDER_ID,
    configToml: buildCodexConfigToml({
      model: modelId,
      modelProvider: CODEX_JAN_GATEWAY_PROVIDER_ID,
      modelContextWindow: codexModelContextWindowForModel(modelId),
      providers: [
        {
          id: CODEX_JAN_GATEWAY_PROVIDER_ID,
          name: 'Jan Gateway',
          baseUrl,
          apiKeyEnvVar: apiKey ? CODEX_JAN_GATEWAY_API_KEY_ENV : undefined,
          wireApi: 'responses',
        },
      ],
      mcpServers: useMCPServers.getState().mcpServers,
      mcpToolTimeoutSeconds: useMCPServers.getState().settings.toolCallTimeoutSeconds,
    }),
    env: apiKey ? { [CODEX_JAN_GATEWAY_API_KEY_ENV]: apiKey } : {},
  }
}

function mapProfileProviderType(type: string): string {
  if (type === 'openai-compatible') return 'openai'
  if (type === 'llama-cpp') return 'llamacpp'
  if (type === 'xai') return 'xai'
  return type
}

function isGrokModelId(modelId: string): boolean {
  return /^grok(?:-|$)/i.test(modelId.trim())
}

function resolveCodexTargetProvider(
  provider: ModelProvider,
  model: Model,
  activeProfile?: {
    providerType: string
    model: string
  }
): string {
  const profileModel = activeProfile?.model.trim()
  if (activeProfile) {
    const mapped = mapProfileProviderType(activeProfile.providerType)
    if (
      isGrokModelId(profileModel || model.id) &&
      mapped === 'openai'
    ) {
      return 'xai'
    }
    return mapped
  }

  if (isGrokModelId(model.id) || provider.provider === 'xai') {
    return 'xai'
  }

  if (provider.provider === CODEX_APP_SERVER_PROVIDER_ID) {
    return settingValue(provider, 'codex-provider') || 'openai'
  }

  return provider.provider
}

function resolveCodexAuthProvider(
  targetProvider: string,
  selectedProvider: ModelProvider,
  modelProviderState: ReturnType<typeof useModelProvider.getState>
): ModelProvider {
  if (selectedProvider.provider === targetProvider) {
    return selectedProvider
  }
  return (
    modelProviderState.getProviderByName(targetProvider) ?? selectedProvider
  )
}

async function resolveCodexProviderApiKey(
  provider: ModelProvider
): Promise<string> {
  const keys = await providerRemoteAuthKeyChain(provider)
  if (keys[0]) return keys[0]
  return provider.api_key || settingValue(provider, 'api-key')
}

function resolveXaiBaseUrl(
  provider: ModelProvider,
  modelProviderState: ReturnType<typeof useModelProvider.getState>
): string {
  const xaiProvider =
    provider.provider === 'xai'
      ? provider
      : modelProviderState.getProviderByName('xai')
  if (xaiProvider) {
    return (
      xaiProvider.base_url ||
      settingValue(xaiProvider, 'base-url') ||
      'https://api.x.ai/v1'
    )
  }
  return 'https://api.x.ai/v1'
}

function codexModelContextWindowForModel(modelId: string): number | undefined {
  if (modelId === 'grok-4.3') return 1_000_000
  return undefined
}

const CODEX_RESERVED_PROVIDER_IDS = new Set([
  'openai',
  'openrouter',
  'ollama',
  'lmstudio',
])

function codexManagedProviderId(providerId: string): string {
  return CODEX_RESERVED_PROVIDER_IDS.has(providerId)
    ? `jan-${providerId}`
    : providerId
}

function normalizeCodexTransport(
  value?: string
): 'app-server' | 'proto' {
  return value === 'proto' ? 'proto' : 'app-server'
}

function resolveCodexWorkspaceDir(threadId: string) {
  const thread = useThreads.getState().threads[threadId]
  const projectId = thread?.metadata?.project?.id
  const directories = useWorkspaceDirectories.getState()
  if (projectId) {
    const projectDir = directories.getDirectory({
      type: 'project',
      id: projectId,
      label: thread?.metadata?.project?.name ?? 'Project',
    })
    if (projectDir) return projectDir
  }
  return (
    directories.getDirectory({
      type: 'chat',
      id: threadId,
      label: thread?.title ?? 'Chat',
    }) ?? './'
  )
}

function resolveAppCodexHome(profileCodexHome?: string) {
  const trimmed = profileCodexHome?.trim()
  return trimmed || './.jan/codex-home'
}

function settingValue(provider: ModelProvider, key: string) {
  const value = provider.settings.find((setting) => setting.key === key)
    ?.controller_props.value
  return typeof value === 'string' ? value.trim() : ''
}

function defaultCodexBinaryPath() {
  return IS_MACOS ? '/Applications/Codex.app/Contents/Resources/codex' : 'codex'
}

function defaultBaseUrlForProvider(providerId: string) {
  if (providerId === 'openai') return 'https://api.openai.com/v1'
  if (providerId === 'xai') return 'https://api.x.ai/v1'
  if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (providerId === 'ollama') return 'http://127.0.0.1:11434/v1'
  if (providerId === 'vllm') return 'http://127.0.0.1:8000/v1'
  if (JAN_HOSTED_LOCAL_PROVIDERS.has(providerId)) {
    const { serverHost, serverPort, apiPrefix } = useLocalApiServer.getState()
    return `http://${serverHost}:${serverPort}${apiPrefix}`
  }
  return 'https://api.openai.com/v1'
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
