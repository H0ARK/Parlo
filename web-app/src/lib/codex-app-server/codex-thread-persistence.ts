import { useThreads } from '@/hooks/useThreads'

type CodexThreadMetadata = {
  threadId?: string
}

export function readPersistedCodexThreadId(janThreadId: string): string | undefined {
  const thread = useThreads.getState().threads[janThreadId]
  const codex = thread?.metadata?.codex
  if (!codex || typeof codex !== 'object') return undefined
  const threadId = (codex as CodexThreadMetadata).threadId
  return typeof threadId === 'string' && threadId.trim() ? threadId.trim() : undefined
}

export function persistCodexThreadId(
  janThreadId: string,
  codexThreadId: string
): void {
  const trimmed = codexThreadId.trim()
  if (!trimmed) return

  const thread = useThreads.getState().threads[janThreadId]
  if (!thread) return

  const existing = readPersistedCodexThreadId(janThreadId)
  if (existing === trimmed) return

  useThreads.getState().updateThread(janThreadId, {
    metadata: {
      ...thread.metadata,
      codex: {
        ...(typeof thread.metadata?.codex === 'object'
          ? thread.metadata.codex
          : {}),
        threadId: trimmed,
      },
    },
  })
}