import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config-lease', () => ({
  getConfigLeaseRegistry: () => ({
    markActiveTurn: vi.fn(),
    release: vi.fn(),
    list: () => [],
  }),
}))

vi.mock('@/stores/codex-runtime-diagnostics-store', () => ({
  useCodexRuntimeDiagnostics: {
    getState: () => ({
      recordRestart: vi.fn(),
      setSnapshot: vi.fn(),
    }),
  },
  refreshLeaseDiagnostics: vi.fn(),
}))


const writeConfig = vi.fn(async () => {})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'write_codex_app_server_config') {
      await writeConfig()
      return '/tmp/config.toml'
    }
    return null
  }),
}))

vi.mock('../tauri-process', () => ({
  TauriCodexProcessSpawner: class {
    async spawn() {
      return {
        writeLine: vi.fn(),
        onStdoutLine: () => () => {},
        onStderrLine: () => () => {},
        onExit: () => () => {},
        kill: vi.fn(),
      }
    }
  },
}))

const startSession = vi.fn(async () => ({ userAgent: 'test' }))
const shutdownCodex = vi.fn(async () => {})
const refreshMcp = vi.fn(async () => {})
const reloadUserConfig = vi.fn(async () => {})
const interruptTurn = vi.fn(async () => {})
const isRunning = vi.fn(() => true)

vi.mock('../api', () => ({
  CodexAppServerClient: class {
    startCodexSession = startSession
    shutdownCodex = shutdownCodex
    refreshMcpServers = refreshMcp
    reloadUserConfig = reloadUserConfig
    interruptTurn = interruptTurn
    isRunning = isRunning
    clearThreadBinding = vi.fn()
  },
}))

import {
  applyCodexRuntimeOptions,
  buildCodexProcessSignature,
  clearActiveTurnController,
  ensureGlobalCodexAppServer,
  registerActiveTurnController,
  resetGlobalCodexRuntimeForTests,
  runExclusiveRuntimeMutation,
  CODEX_RESTART_ERROR,
} from '../global-codex-runtime'
import type { CodexSessionOptions } from '../types'

const baseOptions = (): CodexSessionOptions => ({
  codexBinaryPath: 'codex',
  codexHome: './.Parlo/codex-home',
  transport: 'app-server',
  cwd: './',
  env: { PARLO_CODEX_PROVIDER_API_KEY: 'a' },
  configToml: 'model = "m"',
})

describe('global-codex-runtime mutation chain (PR4b)', () => {
  beforeEach(() => {
    resetGlobalCodexRuntimeForTests()
    writeConfig.mockClear()
    startSession.mockClear()
    shutdownCodex.mockClear()
    refreshMcp.mockClear()
    reloadUserConfig.mockClear()
    interruptTurn.mockClear()
    isRunning.mockReturnValue(true)
  })

  it('serializes exclusive mutations', async () => {
    const order: number[] = []
    await Promise.all([
      runExclusiveRuntimeMutation(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 20))
        order.push(2)
      }),
      runExclusiveRuntimeMutation(async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  it('builds process signatures that change when env keys change', () => {
    const a = buildCodexProcessSignature(baseOptions())
    const b = buildCodexProcessSignature({
      ...baseOptions(),
      env: { PARLO_CODEX_PROVIDER_API_KEY: 'b' },
    })
    expect(a).not.toBe(b)
  })

  it('ensureGlobalCodexAppServer starts once for same signature', async () => {
    const opts = baseOptions()
    await ensureGlobalCodexAppServer(opts)
    await ensureGlobalCodexAppServer(opts)
    expect(startSession).toHaveBeenCalledTimes(1)
  })

  it('applyCodexRuntimeOptions writes config under the exclusive chain', async () => {
    const opts = baseOptions()
    const client = await ensureGlobalCodexAppServer(opts)
    await applyCodexRuntimeOptions(client, 'thread-1', {
      ...opts,
      configToml: 'model = "other"',
      model: 'other',
    })
    expect(writeConfig).toHaveBeenCalled()
    expect(reloadUserConfig).toHaveBeenCalled()
  })

  it('aborts active turn controllers before restart with new env', async () => {
    const opts = baseOptions()
    await ensureGlobalCodexAppServer(opts)
    const controller = new AbortController()
    registerActiveTurnController('thread-1', controller)
    await ensureGlobalCodexAppServer({
      ...opts,
      env: { PARLO_CODEX_PROVIDER_API_KEY: 'rotated' },
    })
    expect(controller.signal.aborted).toBe(true)
    expect(String(controller.signal.reason ?? '')).toContain(
      CODEX_RESTART_ERROR.split(';')[0]
    )
    clearActiveTurnController('thread-1')
  })
})
