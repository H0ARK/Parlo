/** Providers whose models are loaded locally — not HTTP gateway upstreams. */
export const GATEWAY_SKIP_PROVIDERS = new Set(['llamacpp', 'mlx', 'codex'])

export type GatewayWireApi = 'chat' | 'responses'

/**
 * Same wire-API routing Codex uses (see chat-backend codexWireApiForProvider).
 * Keep gateway proxy and Codex app-server on one mapping.
 */
export function gatewayWireApiForProvider(providerId: string): GatewayWireApi {
  if (
    providerId === 'openai' ||
    providerId === 'openrouter' ||
    providerId === 'xai'
  ) {
    return 'responses'
  }
  return 'chat'
}

export function isGrokModelId(modelId: string): boolean {
  return /^grok(?:-|$)/i.test(modelId.trim())
}

/** Stale SuperGrok SSO catalog ids that xAI no longer serves on the Responses API. */
const STALE_XAI_MODEL_IDS = new Set(['grok-build-0.1'])

export const XAI_RUNTIME_MODEL_FALLBACK = 'grok-4.3'

/** Normalize xAI model ids for upstream/Codex (remaps deprecated SSO slugs). */
export function resolveXaiRuntimeModelId(modelId: string): string {
  const trimmed = modelId.trim()
  const bare = trimmed.includes('/')
    ? trimmed.slice(trimmed.indexOf('/') + 1)
    : trimmed
  if (STALE_XAI_MODEL_IDS.has(bare)) {
    return XAI_RUNTIME_MODEL_FALLBACK
  }
  return bare
}

/** xAI rejects `reasoningEffort` on some Grok SKUs (e.g. grok-build-0.1). */
export function xaiModelSupportsReasoningEffort(modelId: string): boolean {
  const trimmed = modelId.trim()
  const bare = trimmed.includes('/')
    ? trimmed.slice(trimmed.indexOf('/') + 1)
    : trimmed
  if (STALE_XAI_MODEL_IDS.has(bare)) return false
  return !/^grok-build(?:-|$)/i.test(bare)
}

/** Resolve upstream provider id from model + selected provider (Codex-aligned). */
export function resolveGatewayTargetProvider(
  providerId: string,
  modelId: string
): string {
  if (isGrokModelId(modelId) || providerId === 'xai') {
    return 'xai'
  }
  return providerId
}

function settingValue(provider: ModelProvider, key: string): string {
  const value = provider.settings?.find((s) => s.key === key)?.controller_props
    ?.value
  return typeof value === 'string' ? value.trim() : ''
}

/** Default OpenAI-compatible base URL for a provider (Codex-aligned). */
export function defaultGatewayBaseUrlForProvider(providerId: string): string {
  if (providerId === 'openai') return 'https://api.openai.com/v1'
  if (providerId === 'xai') return 'https://api.x.ai/v1'
  if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (providerId === 'ollama') return 'http://127.0.0.1:11434/v1'
  if (providerId === 'vllm') return 'http://127.0.0.1:8000/v1'
  return 'https://api.openai.com/v1'
}

/** Base URL registered for the local API gateway upstream. */
export function resolveGatewayProviderBaseUrl(provider: ModelProvider): string {
  const fromSettings = settingValue(provider, 'base-url')
  const trimmed = provider.base_url?.trim()
  return trimmed || fromSettings || defaultGatewayBaseUrlForProvider(provider.provider)
}