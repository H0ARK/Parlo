import { describe, expect, it } from 'vitest'
import {
  formatSpikeReport,
  perProviderEnvName,
  spikeFixtureRoutes,
  spikeMergeRoutes,
} from '../multi-provider-spike'

describe('multi-provider spike (PR2.5)', () => {
  it('merges two concurrent routes into one TOML with distinct providers and union env', () => {
    const routes = spikeFixtureRoutes()
    const result = spikeMergeRoutes({ routes, mruIndex: 1 })

    expect(result.ok).toBe(true)
    expect(result.codexProviderIds).toEqual(['Parlo-ollama', 'xai'])
    expect(result.configToml).toContain('[model_providers.Parlo-ollama]')
    expect(result.configToml).toContain('[model_providers.xai]')
    expect(result.configToml).toContain('model = "grok-4.3"')
    expect(result.configToml).toContain('model_provider = "xai"')
    expect(result.configToml).toContain('wire_api = "chat"')
    expect(result.configToml).toContain('wire_api = "responses"')
    expect(result.env[perProviderEnvName('Parlo-ollama')]).toBe('ollama-key')
    expect(result.env[perProviderEnvName('xai')]).toBe('xai-key')

    const report = formatSpikeReport(result)
    expect(report).toContain('MULTI_PROVIDER_SPIKE PASS')
    // eslint-disable-next-line no-console
    console.log(report)
  })

  it('fails clearly when fewer than two routes are provided', () => {
    const result = spikeMergeRoutes({
      routes: [spikeFixtureRoutes()[0]],
    })
    expect(result.ok).toBe(false)
    expect(formatSpikeReport(result)).toContain('MULTI_PROVIDER_SPIKE FAIL')
  })

  it('last-writer wins when two routes share the same codexProviderId', () => {
    const [a, b] = spikeFixtureRoutes()
    const duplicate = {
      ...a,
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'second-key',
    }
    const result = spikeMergeRoutes({
      routes: [a, b, duplicate],
      mruIndex: 1,
    })
    expect(result.ok).toBe(true)
    expect(result.configToml).toContain('base_url = "http://127.0.0.1:9999/v1"')
    expect(result.env[perProviderEnvName('Parlo-ollama')]).toBe('second-key')
  })
})
