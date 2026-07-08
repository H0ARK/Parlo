#!/usr/bin/env node
/**
 * PR2.5 multi-provider spike CLI.
 *
 * Default: pure projection merge acceptance (no Codex binary required).
 * Optional live probe: CODEX_BINARY=... node scripts/codex/multi-provider-spike.mjs --live
 *
 * Exit 0 on PASS, 1 on FAIL.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../..')
const live = process.argv.includes('--live')

const defaultBinary =
  process.env.CODEX_BINARY ||
  (platform() === 'darwin' &&
  existsSync('/Applications/Codex.app/Contents/Resources/codex')
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex')

function runPureSpikeViaVitest() {
  const result = spawnSync(
    'yarn',
    [
      'vitest',
      'run',
      'src/lib/codex-app-server/__tests__/multi-provider-spike.test.ts',
    ],
    {
      cwd: join(root, 'web-app'),
      encoding: 'utf8',
      env: process.env,
    }
  )
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  return result.status === 0
}

function probeLiveBinary() {
  const help = spawnSync(defaultBinary, ['app-server', '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  const out = `${help.stdout || ''}\n${help.stderr || ''}`
  const supports =
    /app-server/i.test(out) && /--stdio/i.test(out) && help.status === 0
  console.log(
    supports
      ? `LIVE_PROBE PASS: ${defaultBinary} supports app-server --stdio`
      : `LIVE_PROBE SKIP/FAIL: binary=${defaultBinary} status=${help.status} (live multi-turn not required for pure spike green)`
  )
  return supports
}

console.log('=== Codex multi-provider spike (PR2.5) ===')
const pureOk = runPureSpikeViaVitest()
console.log(pureOk ? 'PURE_SPIKE PASS' : 'PURE_SPIKE FAIL')

if (live) {
  probeLiveBinary()
} else {
  console.log('LIVE_PROBE skipped (pass --live to probe CODEX_BINARY)')
}

// Pure spike green is the gate for PR3/PR4; live is informational.
process.exit(pureOk ? 0 : 1)
