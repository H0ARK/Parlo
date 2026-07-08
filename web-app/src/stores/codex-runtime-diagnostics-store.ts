import { create } from 'zustand'

export type CodexRestartReason =
  | 'env-change'
  | 'binary-change'
  | 'agents-change'
  | 'manual-shutdown'
  | 'process-exit'
  | 'unknown'

export type CodexRuntimeDiagnosticSnapshot = {
  lastConfigHash?: string
  lastProcessSignature?: string
  lastRestartReason?: CodexRestartReason
  lastRestartAt?: number
  leaseCount: number
  leaseThreadIds: string[]
  activeTurnThreadIds: string[]
  updatedAt: number
}

type DiagnosticsState = CodexRuntimeDiagnosticSnapshot & {
  setSnapshot: ( partial: Partial<CodexRuntimeDiagnosticSnapshot>) => void
  recordRestart: (reason: CodexRestartReason) => void
  reset: () => void
}

const empty = (): CodexRuntimeDiagnosticSnapshot => ({
  leaseCount: 0,
  leaseThreadIds: [],
  activeTurnThreadIds: [],
  updatedAt: Date.now(),
})

export const useCodexRuntimeDiagnostics = create<DiagnosticsState>()(
  (set) => ({
    ...empty(),
    setSnapshot: (partial) =>
      set((state) => ({
        ...state,
        ...partial,
        updatedAt: Date.now(),
      })),
    recordRestart: (reason) =>
      set({
        lastRestartReason: reason,
        lastRestartAt: Date.now(),
        updatedAt: Date.now(),
      }),
    reset: () => set(empty()),
  })
)

/** Pull live lease registry into diagnostics (call from runtime after mutations). */
export function refreshLeaseDiagnostics(
  registry: {
    list: () => Array<{ threadId: string; activeTurn: boolean }>
  }
): void {
  const leases = registry.list()
  useCodexRuntimeDiagnostics.getState().setSnapshot({
    leaseCount: leases.length,
    leaseThreadIds: leases.map((l) => l.threadId),
    activeTurnThreadIds: leases
      .filter((l) => l.activeTurn)
      .map((l) => l.threadId),
  })
}
