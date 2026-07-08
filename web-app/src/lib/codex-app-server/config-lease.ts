/**
 * ConfigLease registry + pure multi-provider merge (DESIGN_CODEX_HOST §3, PR3/PR4a).
 *
 * - Registry records ModelRoutes per Parlo thread (leases).
 * - Env union depends on perProviderEnvKeys host flag (PR3).
 * - TOML multi-provider merge depends on multiProviderMerge flag (PR4).
 */

import { buildCodexConfigToml, type CodexConfigTomlOptions } from './config'
import type { ModelRoute, SessionPolicy } from './model-route'
import { modelRouteToEnv, resolveCodexWorkspaceDir } from './model-route'
import type { CodexProviderConfig, CodexSessionOptions } from './types'
import { buildCodexMcpServersConfig } from './mcp-config-bridge'
import type { MCPServers } from '@/hooks/useMCPServers'

export type ConfigLease = {
  threadId: string
  route: ModelRoute
  policy: SessionPolicy
  lastUsedAt: number
  activeTurn: boolean
}

export type MergeOptions = {
  /** Union all lease env keys (perProviderEnvKeys). */
  unionEnv: boolean
  /** Merge all lease providers into TOML (multiProviderMerge). */
  multiProviderMerge: boolean
  mcpServers?: MCPServers
  mcpToolTimeoutSeconds?: number
  /** Max leases; idle oldest evicted first. */
  maxLeases?: number
}

const DEFAULT_MAX_LEASES = 64

/** FNV-1a 32-bit hex for config content hashing. */
export function hashConfigContent(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class ConfigLeaseRegistry {
  private leases = new Map<string, ConfigLease>()

  upsert(
    lease: Omit<ConfigLease, 'lastUsedAt'> & { lastUsedAt?: number }
  ): ConfigLease {
    const next: ConfigLease = {
      ...lease,
      lastUsedAt: lease.lastUsedAt ?? Date.now(),
    }
    this.leases.set(lease.threadId, next)
    return next
  }

  get(threadId: string): ConfigLease | undefined {
    return this.leases.get(threadId)
  }

  release(threadId: string): void {
    this.leases.delete(threadId)
  }

  clear(): void {
    this.leases.clear()
  }

  list(): ConfigLease[] {
    return [...this.leases.values()].sort(
      (a, b) => b.lastUsedAt - a.lastUsedAt
    )
  }

  /** MRU lease by lastUsedAt. */
  mru(): ConfigLease | undefined {
    return this.list()[0]
  }

  markActiveTurn(threadId: string, active: boolean): void {
    const lease = this.leases.get(threadId)
    if (lease) {
      lease.activeTurn = active
      lease.lastUsedAt = Date.now()
    }
  }

  evictIdleBeyond(max: number = DEFAULT_MAX_LEASES): string[] {
    const ordered = [...this.leases.values()].sort(
      (a, b) => a.lastUsedAt - b.lastUsedAt
    )
    const evicted: string[] = []
    while (this.leases.size > max && ordered.length > 0) {
      const victim = ordered.shift()!
      if (victim.activeTurn) continue
      if (!this.leases.has(victim.threadId)) continue
      this.leases.delete(victim.threadId)
      evicted.push(victim.threadId)
    }
    return evicted
  }

  size(): number {
    return this.leases.size
  }
}

/** Module-level registry for provisional PR3 use (shared with runtime in PR4b). */
let sharedRegistry = new ConfigLeaseRegistry()

export function getConfigLeaseRegistry(): ConfigLeaseRegistry {
  return sharedRegistry
}

export function resetConfigLeaseRegistryForTests(): void {
  sharedRegistry = new ConfigLeaseRegistry()
}

export type MergedConfig = {
  configToml: string
  env: Record<string, string | undefined>
  model?: string
  modelProvider?: string
  contentHash: string
  providers: CodexProviderConfig[]
}

/**
 * Pure merge of leases into TOML + env per flag truth table.
 * Does not touch app stores — pass mcpServers when available.
 */
export function mergeLeasesToConfig(
  leases: ConfigLease[],
  options: MergeOptions
): MergedConfig {
  if (leases.length === 0) {
    return {
      configToml: '',
      env: {},
      contentHash: hashConfigContent(''),
      providers: [],
    }
  }

  const sorted = [...leases].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  const mru = sorted[0]

  // Last-writer wins per codexProviderId (apply oldest→newest)
  const byProvider = new Map<string, ModelRoute>()
  for (const lease of [...sorted].reverse()) {
    byProvider.set(lease.route.codexProviderId, lease.route)
  }

  const routesForToml = options.multiProviderMerge
    ? [...byProvider.values()]
    : [mru.route]

  const providers: CodexProviderConfig[] = routesForToml.map((route) => ({
    id: route.codexProviderId,
    name: route.providerDisplayName,
    baseUrl: route.baseUrl,
    apiKeyEnvVar: route.apiKeyEnvVar,
    wireApi: route.wireApi,
  }))

  const policy = mru.policy
  const tomlInput: CodexConfigTomlOptions = {
    model: mru.route.modelId,
    modelProvider: mru.route.codexProviderId,
    modelContextWindow: mru.route.modelContextWindow,
    modelReasoningEffort: mru.route.modelReasoningEffort,
    providers,
    agents:
      policy.subagentMaxThreads || policy.subagentMaxDepth
        ? {
            max_threads: policy.subagentMaxThreads,
            max_depth: policy.subagentMaxDepth,
          }
        : undefined,
    defaultPermissions: policy.permissionProfile,
    advancedConfigSnippet: policy.advancedConfigSnippet,
  }
  if (options.mcpServers) {
    tomlInput.mcpServers = options.mcpServers
    tomlInput.mcpToolTimeoutSeconds = options.mcpToolTimeoutSeconds
  }

  const configToml = buildCodexConfigToml(tomlInput)

  let env: Record<string, string | undefined> = {}
  if (options.unionEnv) {
    for (const lease of sorted) {
      env = { ...env, ...modelRouteToEnv(lease.route) }
    }
  } else {
    env = modelRouteToEnv(mru.route)
  }

  const hashPayload = JSON.stringify({
    configToml,
    envKeys: Object.keys(env).sort(),
    agentsMd: policy.agentsMd ?? '',
    customAgents: policy.customAgents ?? null,
  })

  return {
    configToml,
    env,
    model: mru.route.modelId,
    modelProvider: mru.route.codexProviderId,
    contentHash: hashConfigContent(hashPayload),
    providers,
  }
}

/**
 * Build spawn env for a route according to §3.4 truth table.
 * - unionEnv false → last-writer (this route only)
 * - unionEnv true → union all registry leases + current route
 */
export function spawnEnvForThread(
  currentRoute: ModelRoute,
  options: { unionEnv: boolean; registry?: ConfigLeaseRegistry }
): Record<string, string | undefined> {
  const registry = options.registry ?? getConfigLeaseRegistry()
  if (!options.unionEnv) {
    return modelRouteToEnv(currentRoute)
  }
  const leases = registry.list()
  if (leases.length === 0) {
    return modelRouteToEnv(currentRoute)
  }
  let env: Record<string, string | undefined> = {}
  for (const lease of leases) {
    env = { ...env, ...modelRouteToEnv(lease.route) }
  }
  env = { ...env, ...modelRouteToEnv(currentRoute) }
  return env
}

/**
 * Apply lease upsert + return session options with env/toml per flags.
 */
export function applyLeaseAndBuildSessionOptions(
  threadId: string,
  route: ModelRoute,
  policy: SessionPolicy,
  flags: {
    unionEnv: boolean
    multiProviderMerge: boolean
    mcpServers?: MCPServers
    mcpToolTimeoutSeconds?: number
  }
): CodexSessionOptions {
  const registry = getConfigLeaseRegistry()
  registry.upsert({
    threadId,
    route,
    policy,
    activeTurn: false,
  })
  registry.evictIdleBeyond()

  const merged = mergeLeasesToConfig(registry.list(), {
    unionEnv: flags.unionEnv,
    multiProviderMerge: flags.multiProviderMerge,
    mcpServers: flags.mcpServers,
    mcpToolTimeoutSeconds: flags.mcpToolTimeoutSeconds,
  })

  const cwd = resolveCodexWorkspaceDir(threadId)
  const mcpServers = flags.mcpServers ?? {}

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
    configToml: merged.configToml,
    mcpRefreshConfig: {
      mcp_servers: buildCodexMcpServersConfig(mcpServers, {
        toolTimeoutSeconds: flags.mcpToolTimeoutSeconds,
      }),
      mcp_oauth_credentials_store_mode: 'auto',
    },
    env: merged.env,
  }
}
