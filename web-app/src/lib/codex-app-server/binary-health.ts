/**
 * Codex binary resolve + health gate (DESIGN_CODEX_HOST PR6).
 * Product default: soft-warn (binaryHealthHardBlock = false).
 */

import { useCodexHostFlags } from '@/stores/codex-host-flags-store'

export type CodexBinaryHealth = {
  ok: boolean
  /** Soft issues still allow chat when hardBlock is false */
  severity: 'ok' | 'warn' | 'error'
  command: string
  message: string
  supportsAppServerStdio?: boolean
  version?: string
}

export type ProbeBinaryOptions = {
  command: string
  /** Run app-server --help (injectable for tests) */
  runHelp?: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>
  runVersion?: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>
}

/**
 * Probe whether a binary path/command looks usable for app-server --stdio.
 * Does not spawn the long-lived server.
 */
export async function probeCodexBinary(
  options: ProbeBinaryOptions
): Promise<CodexBinaryHealth> {
  const command = options.command.trim() || 'codex'
  if (!options.runHelp) {
    // Browser/desktop without injected probe: soft OK (Tauri spawn will fail clearly).
    return {
      ok: true,
      severity: 'warn',
      command,
      message:
        'Codex binary health probe not available in this environment; will validate on spawn.',
    }
  }

  try {
    const help = await options.runHelp(command)
    const text = `${help.stdout}\n${help.stderr}`.toLowerCase()
    const supports =
      text.includes('app-server') && text.includes('--stdio') && help.code === 0
    let version: string | undefined
    if (options.runVersion) {
      const ver = await options.runVersion(command)
      version = (ver.stdout || ver.stderr).trim().split('\n')[0]
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
      message: version ? `Codex ready (${version})` : 'Codex app-server --stdio available',
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
  const hardBlock = useCodexHostFlags.getState().binaryHealthHardBlock
  if (health.ok) return
  if (!hardBlock) {
    console.warn(`[Codex binary health] ${health.message}`)
    return
  }
  throw new Error(health.message)
}

/** True when chat should short-circuit (unusable binary + hard block). */
export function shouldBlockChatOnBinaryHealth(health: CodexBinaryHealth): boolean {
  if (health.ok) return false
  return useCodexHostFlags.getState().binaryHealthHardBlock
}
