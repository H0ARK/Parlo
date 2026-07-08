import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertCodexBinaryHealthForChat,
  probeCodexBinary,
  shouldBlockChatOnBinaryHealth,
} from '../binary-health'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'

describe('binary-health (PR6)', () => {
  beforeEach(() => {
    useCodexHostFlags.getState().resetFlags()
  })

  it('reports ok when help mentions app-server --stdio', async () => {
    const health = await probeCodexBinary({
      command: 'codex',
      runHelp: async () => ({
        stdout: 'Usage: codex app-server --stdio',
        stderr: '',
        code: 0,
      }),
      runVersion: async () => ({
        stdout: 'codex-cli 0.140.0',
        stderr: '',
        code: 0,
      }),
    })
    expect(health.ok).toBe(true)
    expect(health.supportsAppServerStdio).toBe(true)
    expect(health.version).toContain('0.140')
  })

  it('reports error when app-server is missing', async () => {
    const health = await probeCodexBinary({
      command: 'codex',
      runHelp: async () => ({
        stdout: 'Usage: codex chat',
        stderr: '',
        code: 0,
      }),
    })
    expect(health.ok).toBe(false)
    expect(health.severity).toBe('error')
  })

  it('soft-warn default does not block chat when health fails', async () => {
    expect(useCodexHostFlags.getState().binaryHealthHardBlock).toBe(false)
    const health = {
      ok: false,
      severity: 'error' as const,
      command: 'codex',
      message: 'missing',
    }
    expect(shouldBlockChatOnBinaryHealth(health)).toBe(false)
    await expect(assertCodexBinaryHealthForChat(health)).resolves.toBeUndefined()
  })

  it('hard block throws when flag is on', async () => {
    useCodexHostFlags.getState().setFlag('binaryHealthHardBlock', true)
    const health = {
      ok: false,
      severity: 'error' as const,
      command: 'codex',
      message: 'missing binary',
    }
    expect(shouldBlockChatOnBinaryHealth(health)).toBe(true)
    await expect(assertCodexBinaryHealthForChat(health)).rejects.toThrow(
      /missing binary/
    )
  })
})
