#!/usr/bin/env node
/**
 * Capture a screenshot for the repo-local dev Jan process.
 *
 * This avoids Computer Use app-name ambiguity by first focusing the verified
 * `target/debug/Jan` process via `focus-dev.mjs`, then using macOS screenshot
 * capture for visual smoke evidence.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

const root = cwd()
const screenshotsDir = join(root, 'reports', 'codex-desktop-smoke', 'screenshots')

function run(command, args, timeout = 10_000) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.error ? String(result.error.message) : result.stderr?.toString() ?? '',
  }
}

function parseJson(output) {
  const startIndex = String(output ?? '').indexOf('{')
  if (startIndex < 0) return null
  try {
    return JSON.parse(String(output).slice(startIndex))
  } catch {
    return null
  }
}

mkdirSync(screenshotsDir, { recursive: true })

const focus = run('node', ['./scripts/codex/desktop/focus-dev.mjs'])
const focusReport = parseJson(focus.stdout)

if (!focus.ok || focusReport?.ok !== true || focusReport?.focused !== true) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'Could not focus repo-local dev Jan before screenshot.',
        focus: focusReport,
        stderr: focus.stderr,
      },
      null,
      2
    )
  )
  process.exit(1)
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const screenshotPath = join(screenshotsDir, `${timestamp}-dev-jan.png`)
const capture = run('screencapture', ['-x', screenshotPath], 10_000)

const report = {
  ok: capture.ok,
  screenshotPath,
  focus: focusReport,
  error: capture.ok ? undefined : capture.stderr || capture.stdout || `screencapture exited ${capture.status}`,
}

console.log(JSON.stringify(report, null, 2))
if (!capture.ok) process.exit(1)
