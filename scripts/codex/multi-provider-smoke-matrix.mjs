#!/usr/bin/env node
/**
 * PR10 multi-provider host smoke matrix (automated gates).
 * Complements DESKTOP_SMOKE_CHECKLIST.md manual desktop checks.
 */

import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const webApp = join(root, 'web-app')

const suites = [
  'src/lib/codex-app-server/__tests__/model-route.test.ts',
  'src/lib/codex-app-server/__tests__/multi-provider-spike.test.ts',
  'src/lib/codex-app-server/__tests__/config-lease.test.ts',
  'src/lib/codex-app-server/__tests__/global-codex-runtime.test.ts',
  'src/lib/codex-app-server/__tests__/engine-readiness.test.ts',
  'src/lib/codex-app-server/__tests__/binary-health.test.ts',
  'src/lib/codex-app-server/__tests__/capability-barrels.test.ts',
  'src/lib/codex-app-server/__tests__/chat-backend.test.ts',
  'src/stores/__tests__/codex-runtime-diagnostics-store.test.ts',
]

console.log('=== Multi-provider host smoke matrix (PR10) ===')
const result = spawnSync(
  'yarn',
  ['vitest', 'run', ...suites],
  { cwd: webApp, encoding: 'utf8', env: process.env }
)
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')

const ok = result.status === 0
console.log(ok ? 'SMOKE_MATRIX PASS' : 'SMOKE_MATRIX FAIL')
console.log(`Suites: ${suites.length}`)
process.exit(ok ? 0 : 1)
