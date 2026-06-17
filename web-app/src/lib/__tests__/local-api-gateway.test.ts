import { describe, it, expect } from 'vitest'
import {
  buildGatewayCurlExample,
  buildLocalApiBaseUrl,
  formatGatewayModelId,
  gatewayBareModelId,
  getGatewayUpstreamProviders,
  hasGatewayUpstreamProviders,
  isLocalApiGatewayUpstreamProvider,
  parseGatewayModelId,
} from '../local-api-gateway'

const makeProvider = (
  name: string,
  opts?: Partial<ModelProvider>
): ModelProvider =>
  ({
    provider: name,
    active: true,
    models: [{ id: 'model-a' }],
    api_key: 'sk-test',
    ...opts,
  }) as ModelProvider

describe('local-api-gateway', () => {
  it('skips local runtime providers from upstream registration', () => {
    expect(isLocalApiGatewayUpstreamProvider('openai')).toBe(true)
    expect(isLocalApiGatewayUpstreamProvider('llamacpp')).toBe(false)
    expect(isLocalApiGatewayUpstreamProvider('mlx')).toBe(false)
    expect(isLocalApiGatewayUpstreamProvider('codex')).toBe(false)
  })

  it('detects configured remote providers for gateway mode', () => {
    const providers = [
      makeProvider('openai'),
      makeProvider('codex', { api_key: 'x' }),
      makeProvider('anthropic', { active: false, api_key: 'x' }),
      makeProvider('xai', { api_key: undefined }),
    ]
    expect(hasGatewayUpstreamProviders(providers)).toBe(true)
    expect(getGatewayUpstreamProviders(providers).map((p) => p.provider)).toEqual([
      'openai',
    ])
  })

  it('formats and parses provider/model ids', () => {
    expect(formatGatewayModelId('xai', 'grok-4.3')).toBe('xai/grok-4.3')
    expect(formatGatewayModelId('xai', 'xai/grok-4.3')).toBe('xai/grok-4.3')
    expect(parseGatewayModelId('xai/grok-4.3')).toEqual({
      provider: 'xai',
      modelId: 'grok-4.3',
    })
    expect(gatewayBareModelId('openai/gpt-4o')).toBe('gpt-4o')
  })

  it('builds base URL and curl example', () => {
    const baseUrl = buildLocalApiBaseUrl({
      host: '127.0.0.1',
      port: 1337,
      prefix: '/v1',
    })
    expect(baseUrl).toBe('http://127.0.0.1:1337/v1')
    expect(
      buildGatewayCurlExample({
        baseUrl,
        apiKey: 'jan-key',
        modelId: 'gpt-4o',
      })
    ).toContain('Authorization: Bearer jan-key')
    expect(
      buildGatewayCurlExample({
        baseUrl,
        apiKey: '',
        modelId: 'xai/grok-4.3',
      })
    ).toContain('Authorization: Bearer 1234')
  })
})