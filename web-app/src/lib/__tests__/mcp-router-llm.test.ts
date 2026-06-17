import { describe, it, expect } from 'vitest'
import { selectServersWithLlm } from '../mcp-orchestrator/mcp-router-llm'
import type { ServerSummary } from '@/services/mcp/types'

const mockModel = { modelId: 'test' } as any

const summaries: ServerSummary[] = [
  { name: 'weather', description: 'Weather data', capabilities: ['get_weather'] },
  { name: 'calendar', description: 'Calendar', capabilities: ['list_events', 'create_event'] },
  { name: 'email', description: '', capabilities: [] },
]

describe('selectServersWithLlm', () => {
  it('does not call a model and returns empty selection for keyword fallback', async () => {
    const result = await selectServersWithLlm(
      'What is the weather?',
      summaries,
      mockModel
    )

    expect(result).toEqual(
      expect.objectContaining({
        names: [],
        errorKind: 'none',
        emptyValidatedSelection: false,
      })
    )
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports abort when the parent signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await selectServersWithLlm(
      'test',
      summaries,
      mockModel,
      controller.signal
    )

    expect(result).toEqual(
      expect.objectContaining({
        names: [],
        errorKind: 'abort',
        emptyValidatedSelection: false,
      })
    )
  })
})
