/**
 * Codex binary resolve + health gate (DESIGN_CODEX_HOST PR6).
 * Product default: soft-warn (binaryHealthHardBlock = false).
 *
 * Real probe uses Tauri `run_codex_cli_subcommand` for `app-server --help` and `-V`
 * so missing/unusable binaries surface as warn (or hard-block when flagged).
 */

import { invoke } from '@tauri-apps/api/core'
import { useCodexHostFlags } from '@/stores/codex-host-flags-store'
import { isPlatformTauri } from '@/lib/platform/utils'

export type CodexBinaryHealth = {
  ok: boolean
  /** Soft issues still allow chat when hardBlock is false */
  severity: 'ok' | 'warn' | 'error'
  command: string
  message: string
  supportsAppServerStdio?: boolean
  version?: string
}

export type CliProbeResult = {
  stdout: string
  stderr: string
  code: number
}

export type ProbeBinaryOptions = {
  command: string
  /** Run app-server --help (injectable for tests) */
  runHelp?: (command: string) => Promise<CliProbeResult>
  runVersion?: (command: string) => Promise<CliProbeResult>
}

type CodexCliRunResult = {
  stdout: string
  stderr: string
  exit_code?: number | null
}

/**
 * Default help/version runners via Tauri CLI bridge (real desktop path).
 */
export async function runCodexCliProbe(
  command: string,
  args: string[]
): Promise<CliProbeResult> {
  const result = await invoke<CodexCliRunResult>('run_codex_cli_subcommand', {
    command,
    args,
    cwd: null,
    codexHome: null,
    extraEnv: null,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.exit_code ?? 1,
  }
}

/**
 * Probe whether a binary path/command looks usable for app-server --stdio.
 * Does not spawn the long-lived server.
 *
 * When runHelp/runVersion are omitted:
 * - On Tauri: uses run_codex_cli_subcommand (real probe)
 * - Off Tauri (web): returns warn without claiming ok
 */
export async function probeCodexBinary(
  options: ProbeBinaryOptions
): Promise<CodexBinaryHealth> {
  const command = options.command.trim() || 'codex'

  const runHelp =
    options.runHelp ??
    (isPlatformTauri()
      ? (cmd: string) => runCodexCliProbe(cmd, ['app-server', '--help'])
      : undefined)
  const runVersion =
    options.runVersion ??
    (isPlatformTauri()
      ? (cmd: string) => runCodexCliProbe(cmd, ['-V'])
      : undefined)

  if (!runHelp) {
    return {
      ok: false,
      severity: 'warn',
      command,
      message:
        'Codex binary health probe unavailable outside desktop; configure codex-binary-path for desktop app-server.',
      supportsAppServerStdio: false,
    }
  }

  try {
    const help = await runHelp(command)
    const text = `${help.stdout}\n${help.stderr}`.toLowerCase()
    const supports =
      text.includes('app-server') && text.includes('--stdio') && help.code === 0
    let version: string | undefined
    if (runVersion) {
      try {
        const ver = await runVersion(command)
        version = (ver.stdout || ver.stderr).trim().split('\n')[0]
      } catch {
        // version is optional
      }
    }
    if (!supports) {
      return {
        ok: false,
        severity: 'error',
        command,
        message: `Codex binary does not support app-server --stdio: ${command}`,
        supportsAppServerStdio: false,
        version,
      }
    }
    return {
      ok: true,
      severity: 'ok',
      command,
      message: version
        ? `Codex ready (${version})`
        : 'Codex app-server --stdio available',
      supportsAppServerStdio: true,
      version,
    }
  } catch (error) {
    return {
      ok: false,
      severity: 'error',
      command,
      message:
        error instanceof Error
          ? error.message
          : `Failed to probe Codex binary: ${String(error)}`,
      supportsAppServerStdio: false,
    }
  }
}

/**
 * Soft-warn by default: returns health for UI banners.
 * Only throws when binaryHealthHardBlock is true and health is not ok.
 */
export async function assertCodexBinaryHealthForChat(
  health: CodexBinaryHealth
): Promise<void> {
  if (health.ok) return
  const hardBlock = useCodexHostFlags.getState().binaryHealthHardBlock
  if (!hardBlock) {
    console.warn(`[Codex binary health] ${health.message}`)
    return
  }
  throw new Error(health.message)
}

/** True when chat should short-circuit (unusable binary + hard block). */
export function shouldBlockChatOnBinaryHealth(
  health: CodexBinaryHealth
): boolean {
  if (health.ok) return false
  return useCodexHostFlags.getState().binaryHealthHardBlock
}
