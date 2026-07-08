import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/stores/workspace-directory-store', () => ({
  useWorkspaceDirectories: {
    getState: () => ({ getDirectory: () => undefined }),
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => ({ providers: [], getProviderByName: () => undefined }) },
}))
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: {
    getState: () => ({
      serverHost: '127.0.0.1',
      serverPort: 1337,
      apiPrefix: '/v1',
      apiKey: '',
    }),
  },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ mcpServers: {}, settings: { toolCallTimeoutSeconds: 60 } }),
  },
}))
vi.mock('@/stores/codex-provider-profile-store', () => ({
  useCodexProviderProfiles: {
    getState: () => ({ profiles: {}, activeProfileId: null }),
  },
}))
vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteAuthKeyChain: vi.fn(async () => []),
}))

import {
  ConfigLeaseRegistry,
  hashConfigContent,
  mergeLeasesToConfig,
  resetConfigLeaseRegistryForTests,
  spawnEnvForThread,
  type ConfigLease,
} from '../config-lease'
import type { ModelRoute, SessionPolicy } from '../model-route'
import { perProviderEnvName } from '../model-route'

function policy(partial: Partial<SessionPolicy> = {}): SessionPolicy {
  return {
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    codexBinaryPath: 'codex',
    codexHome: './.Parlo/codex-home',
    ...partial,
  }
}

function route(
  id: string,
  provider: string,
  key: string
): ModelRoute {
  const codexProviderId =
    provider === 'ollama' ? 'Parlo-ollama' : provider === 'openai' ? 'Parlo-openai' : provider
  return {
    parloProviderId: provider,
    codexProviderId,
    modelId: id,
    baseUrl: `http://example.test/${provider}`,
    wireApi: provider === 'xai' ? 'responses' : 'chat',
    apiKeyEnvVar: perProviderEnvName(codexProviderId),
    apiKey: key,
    requiresLocalEngine: false,
    useGateway: false,
    source: 'direct',
    providerDisplayName: provider,
  }
}

function lease(
  threadId: string,
  r: ModelRoute,
  lastUsedAt: number
): ConfigLease {
  return {
    threadId,
    route: r,
    policy: policy(),
    lastUsedAt,
    activeTurn: false,
  }
}

describe('config-lease (PR3 / PR4a)', () => {
  beforeEach(() => {
    resetConfigLeaseRegistryForTests()
  })

  it('hashes content stably', () => {
    expect(hashConfigContent('abc')).toBe(hashConfigContent('abc'))
    expect(hashConfigContent('abc')).not.toBe(hashConfigContent('abd'))
  })

  it('last-writer env when unionEnv is false (legacy)', () => {
    const leases = [
      lease('t1', route('m1', 'ollama', 'k1'), 1),
      lease('t2', route('m2', 'xai', 'k2'), 2),
    ]
    const merged = mergeLeasesToConfig(leases, {
      unionEnv: false,
      multiProviderMerge: false,
    })
    expect(Object.keys(merged.env)).toEqual([perProviderEnvName('xai')])
    expect(merged.env[perProviderEnvName('xai')]).toBe('k2')
    expect(merged.configToml).toContain('[model_providers.xai]')
    expect(merged.configToml).not.toContain('[model_providers.Parlo-ollama]')
  })

  it('unions env keys when unionEnv is true', () => {
    const leases = [
      lease('t1', route('m1', 'ollama', 'k1'), 1),
      lease('t2', route('m2', 'xai', 'k2'), 2),
    ]
    const merged = mergeLeasesToConfig(leases, {
      unionEnv: true,
      multiProviderMerge: false,
    })
    expect(merged.env[perProviderEnvName('Parlo-ollama')]).toBe('k1')
    expect(merged.env[perProviderEnvName('xai')]).toBe('k2')
  })

  it('merges multi-provider TOML when multiProviderMerge is true', () => {
    const leases = [
      lease('t1', route('m1', 'ollama', 'k1'), 1),
      lease('t2', route('m2', 'xai', 'k2'), 2),
    ]
    const merged = mergeLeasesToConfig(leases, {
      unionEnv: true,
      multiProviderMerge: true,
    })
    expect(merged.configToml).toContain('[model_providers.Parlo-ollama]')
    expect(merged.configToml).toContain('[model_providers.xai]')
    expect(merged.configToml).toContain('model_provider = "xai"')
    expect(merged.providers).toHaveLength(2)
    expect(merged.contentHash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('registry upsert / release / mru', () => {
    const reg = new ConfigLeaseRegistry()
    reg.upsert(lease('t1', route('m1', 'ollama', 'k1'), 10))
    reg.upsert(lease('t2', route('m2', 'xai', 'k2'), 20))
    expect(reg.size()).toBe(2)
    expect(reg.mru()?.threadId).toBe('t2')
    reg.release('t2')
    expect(reg.mru()?.threadId).toBe('t1')
  })

  it('spawnEnvForThread unions registry when unionEnv true', () => {
    const reg = new ConfigLeaseRegistry()
    const r1 = route('m1', 'ollama', 'k1')
    const r2 = route('m2', 'xai', 'k2')
    reg.upsert(lease('t1', r1, 1))
    reg.upsert(lease('t2', r2, 2))
    const env = spawnEnvForThread(r2, { unionEnv: true, registry: reg })
    expect(env[perProviderEnvName('Parlo-ollama')]).toBe('k1')
    expect(env[perProviderEnvName('xai')]).toBe('k2')
    const legacy = spawnEnvForThread(r2, { unionEnv: false, registry: reg })
    expect(Object.keys(legacy)).toEqual([perProviderEnvName('xai')])
  })
})
