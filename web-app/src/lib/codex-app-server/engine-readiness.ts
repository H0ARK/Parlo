/**
 * Local engine readiness probe (DESIGN_CODEX_HOST PR5).
 * GET {baseUrl}/models against the exact projected ModelRoute base URL.
 */

export type EngineReadinessResult = {
  ok: boolean
  baseUrl: string
  statusCode?: number
  modelCount?: number
  error?: string
  attempts: number
}

export type ProbeModelsOptions = {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  retries?: number
  /** Injectable fetch for tests */
  fetchImpl?: typeof fetch
  backoffMs?: number
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * Probe OpenAI-compatible GET /models on the projected base URL.
 */
export async function probeOpenAiModelsEndpoint(
  options: ProbeModelsOptions
): Promise<EngineReadinessResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const timeoutMs = options.timeoutMs ?? 15_000
  const retries = options.retries ?? 3
  const backoffMs = options.backoffMs ?? 200
  const fetchImpl = options.fetchImpl ?? fetch
  let lastError: string | undefined
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      }
      if (options.apiKey) {
        headers.Authorization = `Bearer ${options.apiKey}`
        headers['x-api-key'] = options.apiKey
      }
      const response = await fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      lastStatus = response.status
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
      } else {
        const body = (await response.json().catch(() => null)) as {
          data?: unknown[]
        } | null
        const modelCount = Array.isArray(body?.data) ? body!.data!.length : undefined
        return {
          ok: true,
          baseUrl,
          statusCode: response.status,
          modelCount,
          attempts: attempt,
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, backoffMs * attempt))
    }
  }

  return {
    ok: false,
    baseUrl,
    statusCode: lastStatus,
    error: lastError ?? 'probe failed',
    attempts: retries,
  }
}

/**
 * Ensure local engine is ready for Codex projection; throws with explicit error.
 */
export async function assertEngineEndpointReady(
  options: ProbeModelsOptions
): Promise<EngineReadinessResult> {
  const result = await probeOpenAiModelsEndpoint(options)
  if (!result.ok) {
    throw new Error(
      `Local model endpoint not ready at ${result.baseUrl}/models` +
        (result.error ? ` (${result.error})` : '') +
        ` after ${result.attempts} attempt(s).`
    )
  }
  return result
}
