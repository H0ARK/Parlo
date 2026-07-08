import { beforeEach, describe, expect, it } from 'vitest'
import {
  refreshLeaseDiagnostics,
  useCodexRuntimeDiagnostics,
} from '../codex-runtime-diagnostics-store'

describe('codex-runtime-diagnostics-store (PR9)', () => {
  beforeEach(() => {
    useCodexRuntimeDiagnostics.getState().reset()
  })

  it('records restart reasons', () => {
    useCodexRuntimeDiagnostics.getState().recordRestart('env-change')
    const state = useCodexRuntimeDiagnostics.getState()
    expect(state.lastRestartReason).toBe('env-change')
    expect(state.lastRestartAt).toBeTypeOf('number')
  })

  it('refreshes lease diagnostics from registry list', () => {
    refreshLeaseDiagnostics({
      list: () => [
        { threadId: 't1', activeTurn: true },
        { threadId: 't2', activeTurn: false },
      ],
    })
    const state = useCodexRuntimeDiagnostics.getState()
    expect(state.leaseCount).toBe(2)
    expect(state.leaseThreadIds).toEqual(['t1', 't2'])
    expect(state.activeTurnThreadIds).toEqual(['t1'])
  })
})
