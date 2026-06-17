import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: vi.fn(),
  },
}))

vi.mock('@/utils/getModelToStart', () => ({
  getModelToStart: vi.fn(),
}))

vi.mock('@/lib/local-api-gateway', () => ({
  hasGatewayUpstreamProviders: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  isLocalProvider: vi.fn((provider: string) =>
    provider === 'llamacpp' || provider === 'mlx'
  ),
}))

import { ensureModelForServer, type EnsureModelDeps } from '../ensureModelForServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getModelToStart } from '@/utils/getModelToStart'
import { hasGatewayUpstreamProviders } from '@/lib/local-api-gateway'

const makeProvider = (name: string, modelIds: string[]): ModelProvider => ({
  provider: name,
  models: modelIds.map((id) => ({ id })),
} as any)

const makeDeps = (overrides?: Partial<EnsureModelDeps>): EnsureModelDeps => ({
  modelsService: {
    getActiveModels: vi.fn().mockResolvedValue([]),
    startModel: vi.fn().mockResolvedValue(undefined),
  },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.mocked(hasGatewayUpstreamProviders).mockReturnValue(false)
})

describe('ensureModelForServer', () => {
  it('returns already_loaded when a model is active', async () => {
    const llamacpp = makeProvider('llamacpp', ['model-a'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [llamacpp],
    } as any)

    const deps = makeDeps({
      modelsService: {
        getActiveModels: vi.fn().mockResolvedValue(['model-a']),
        startModel: vi.fn(),
      },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({
      status: 'already_loaded',
      modelId: 'model-a',
      providerName: 'llamacpp',
    })
  })

  it('falls back to "llamacpp" when provider not found for active model', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
    } as any)

    const deps = makeDeps({
      modelsService: {
        getActiveModels: vi.fn().mockResolvedValue(['unknown-model']),
        startModel: vi.fn(),
      },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({
      status: 'already_loaded',
      modelId: 'unknown-model',
      providerName: 'llamacpp',
    })
  })

  it('uses modelOverride when provided and valid for a local provider', async () => {
    const myProvider = makeProvider('llamacpp', ['local-model'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(myProvider),
    } as any)

    const deps = makeDeps({
      modelOverride: { model: 'local-model', provider: 'llamacpp' },
    })

    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({
      status: 'loaded',
      modelId: 'local-model',
      providerName: 'llamacpp',
    })
    expect(deps.modelsService.startModel).toHaveBeenCalledWith(
      myProvider,
      'local-model',
      true
    )
  })

  it('skips invalid modelOverride and falls through to getModelToStart', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(undefined),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const deps = makeDeps({
      modelOverride: { model: 'bad', provider: 'bad' },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({ status: 'no_model_available' })
    expect(getModelToStart).toHaveBeenCalled()
  })

  it('uses getModelToStart when no override and no active model', async () => {
    const prov = makeProvider('llamacpp', ['llama'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'llama', provider: prov })

    const deps = makeDeps()
    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({
      status: 'loaded',
      modelId: 'llama',
      providerName: 'llamacpp',
    })
  })

  it('returns gateway_only when remote providers are configured and no local model is available', async () => {
    vi.mocked(hasGatewayUpstreamProviders).mockReturnValue(true)
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const result = await ensureModelForServer(makeDeps())
    expect(result).toEqual({ status: 'gateway_only' })
  })

  it('returns gateway_only instead of loading a remote provider model', async () => {
    vi.mocked(hasGatewayUpstreamProviders).mockReturnValue(true)
    const remote = makeProvider('openai', ['gpt-4'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [remote],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'gpt-4', provider: remote })

    const deps = makeDeps()
    const result = await ensureModelForServer(deps)
    expect(result).toEqual({ status: 'gateway_only' })
    expect(deps.modelsService.startModel).not.toHaveBeenCalled()
  })

  it('returns no_model_available when getModelToStart returns null', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const result = await ensureModelForServer(makeDeps())
    expect(result).toEqual({ status: 'no_model_available' })
  })

  it('calls onLoadStart and onLoadEnd around startModel', async () => {
    const prov = makeProvider('llamacpp', ['m1'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'm1', provider: prov })

    const onLoadStart = vi.fn()
    const onLoadEnd = vi.fn()
    const deps = makeDeps({ onLoadStart, onLoadEnd })

    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(onLoadStart).toHaveBeenCalled()
    expect(onLoadEnd).toHaveBeenCalled()
  })

  it('calls onLoadEnd even when startModel throws', async () => {
    const prov = makeProvider('llamacpp', ['m1'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'm1', provider: prov })

    const onLoadEnd = vi.fn()
    const deps = makeDeps({ onLoadEnd })
    ;(deps.modelsService.startModel as any).mockRejectedValue(new Error('fail'))

    await expect(ensureModelForServer(deps)).rejects.toThrow('fail')
    expect(onLoadEnd).toHaveBeenCalled()
  })

  it('skips modelOverride when provider exists but model not in provider.models', async () => {
    const prov = makeProvider('openai', ['other-model'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(prov),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const deps = makeDeps({
      modelOverride: { model: 'not-there', provider: 'openai' },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({ status: 'no_model_available' })
  })
})
