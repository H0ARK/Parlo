import { providerHasConfiguredRemoteAuth } from '@/lib/provider-api-keys'
import { DEFAULT_LOCAL_API_SERVER_API_KEY } from '@/hooks/useLocalApiServer'
import { GATEWAY_SKIP_PROVIDERS } from '@/lib/provider-gateway'

/** Providers handled inside Parlo — not registered as HTTP upstreams for the local API server. */
export const LOCAL_API_GATEWAY_SKIP_PROVIDERS = GATEWAY_SKIP_PROVIDERS

export {
  gatewayWireApiForProvider,
  resolveGatewayProviderBaseUrl,
} from '@/lib/provider-gateway'

export function isLocalApiGatewayUpstreamProvider(providerId: string): boolean {
  return !LOCAL_API_GATEWAY_SKIP_PROVIDERS.has(providerId)
}

/** OpenRouter-style model id: `provider/model`. */
export function formatGatewayModelId(provider: string, modelId: string): string {
  const prefix = `${provider}/`
  if (modelId.startsWith(prefix)) return modelId
  return `${provider}/${modelId}`
}

export function parseGatewayModelId(modelId: string): {
  provider: string | null
  modelId: string
} {
  const slash = modelId.indexOf('/')
  if (slash <= 0 || slash === modelId.length - 1) {
    return { provider: null, modelId }
  }
  return {
    provider: modelId.slice(0, slash),
    modelId: modelId.slice(slash + 1),
  }
}

export function gatewayBareModelId(modelId: string): string {
  return parseGatewayModelId(modelId).modelId
}

export function getGatewayUpstreamProviders(
  providers: ModelProvider[]
): ModelProvider[] {
  return providers.filter(
    (p) =>
      p.active &&
      isLocalApiGatewayUpstreamProvider(p.provider) &&
      providerHasConfiguredRemoteAuth(p)
  )
}

export function hasGatewayUpstreamProviders(
  providers: ModelProvider[]
): boolean {
  return getGatewayUpstreamProviders(providers).length > 0
}

export function buildLocalApiBaseUrl(params: {
  host: string
  port: number
  prefix: string
}): string {
  const prefix = params.prefix.startsWith('/')
    ? params.prefix
    : `/${params.prefix}`
  return `http://${params.host}:${params.port}${prefix}`
}

export function buildGatewayCurlExample(params: {
  baseUrl: string
  apiKey: string
  modelId: string
}): string {
  const key = params.apiKey.trim() || DEFAULT_LOCAL_API_SERVER_API_KEY
  return [
    `curl ${params.baseUrl}/chat/completions \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Authorization: Bearer ${key}" \\`,
    "  -d '{",
    `    "model": "${params.modelId}",`,
    '    "messages": [{"role": "user", "content": "Hello"}]',
    "  }'",
  ].join('\n')
}