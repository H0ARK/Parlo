import { describe, expect, it, vi } from 'vitest'
import {
  assertEngineEndpointReady,
  probeOpenAiModelsEndpoint,
} from '../engine-readiness'

describe('engine-readiness (PR5)', () => {
  it('succeeds when /models returns 200 with data array', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
    )
    const result = await probeOpenAiModelsEndpoint({
      baseUrl: 'http://127.0.0.1:1337/v1/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
    })
    expect(result.ok).toBe(true)
    expect(result.baseUrl).toBe('http://127.0.0.1:1337/v1')
    expect(result.modelCount).toBe(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1337/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('retries on failure then fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused')
    })
    const result = await probeOpenAiModelsEndpoint({
      baseUrl: 'http://127.0.0.1:9/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 3,
      backoffMs: 1,
      timeoutMs: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('assertEngineEndpointReady throws with projected URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }))
    await expect(
      assertEngineEndpointReady({
        baseUrl: 'http://127.0.0.1:1337/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retries: 1,
      })
    ).rejects.toThrow(/1337\/v1\/models/)
  })
})
