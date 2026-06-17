import { useThreads } from '@/hooks/useThreads'

type CodexThreadMetadata = {
  threadId?: string
}

export function readPersistedCodexThreadId(parloThreadId: string): string | undefined {
  const thread = useThreads.getState().threads[parloThreadId]
  const codex = thread?.metadata?.codex
  if (!codex || typeof codex !== 'object') return undefined
  const threadId = (codex as CodexThreadMetadata).threadId
  return typeof threadId === 'string' && threadId.trim() ? threadId.trim() : undefined
}

export function persistCodexThreadId(
  parloThreadId: string,
  codexThreadId: string
): void {
  const trimmed = codexThreadId.trim()
  if (!trimmed) return

  const thread = useThreads.getState().threads[parloThreadId]
  if (!thread) return

  const existing = readPersistedCodexThreadId(parloThreadId)
  if (existing === trimmed) return

  useThreads.getState().updateThread(parloThreadId, {
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