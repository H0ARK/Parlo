/**
 * Universal model → Codex projection (DESIGN_CODEX_HOST §2).
 *
 * Product defaults preserve legacy behavior:
 * - preferGatewayForRemotes = false (direct remotes)
 * - perProviderEnvKeys = false (legacy PARLO_CODEX_PROVIDER_API_KEY last-writer)
 * - multiProviderMerge = false (single provider row per prepare)
 */

import { useThreads } from '@/hooks/useThreads'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useWorkspaceDirectories } from '@/stores/workspace-directory-store'
import {
  useCodexProviderProfiles,
  type CodexProviderProfile,
} from '@/stores/codex-provider-profile-store'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { buildLocalApiBaseUrl } from '@/lib/local-api-gateway'
import { providerRemoteAuthKeyChain } from '@/lib/provider-api-keys'
import {
  gatewayWireApiForProvider,
  isGrokModelId,
  resolveXaiRuntimeModelId,
  xaiModelSupportsReasoningEffort,
} from '@/lib/provider-gateway'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'
import { buildCodexConfigToml } from './config'
import { buildCodexMcpServersConfig } from './mcp-config-bridge'
import type { CodexSessionOptions } from './types'

export const CODEX_APP_SERVER_PROVIDER_ID = 'codex'
export const CODEX_FALLBACK_MODEL_ID = 'gpt-5.5'
export const CODEX_PARLO_GATEWAY_PROVIDER_ID = 'Parlo-gateway'
export const CODEX_PARLO_GATEWAY_API_KEY_ENV = 'PARLO_LOCAL_API_SERVER_API_KEY'
/** Legacy single-key env name when perProviderEnvKeys is false. */
export const CODEX_LEGACY_PROVIDER_API_KEY_ENV = 'PARLO_CODEX_PROVIDER_API_KEY'

export const PARLO_HOSTED_LOCAL_PROVIDERS = new Set(['llamacpp', 'mlx'])

const CODEX_RESERVED_PROVIDER_IDS = new Set([
  'openai',
  'openrouter',
  'ollama',
  'lmstudio',
])

export type CodexWireApi = 'chat' | 'responses'

/** Endpoint + auth projection for one Parlo-selected model. */
export type ModelRoute = {
  parloProviderId: string
  /** Codex [model_providers.<id>] key — reserved ids get Parlo- prefix */
  codexProviderId: string
  modelId: string
  baseUrl: string
  wireApi: CodexWireApi
  apiKeyEnvVar?: string
  apiKey?: string
  modelReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high'
  modelContextWindow?: number
  requiresLocalEngine: boolean
  useGateway: boolean
  source: 'direct' | 'profile' | 'gateway' | 'local-engine'
  authSource?: 'api-key' | 'xai-oauth' | 'profile-mapped' | 'local-api' | 'none'
  /** Provider display name written into TOML `name` field */
  providerDisplayName: string
}

/**
 * Process-global / profile policy fields. Concurrent threads share one snapshot.
 */
export type SessionPolicy = {
  approvalPolicy: NonNullable<CodexSessionOptions['approvalPolicy']>
  sandbox: NonNullable<CodexSessionOptions['sandbox']>
  permissionProfile?: string
  agentsMd?: string
  customAgents?: CodexSessionOptions['customAgents']
  advancedConfigSnippet?: string
  subagentMaxThreads?: number
  subagentMaxDepth?: number
  addDirs?: string[]
  codexBinaryPath: string
  /** Shared app CODEX_HOME (profile override still applied for legacy parity until KD18 cleanup). */
  codexHome: string
}

export type BuildModelRouteOverrides = {
  apiKeyOverride?: string
  targetProvider?: string
  activeProfile?: CodexProviderProfile
  /** When true, use per-provider env names even if host flag is off (tests). */
  forcePerProviderEnvKeys?: boolean
}

export function codexManagedProviderId(providerId: string): string {
  return CODEX_RESERVED_PROVIDER_IDS.has(providerId)
    ? `Parlo-${providerId}`
    : providerId
}

export function perProviderEnvName(codexProviderId: string): string {
  const slug = codexProviderId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  return `PARLO_CODEX_PROVIDER_API_KEY_${slug}`
}

export function mapProfileProviderType(type: string): string {
  if (type === 'openai-compatible') return 'openai'
  if (type === 'llama-cpp') return 'llamacpp'
  if (type === 'xai') return 'xai'
  return type
}

export function settingValue(provider: ModelProvider, key: string): string {
  const value = provider.settings.find((setting) => setting.key === key)
    ?.controller_props.value
  return typeof value === 'string' ? value.trim() : ''
}

export function defaultCodexBinaryPath(): string {
  return IS_MACOS ? '/Applications/Codex.app/Contents/Resources/codex' : 'codex'
}

export function defaultBaseUrlForProvider(providerId: string): string {
  if (providerId === 'openai') return 'https://api.openai.com/v1'
  if (providerId === 'xai') return 'https://api.x.ai/v1'
  if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (providerId === 'ollama') return 'http://127.0.0.1:11434/v1'
  if (providerId === 'vllm') return 'http://127.0.0.1:8000/v1'
  if (PARLO_HOSTED_LOCAL_PROVIDERS.has(providerId)) {
    const { serverHost, serverPort, apiPrefix } = useLocalApiServer.getState()
    return `http://${serverHost}:${serverPort}${apiPrefix}`
  }
  return 'https://api.openai.com/v1'
}

export function resolveAppCodexHome(profileCodexHome?: string): string {
  const trimmed = profileCodexHome?.trim()
  return trimmed || './.Parlo/codex-home'
}

export function resolveCodexWorkspaceDir(threadId: string): string {
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

export function resolveCodexStartupModelId(
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

export function resolveCodexStartupModel(
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

export function resolveCodexTargetProvider(
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
    if (isGrokModelId(profileModel || model.id) && mapped === 'openai') {
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

export function resolveCodexAuthProvider(
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

export async function resolveCodexProviderApiKey(
  provider: ModelProvider
): Promise<string> {
  const keys = await providerRemoteAuthKeyChain(provider)
  if (keys[0]?.trim()) return keys[0].trim()
  const fromSettings =
    provider.api_key?.trim() || settingValue(provider, 'api-key')
  return fromSettings
}

/**
 * Resolve remote auth for Codex projection. Distinguishes xAI SSO vs API key
 * so we can fail with an actionable message when SSO is expected but missing.
 */
export async function resolveCodexRemoteAuth(provider: ModelProvider): Promise<{
  token: string
  source: 'api-key' | 'xai-oauth' | 'none'
}> {
  // Prefer full credentials helper when available (source tagging for SSO).
  try {
    const mod = await import('@/lib/provider-api-keys')
    if (typeof mod.providerRemoteAuthCredentials === 'function') {
      const credentials = await mod.providerRemoteAuthCredentials(provider)
      if (credentials[0]?.key?.trim()) {
        return {
          token: credentials[0].key.trim(),
          source: credentials[0].source,
        }
      }
    } else if (typeof mod.providerRemoteAuthKeyChain === 'function') {
      const keys = await mod.providerRemoteAuthKeyChain(provider)
      if (keys[0]?.trim()) {
        return {
          token: keys[0].trim(),
          source:
            provider.provider === 'xai' ? 'xai-oauth' : 'api-key',
        }
      }
    }
  } catch {
    // fall through to settings
  }
  const fromSettings =
    provider.api_key?.trim() || settingValue(provider, 'api-key')
  if (fromSettings) {
    return { token: fromSettings, source: 'api-key' }
  }
  return { token: '', source: 'none' }
}

export function codexModelContextWindowForModel(
  modelId: string
): number | undefined {
  const bare = modelId.includes('/')
    ? modelId.slice(modelId.indexOf('/') + 1)
    : modelId
  // Grok 4 family is advertised with large context; Codex uses this when it
  // has no built-in model metadata (e.g. grok-4.5).
  if (/^grok-4(?:\.|$)/i.test(bare) || /^grok-4-/i.test(bare)) {
    return 1_000_000
  }
  return undefined
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

function localApiGatewayFields(): {
  baseUrl: string
  apiKey: string
  apiKeyEnvVar?: string
} {
  const localApi = useLocalApiServer.getState()
  const baseUrl = buildLocalApiBaseUrl({
    host: localApi.serverHost,
    port: localApi.serverPort,
    prefix: localApi.apiPrefix,
  })
  const apiKey = localApi.apiKey.trim()
  return {
    baseUrl,
    apiKey,
    apiKeyEnvVar: apiKey ? CODEX_PARLO_GATEWAY_API_KEY_ENV : undefined,
  }
}

/**
 * Build ModelRoute using the same decision tree as historical
 * buildCodexSessionOptions (gateway for bare codex; direct for other providers).
 * preferGatewayForRemotes is reserved for PR3+ step-3 collapse (default off = no-op).
 */
export function buildModelRoute(
  provider: ModelProvider,
  model: Model,
  overrides: BuildModelRouteOverrides = {}
): ModelRoute {
  const modelProviderState = useModelProvider.getState()
  const activeProfile =
    overrides.activeProfile ??
    (useCodexProviderProfiles.getState().activeProfileId
      ? useCodexProviderProfiles.getState().profiles[
          useCodexProviderProfiles.getState().activeProfileId!
        ]
      : undefined)

  const usesCodexSettingsProvider =
    provider.provider === CODEX_APP_SERVER_PROVIDER_ID

  // Step 1 / bare codex + no profile → GatewayCollapse (legacy default)
  if (provider.provider === CODEX_APP_SERVER_PROVIDER_ID && !activeProfile) {
    const modelId = resolveCodexStartupModelId(provider, model.id)
    const gateway = localApiGatewayFields()
    return {
      parloProviderId: CODEX_APP_SERVER_PROVIDER_ID,
      codexProviderId: CODEX_PARLO_GATEWAY_PROVIDER_ID,
      modelId,
      baseUrl: gateway.baseUrl,
      wireApi: 'responses',
      apiKeyEnvVar: gateway.apiKeyEnvVar,
      apiKey: gateway.apiKey || undefined,
      modelContextWindow: codexModelContextWindowForModel(modelId),
      requiresLocalEngine: false,
      useGateway: true,
      source: 'gateway',
      authSource: gateway.apiKey ? 'local-api' : 'none',
      providerDisplayName: 'Parlo Gateway',
    }
  }

  const targetProvider =
    overrides.targetProvider ??
    resolveCodexTargetProvider(provider, model, activeProfile)

  const rawTargetModel =
    (activeProfile && activeProfile.model.trim()) || model.id
  const modelIdRaw = resolveCodexStartupModelId(provider, rawTargetModel)
  const modelId =
    targetProvider === 'xai'
      ? resolveXaiRuntimeModelId(modelIdRaw)
      : modelIdRaw

  const usePerProviderEnv =
    overrides.forcePerProviderEnvKeys === true ||
    useCodexHostFlags.getState().perProviderEnvKeys

  // Profile branch
  if (activeProfile) {
    const codexProviderId = codexManagedProviderId(targetProvider)
    const baseUrl = activeProfile.baseUrl
    let apiKey = overrides.apiKeyOverride
    if (apiKey === undefined) {
      const mappedProviderName = mapProfileProviderType(
        activeProfile.providerType
      )
      const parloProvider =
        modelProviderState.getProviderByName(mappedProviderName)
      apiKey =
        parloProvider?.api_key ||
        (parloProvider ? settingValue(parloProvider, 'api-key') : '') ||
        undefined
    }
    const configuredApiKeyEnv = activeProfile.apiKeyEnv?.trim() || undefined
    const apiKeyEnvVar =
      configuredApiKeyEnv ||
      (apiKey
        ? usePerProviderEnv
          ? perProviderEnvName(codexProviderId)
          : CODEX_LEGACY_PROVIDER_API_KEY_ENV
        : undefined)

    return {
      parloProviderId: provider.provider,
      codexProviderId,
      modelId,
      baseUrl,
      wireApi: gatewayWireApiForProvider(targetProvider),
      apiKeyEnvVar,
      apiKey: apiKey || undefined,
      modelReasoningEffort:
        targetProvider === 'xai' &&
        !xaiModelSupportsReasoningEffort(modelIdRaw)
          ? 'none'
          : undefined,
      modelContextWindow: codexModelContextWindowForModel(modelId),
      requiresLocalEngine: PARLO_HOSTED_LOCAL_PROVIDERS.has(targetProvider),
      useGateway: false,
      source: 'profile',
      authSource: apiKey ? 'profile-mapped' : 'none',
      providerDisplayName: targetProvider,
    }
  }

  // Local engines (llamacpp / mlx) — distinct codex provider ids, local API base
  if (PARLO_HOSTED_LOCAL_PROVIDERS.has(provider.provider)) {
    const baseUrl =
      provider.base_url ||
      settingValue(provider, 'base-url') ||
      defaultBaseUrlForProvider(provider.provider)
    let apiKey = overrides.apiKeyOverride
    if (apiKey === undefined) {
      apiKey =
        provider.api_key || settingValue(provider, 'api-key') || undefined
    }
    const codexProviderId = provider.provider
    const apiKeyEnvVar = apiKey
      ? usePerProviderEnv
        ? perProviderEnvName(codexProviderId)
        : CODEX_LEGACY_PROVIDER_API_KEY_ENV
      : undefined

    return {
      parloProviderId: provider.provider,
      codexProviderId,
      modelId,
      baseUrl,
      wireApi: 'chat',
      apiKeyEnvVar,
      apiKey: apiKey || undefined,
      modelContextWindow: codexModelContextWindowForModel(modelId),
      requiresLocalEngine: true,
      useGateway: false,
      source: 'local-engine',
      authSource: apiKey ? 'api-key' : 'none',
      providerDisplayName: provider.provider,
    }
  }

  // Direct remote / other providers
  const codexProviderId = codexManagedProviderId(targetProvider)
  const baseUrl =
    usesCodexSettingsProvider && !isGrokModelId(model.id)
      ? settingValue(provider, 'base-url') ||
        provider.base_url ||
        defaultBaseUrlForProvider(targetProvider)
      : targetProvider === 'xai'
        ? resolveXaiBaseUrl(provider, modelProviderState)
        : provider.base_url ||
          settingValue(provider, 'base-url') ||
          defaultBaseUrlForProvider(targetProvider)

  // Prefer async-resolved override (incl. xAI SSO access token). Empty string = missing.
  let apiKey = overrides.apiKeyOverride?.trim() || undefined
  if (apiKey === undefined) {
    const authProvider = resolveCodexAuthProvider(
      targetProvider,
      provider,
      modelProviderState
    )
    const syncKey =
      authProvider.api_key?.trim() ||
      settingValue(authProvider, 'api-key') ||
      ''
    apiKey = syncKey || undefined
  }

  const apiKeyEnvVar = apiKey
    ? usePerProviderEnv
      ? perProviderEnvName(codexProviderId)
      : CODEX_LEGACY_PROVIDER_API_KEY_ENV
    : undefined

  return {
    parloProviderId: provider.provider,
    codexProviderId,
    modelId,
    baseUrl,
    wireApi: gatewayWireApiForProvider(targetProvider),
    apiKeyEnvVar,
    apiKey,
    modelReasoningEffort:
      targetProvider === 'xai' && !xaiModelSupportsReasoningEffort(modelIdRaw)
        ? 'none'
        : undefined,
    modelContextWindow: codexModelContextWindowForModel(modelId),
    requiresLocalEngine: false,
    useGateway: false,
    source: 'direct',
    // When override is present we cannot know SSO vs key here; chat-backend marks SSO.
    authSource: apiKey ? 'api-key' : 'none',
    providerDisplayName: targetProvider,
  }
}

export function buildSessionPolicy(
  provider: ModelProvider,
  overrides: BuildModelRouteOverrides = {}
): SessionPolicy {
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

  const codexBinaryPath =
    settingValue(codexSettingsProvider, 'codex-binary-path') ||
    defaultCodexBinaryPath()

  return {
    approvalPolicy: activeProfile?.approvalPolicy || 'on-request',
    sandbox: activeProfile?.sandbox || 'workspace-write',
    permissionProfile: activeProfile?.permissionProfile,
    agentsMd: activeProfile?.agentsMd,
    customAgents: activeProfile?.customAgents,
    advancedConfigSnippet: activeProfile?.advancedConfigSnippet,
    subagentMaxThreads: activeProfile?.subagentMaxThreads,
    subagentMaxDepth: activeProfile?.subagentMaxDepth,
    addDirs: activeProfile?.addDirs,
    codexBinaryPath,
    codexHome: resolveAppCodexHome(activeProfile?.codexHome),
  }
}

export function modelRouteToEnv(
  route: ModelRoute
): Record<string, string | undefined> {
  if (route.apiKey && route.apiKeyEnvVar) {
    return { [route.apiKeyEnvVar]: route.apiKey }
  }
  return {}
}

/**
 * Project ModelRoute + SessionPolicy + thread workspace into CodexSessionOptions
 * (single-provider TOML — multi-provider merge is PR4).
 */
export function buildCodexSessionOptionsFromRoute(
  threadId: string,
  route: ModelRoute,
  policy: SessionPolicy
): CodexSessionOptions {
  const { mcpServers, settings: mcpSettings } = useMCPServers.getState()
  const cwd = resolveCodexWorkspaceDir(threadId)

  return {
    codexBinaryPath: policy.codexBinaryPath,
    codexHome: policy.codexHome,
    transport: 'app-server',
    cwd,
    model: route.modelId,
    modelProvider: route.codexProviderId,
    approvalPolicy: policy.approvalPolicy,
    sandbox: policy.sandbox,
    agentsMd: policy.agentsMd,
    subagentMaxThreads: policy.subagentMaxThreads,
    subagentMaxDepth: policy.subagentMaxDepth,
    permissionProfile: policy.permissionProfile,
    addDirs: policy.addDirs,
    customAgents: policy.customAgents,
    advancedConfigSnippet: policy.advancedConfigSnippet,
    configToml: buildCodexConfigToml({
      model: route.modelId,
      modelProvider: route.codexProviderId,
      modelContextWindow: route.modelContextWindow,
      modelReasoningEffort: route.modelReasoningEffort,
      providers: [
        {
          id: route.codexProviderId,
          name: route.providerDisplayName,
          baseUrl: route.baseUrl,
          apiKeyEnvVar: route.apiKeyEnvVar,
          wireApi: route.wireApi,
        },
      ],
      mcpServers,
      mcpToolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      agents:
        policy.subagentMaxThreads || policy.subagentMaxDepth
          ? {
              max_threads: policy.subagentMaxThreads,
              max_depth: policy.subagentMaxDepth,
            }
          : undefined,
      defaultPermissions: policy.permissionProfile,
      advancedConfigSnippet: policy.advancedConfigSnippet,
    }),
    mcpRefreshConfig: {
      mcp_servers: buildCodexMcpServersConfig(mcpServers, {
        toolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      }),
      mcp_oauth_credentials_store_mode: 'auto',
    },
    env: modelRouteToEnv(route),
  }
}

export type BuildCodexSessionOptionsOverrides = {
  apiKeyOverride?: string
  targetProvider?: string
  activeProfile?: CodexProviderProfile
}

/**
 * Primary entry used by chat-backend: build session options from selection.
 * Behavior matches pre-extraction buildCodexSessionOptions at product defaults.
 * Lease / union-env / multi-provider merge is applied by chat-backend via config-lease.
 */
export function buildCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model,
  overrides: BuildCodexSessionOptionsOverrides = {}
): CodexSessionOptions {
  const route = buildModelRoute(provider, model, overrides)
  const policy = buildSessionPolicy(provider, overrides)
  return buildCodexSessionOptionsFromRoute(threadId, route, policy)
}

/** Build route + policy without composing session options (for lease registration). */
export function buildRouteAndPolicy(
  provider: ModelProvider,
  model: Model,
  overrides: BuildCodexSessionOptionsOverrides = {}
): { route: ModelRoute; policy: SessionPolicy } {
  return {
    route: buildModelRoute(provider, model, overrides),
    policy: buildSessionPolicy(provider, overrides),
  }
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
