/**
 * PR2.5 multi-provider acceptance helpers.
 *
 * Proves we can project two concurrent ModelRoutes into one config.toml
 * with distinct model_providers and unioned env keys — the prerequisite for
 * ConfigLease merge (PR4). Does not start a live Codex process.
 */

import { buildCodexConfigToml } from './config'
import type { CodexProviderConfig } from './types'

/** Minimal route shape for the spike (avoids importing model-route → store graph). */
export type SpikeModelRoute = {
  parloProviderId: string
  codexProviderId: string
  modelId: string
  baseUrl: string
  wireApi: 'chat' | 'responses'
  apiKeyEnvVar?: string
  apiKey?: string
  providerDisplayName: string
}

function modelRouteToEnv(
  route: SpikeModelRoute
): Record<string, string | undefined> {
  if (route.apiKey && route.apiKeyEnvVar) {
    return { [route.apiKeyEnvVar]: route.apiKey }
  }
  return {}
}

export function perProviderEnvName(codexProviderId: string): string {
  const slug = codexProviderId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  return `PARLO_CODEX_PROVIDER_API_KEY_${slug}`
}

export type MultiProviderSpikeInput = {
  routes: SpikeModelRoute[]
  /** Top-level model/model_provider from MRU lease */
  mruIndex?: number
}

export type MultiProviderSpikeResult = {
  ok: boolean
  configToml: string
  env: Record<string, string>
  codexProviderIds: string[]
  criteria: Array<{ id: string; pass: boolean; detail: string }>
}

/**
 * Merge routes into a multi-provider TOML + union env (PR4a pure-merge shape).
 */
export function spikeMergeRoutes(
  input: MultiProviderSpikeInput
): MultiProviderSpikeResult {
  const routes = input.routes
  const mru = routes[input.mruIndex ?? routes.length - 1]
  const criteria: MultiProviderSpikeResult['criteria'] = []

  if (routes.length < 2) {
    return {
      ok: false,
      configToml: '',
      env: {},
      codexProviderIds: [],
      criteria: [
        {
          id: 'min-two-routes',
          pass: false,
          detail: `need ≥2 routes, got ${routes.length}`,
        },
      ],
    }
  }

  // Last-writer for same codexProviderId
  const byId = new Map<string, SpikeModelRoute>()
  for (const route of routes) {
    byId.set(route.codexProviderId, route)
  }
  const unique = [...byId.values()]

  const providers: CodexProviderConfig[] = unique.map((route) => ({
    id: route.codexProviderId,
    name: route.providerDisplayName,
    baseUrl: route.baseUrl,
    apiKeyEnvVar: route.apiKeyEnvVar,
    wireApi: route.wireApi,
  }))

  const configToml = buildCodexConfigToml({
    model: mru.modelId,
    modelProvider: mru.codexProviderId,
    providers,
  })

  const env: Record<string, string> = {}
  for (const route of unique) {
    const partial = modelRouteToEnv(route)
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined) env[k] = v
    }
  }

  const ids = unique.map((r) => r.codexProviderId)
  const distinctIds = new Set(ids).size === ids.length

  criteria.push({
    id: 'min-two-routes',
    pass: routes.length >= 2,
    detail: `${routes.length} input routes`,
  })
  criteria.push({
    id: 'distinct-provider-ids',
    pass: distinctIds && ids.length >= 2,
    detail: ids.join(', '),
  })
  for (const id of ids) {
    criteria.push({
      id: `toml-has-provider-${id}`,
      pass: configToml.includes(`[model_providers.${id}]`) ||
        configToml.includes(`[model_providers."${id}"]`),
      detail: `section for ${id}`,
    })
  }
  criteria.push({
    id: 'toml-mru-model',
    pass: configToml.includes(`model = ${JSON.stringify(mru.modelId)}`),
    detail: `mru model ${mru.modelId}`,
  })
  criteria.push({
    id: 'toml-mru-model-provider',
    pass: configToml.includes(
      `model_provider = ${JSON.stringify(mru.codexProviderId)}`
    ),
    detail: `mru provider ${mru.codexProviderId}`,
  })

  // Env union: each route with a key should appear with non-colliding names
  // when using per-provider env naming
  const keyed = unique.filter((r) => r.apiKey && r.apiKeyEnvVar)
  if (keyed.length >= 2) {
    const envKeys = keyed.map((r) => r.apiKeyEnvVar!)
    const uniqueEnvKeys = new Set(envKeys).size === envKeys.length
    criteria.push({
      id: 'env-keys-distinct',
      pass: uniqueEnvKeys,
      detail: envKeys.join(', '),
    })
    for (const route of keyed) {
      criteria.push({
        id: `env-has-${route.codexProviderId}`,
        pass: env[route.apiKeyEnvVar!] === route.apiKey,
        detail: `${route.apiKeyEnvVar}=…`,
      })
    }
  } else {
    criteria.push({
      id: 'env-keys-distinct',
      pass: true,
      detail: 'skipped (need ≥2 keyed routes)',
    })
  }

  // Concurrent pure builds: re-merge twice should be stable
  const second = buildCodexConfigToml({
    model: mru.modelId,
    modelProvider: mru.codexProviderId,
    providers,
  })
  criteria.push({
    id: 'merge-stable',
    pass: second === configToml,
    detail: second === configToml ? 'identical re-merge' : 'drift on re-merge',
  })

  const ok = criteria.every((c) => c.pass)
  return {
    ok,
    configToml,
    env,
    codexProviderIds: ids,
    criteria,
  }
}

/** Fixture routes for spike (ollama + xai with per-provider env keys). */
export function spikeFixtureRoutes(): SpikeModelRoute[] {
  return [
    {
      parloProviderId: 'ollama',
      codexProviderId: 'Parlo-ollama',
      modelId: 'mistral-small3.1:latest',
      baseUrl: 'http://127.0.0.1:11434/v1',
      wireApi: 'chat',
      apiKeyEnvVar: perProviderEnvName('Parlo-ollama'),
      apiKey: 'ollama-key',
      providerDisplayName: 'ollama',
    },
    {
      parloProviderId: 'xai',
      codexProviderId: 'xai',
      modelId: 'grok-4.3',
      baseUrl: 'https://api.x.ai/v1',
      wireApi: 'responses',
      apiKeyEnvVar: perProviderEnvName('xai'),
      apiKey: 'xai-key',
      providerDisplayName: 'xai',
    },
  ]
}

export function formatSpikeReport(result: MultiProviderSpikeResult): string {
  const lines = [
    `MULTI_PROVIDER_SPIKE ${result.ok ? 'PASS' : 'FAIL'}`,
    `providers: ${result.codexProviderIds.join(', ')}`,
    ...result.criteria.map(
      (c) => `  [${c.pass ? 'x' : ' '}] ${c.id}: ${c.detail}`
    ),
  ]
  return lines.join('\n')
}
