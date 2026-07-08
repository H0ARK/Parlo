/** Default Codex binary candidates (DESIGN_CODEX_HOST PR6). */
export const CODEX_BINARY_DEFAULTS = {
  macosAppPath: '/Applications/Codex.app/Contents/Resources/codex',
  pathCommand: 'codex',
  /** Informational pin range for docs / diagnostics — not a hard gate. */
  recommendedVersionPrefix: 'codex-cli',
} as const

export function defaultCodexBinaryCandidate(): string {
  if (typeof IS_MACOS !== 'undefined' && IS_MACOS) {
    return CODEX_BINARY_DEFAULTS.macosAppPath
  }
  return CODEX_BINARY_DEFAULTS.pathCommand
}
