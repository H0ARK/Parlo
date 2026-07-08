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
  const thread = useThreads.getState().threads[parloThreadId]
  if (!thread) return

  if (!trimmed) {
    // Clear binding (provider rebind)
    const existingMeta =
      typeof thread.metadata?.codex === 'object' && thread.metadata.codex
        ? { ...(thread.metadata.codex as Record<string, unknown>) }
        : {}
    delete existingMeta.threadId
    useThreads.getState().updateThread(parloThreadId, {
      metadata: {
        ...thread.metadata,
        codex:
          Object.keys(existingMeta).length > 0 ? existingMeta : undefined,
      },
    })
    return
  }

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