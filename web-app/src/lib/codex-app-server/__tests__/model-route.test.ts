import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCodexSessionOptions,
  buildModelRoute,
  buildSessionPolicy,
  CODEX_LEGACY_PROVIDER_API_KEY_ENV,
  CODEX_PARLO_GATEWAY_API_KEY_ENV,
  CODEX_PARLO_GATEWAY_PROVIDER_ID,
  codexManagedProviderId,
  perProviderEnvName,
} from '../model-route'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'

const mockProfilesState = vi.hoisted(() => ({
  profiles: {} as Record<string, unknown>,
  activeProfileId: null as string | null,
}))

const mockModelProviderState = vi.hoisted(() => ({
  providers: [] as ModelProvider[],
  getProviderByName: (name: string) =>
    mockModelProviderState.providers.find((p) => p.provider === name),
}))

const mockLocalApiState = vi.hoisted(() => ({
  serverHost: '127.0.0.1',
  serverPort: 1337,
  apiPrefix: '/v1',
  apiKey: 'Parlo-local-api-key',
}))

const mockMcpServersState = vi.hoisted(() => ({
  mcpServers: {} as Record<string, unknown>,
  settings: { toolCallTimeoutSeconds: 60 },
}))

const mockThreadsState = vi.hoisted(() => ({
  threads: {
    'thread-1': { id: 'thread-1', title: 'Thread 1', metadata: {} },
  } as Record<string, { id: string; title?: string; metadata?: Record<string, unknown> }>,
}))

const mockWorkspaceState = vi.hoisted(() => ({
  directories: new Map<string, string>(),
}))

vi.mock('@/stores/codex-provider-profile-store', () => ({
  useCodexProviderProfiles: {
    getState: () => mockProfilesState,
  },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => mockModelProviderState,
  },
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: {
    getState: () => mockLocalApiState,
  },
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => mockMcpServersState,
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => mockThreadsState,
  },
}))

vi.mock('@/stores/workspace-directory-store', () => ({
  useWorkspaceDirectories: {
    getState: () => ({
      getDirectory: (ref: { type: string; id: string }) =>
        mockWorkspaceState.directories.get(`${ref.type}:${ref.id}`),
    }),
  },
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteAuthKeyChain: vi.fn(async () => []),
}))

function codexProvider(partial: Partial<ModelProvider> = {}): ModelProvider {
  return {
    active: true,
    provider: 'codex',
    settings: [],
    models: [{ id: 'gpt-5.5' }],
    persist: true,
    ...partial,
  }
}

describe('model-route projection (product defaults)', () => {
  beforeEach(() => {
    mockProfilesState.profiles = {}
    mockProfilesState.activeProfileId = null
    mockModelProviderState.providers = []
    mockWorkspaceState.directories.clear()
    useCodexHostFlags.getState().resetFlags()
  })

  it('maps reserved provider ids with Parlo- prefix', () => {
    expect(codexManagedProviderId('openai')).toBe('Parlo-openai')
    expect(codexManagedProviderId('ollama')).toBe('Parlo-ollama')
    expect(codexManagedProviderId('xai')).toBe('xai')
    expect(codexManagedProviderId('llamacpp')).toBe('llamacpp')
  })

  it('names per-provider env keys deterministically', () => {
    expect(perProviderEnvName('Parlo-openai')).toBe(
      'PARLO_CODEX_PROVIDER_API_KEY_PARLO_OPENAI'
    )
    expect(perProviderEnvName('xai')).toBe('PARLO_CODEX_PROVIDER_API_KEY_XAI')
  })

  it('projects bare codex (no profile) through Parlo-gateway', () => {
    const route = buildModelRoute(codexProvider(), { id: 'gpt-5.5' })
    expect(route).toMatchObject({
      useGateway: true,
      source: 'gateway',
      codexProviderId: CODEX_PARLO_GATEWAY_PROVIDER_ID,
      modelId: 'gpt-5.5',
      baseUrl: 'http://127.0.0.1:1337/v1',
      wireApi: 'responses',
      apiKeyEnvVar: CODEX_PARLO_GATEWAY_API_KEY_ENV,
    })

    const options = buildCodexSessionOptions(
      'thread-1',
      codexProvider(),
      { id: 'gpt-5.5' }
    )
    expect(options.modelProvider).toBe(CODEX_PARLO_GATEWAY_PROVIDER_ID)
    expect(options.env).toEqual({
      [CODEX_PARLO_GATEWAY_API_KEY_ENV]: 'Parlo-local-api-key',
    })
    expect(options.configToml).toContain('[model_providers.Parlo-gateway]')
    expect(options.configToml).toContain('wire_api = "responses"')
  })

  it('projects ollama directly with legacy single API key env when flag off', () => {
    const ollama: ModelProvider = {
      active: true,
      provider: 'ollama',
      api_key: 'Parlo',
      base_url: 'http://127.0.0.1:11434/v1',
      settings: [],
      models: [],
    }
    mockModelProviderState.providers = [
      codexProvider({
        settings: [
          {
            key: 'codex-binary-path',
            controller_props: { value: '/custom/codex' },
          } as ModelProvider['settings'][number],
        ],
      }),
    ]

    const route = buildModelRoute(ollama, { id: 'mistral-small3.1:latest' })
    expect(route).toMatchObject({
      source: 'direct',
      useGateway: false,
      codexProviderId: 'Parlo-ollama',
      wireApi: 'chat',
      apiKeyEnvVar: CODEX_LEGACY_PROVIDER_API_KEY_ENV,
      apiKey: 'Parlo',
    })

    const options = buildCodexSessionOptions('thread-1', ollama, {
      id: 'mistral-small3.1:latest',
    })
    expect(options.modelProvider).toBe('Parlo-ollama')
    expect(options.env).toEqual({
      [CODEX_LEGACY_PROVIDER_API_KEY_ENV]: 'Parlo',
    })
    expect(options.configToml).toContain('wire_api = "chat"')
  })

  it('projects xAI with responses wire and context window', () => {
    const xai: ModelProvider = {
      active: true,
      provider: 'xai',
      api_key: 'xai-api-key',
      base_url: 'https://api.x.ai/v1',
      settings: [],
      models: [],
    }
    const route = buildModelRoute(xai, { id: 'grok-4.3' })
    expect(route).toMatchObject({
      source: 'direct',
      codexProviderId: 'xai',
      wireApi: 'responses',
      modelContextWindow: 1_000_000,
    })
    const options = buildCodexSessionOptions('thread-1', xai, { id: 'grok-4.3' })
    expect(options.configToml).toContain('model_context_window = 1000000')
  })

  it('sets large context window for grok-4.5 when Codex has no built-in metadata', () => {
    const xai: ModelProvider = {
      active: true,
      provider: 'xai',
      api_key: 'xai-api-key',
      base_url: 'https://api.x.ai/v1',
      settings: [],
      models: [],
    }
    const route = buildModelRoute(xai, { id: 'grok-4.5' })
    expect(route.modelId).toBe('grok-4.5')
    expect(route.modelContextWindow).toBe(1_000_000)
    expect(route.apiKeyEnvVar).toBeTruthy()
    const options = buildCodexSessionOptions('thread-1', xai, { id: 'grok-4.5' })
    expect(options.configToml).toContain('model = "grok-4.5"')
    expect(options.configToml).toContain('env_key = "PARLO_CODEX_PROVIDER_API_KEY"')
    expect(options.configToml).toContain('model_context_window = 1000000')
  })

  it('projects llamacpp as local-engine to local API base URL', () => {
    const llamacpp: ModelProvider = {
      active: true,
      provider: 'llamacpp',
      api_key: 'Parlo',
      base_url: '',
      settings: [],
      models: [],
    }
    const route = buildModelRoute(llamacpp, { id: 'Parlo-v1-4B-Q4_K_M' })
    expect(route).toMatchObject({
      source: 'local-engine',
      requiresLocalEngine: true,
      codexProviderId: 'llamacpp',
      baseUrl: 'http://127.0.0.1:1337/v1',
      wireApi: 'chat',
    })
  })

  it('uses per-provider env names when forcePerProviderEnvKeys is true', () => {
    const ollama: ModelProvider = {
      active: true,
      provider: 'ollama',
      api_key: 'k',
      base_url: 'http://127.0.0.1:11434/v1',
      settings: [],
      models: [],
    }
    const route = buildModelRoute(ollama, { id: 'm' }, {
      forcePerProviderEnvKeys: true,
    })
    expect(route.apiKeyEnvVar).toBe(perProviderEnvName('Parlo-ollama'))
  })

  it('builds session policy defaults without an active profile', () => {
    const policy = buildSessionPolicy(codexProvider())
    expect(policy).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      codexHome: './.Parlo/codex-home',
    })
  })

  it('keeps preferGatewayForRemotes default false (no collapse for direct openai)', () => {
    expect(useCodexHostFlags.getState().preferGatewayForRemotes).toBe(false)
    const openai: ModelProvider = {
      active: true,
      provider: 'openai',
      api_key: 'sk-test',
      base_url: 'https://api.openai.com/v1',
      settings: [],
      models: [],
    }
    const route = buildModelRoute(openai, { id: 'gpt-4.1' })
    expect(route.useGateway).toBe(false)
    expect(route.codexProviderId).toBe('Parlo-openai')
    expect(route.source).toBe('direct')
  })
})
