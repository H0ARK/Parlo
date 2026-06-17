#!/usr/bin/env node
/**
 * Final readiness gate for Jan Codex clone v1 desktop validation.
 *
 * This runs the desktop preflight with REQUIRE_SMOKE_REPORT=1 and
 * REQUIRE_JAN_DEBUG_BRIDGE=1 so v1 readiness cannot pass until an interactive
 * desktop smoke report is filled and validated by validate-smoke-report.mjs,
 * and the repo-local Jan debug bridge has a fresh zero-client-error snapshot.
 * By default this validates the latest report; pass a report path to validate a
 * specific filled report.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { cwd, execPath, exit } from 'node:process'

const root = cwd()
const reportPath = process.argv.find((arg) => arg.endsWith('.md'))
const result = spawnSync(
  execPath,
  [join(root, 'scripts/codex/desktop/preflight.mjs')],
  {
    cwd: root,
    env: {
      ...process.env,
      REQUIRE_SMOKE_REPORT: '1',
      REQUIRE_JAN_DEBUG_BRIDGE: '1',
      ...(reportPath ? { SMOKE_REPORT_PATH: reportPath } : {}),
    },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  }
)

exit(result.status ?? 1)
