import type { LanguageModel, LanguageModelUsage } from 'ai'
import type { ServerSummary } from '@/services/mcp/types'

export const MCP_ROUTER_TIMEOUT_MS = 3_500

export type LlmRouterErrorKind = 'none' | 'timeout' | 'abort' | 'error'

export type LlmRouterResult = {
  names: string[]
  durationMs: number
  errorKind: LlmRouterErrorKind
  /** Model returned server names that were all absent from the allow-list. */
  emptyValidatedSelection: boolean
  /** Present when the router call completed (including empty selection). */
  usage?: LanguageModelUsage
}

/**
 * LLM routing is intentionally disabled: Codex app-server owns the only
 * agent/model execution path. Returning an empty result keeps callers on the
 * deterministic keyword router.
 */
export async function selectServersWithLlm(
  userMessage: string,
  summaries: ServerSummary[],
  model: LanguageModel,
  abortSignal?: AbortSignal
): Promise<LlmRouterResult> {
  const started = performance.now()
  void userMessage
  void summaries
  void model

  return {
    names: [],
    durationMs: Math.round(performance.now() - started),
    errorKind: abortSignal?.aborted ? 'abort' : 'none',
    emptyValidatedSelection: false,
  }
}
