import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  assertCodexBinaryHealthForChat,
  probeCodexBinary,
  shouldBlockChatOnBinaryHealth,
} from '../binary-health'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
}))

describe('binary-health (PR6)', () => {
  beforeEach(() => {
    useCodexHostFlags.getState().resetFlags()
    vi.mocked(invoke).mockReset()
  })

  it('uses Tauri run_codex_cli_subcommand when runHelp is not injected', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      expect(command).toBe('run_codex_cli_subcommand')
      const cliArgs = (args as { args?: string[] })?.args ?? []
      if (cliArgs[0] === 'app-server') {
        return {
          stdout: 'Usage: codex app-server --stdio\n',
          stderr: '',
          exit_code: 0,
        }
      }
      return { stdout: 'codex-cli 0.1.0\n', stderr: '', exit_code: 0 }
    })

    const health = await probeCodexBinary({
      command: '/Applications/Codex.app/Contents/Resources/codex',
    })
    expect(health.ok).toBe(true)
    expect(health.supportsAppServerStdio).toBe(true)
    expect(invoke).toHaveBeenCalledWith(
      'run_codex_cli_subcommand',
      expect.objectContaining({
        command: '/Applications/Codex.app/Contents/Resources/codex',
        args: ['app-server', '--help'],
      })
    )
  })

  it('returns not-ok when Tauri probe fails to find app-server support', async () => {
    vi.mocked(invoke).mockResolvedValue({
      stdout: 'Usage: codex chat only',
      stderr: '',
      exit_code: 0,
    })
    const health = await probeCodexBinary({ command: 'codex' })
    expect(health.ok).toBe(false)
    expect(health.severity).toBe('error')
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
