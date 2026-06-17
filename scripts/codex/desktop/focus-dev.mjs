#!/usr/bin/env node
/**
 * Focus the repo-local dev Jan process for manual desktop smoke.
 *
 * Computer Use resolves the registered Jan bundle and can launch a built release
 * app instead of attaching to `target/debug/Jan`. This helper is intentionally
 * narrow: it verifies the dev runtime identity and brings that PID frontmost
 * without launching any app bundle.
 */

import { spawnSync } from 'node:child_process'

function run(command, args, timeout = 5_000) {
  const result = spawnSync(command, args, {
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

function findRuntime() {
  const processList = run('ps', ['-axo', 'pid=,comm=,command='])
  const lines = processList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const repoLocalJanProcesses = lines
    .filter((line) => /\btarget\/debug\/Jan\b/.test(line))
    .filter((line) => !/\b(?:rg|grep|ps)\b/.test(line))
  const otherJanProcesses = lines
    .filter((line) =>
      /\bJan(\.app|$)|target\/universal-apple-darwin\/.*\/Jan|MacOS\/Jan/.test(
        line
      )
    )
    .filter((line) => !/\btarget\/debug\/Jan\b/.test(line))
    .filter((line) => !/\b(?:rg|grep|ps)\b/.test(line))

  return {
    repoLocalJanProcesses,
    otherJanProcesses,
  }
}

function pidFromProcessLine(line) {
  const match = String(line ?? '').match(/^(\d+)\s+/)
  return match?.[1] ?? null
}

const runtime = findRuntime()
const pid = pidFromProcessLine(runtime.repoLocalJanProcesses[0])

if (runtime.repoLocalJanProcesses.length !== 1 || !pid) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'Expected exactly one repo-local target/debug/Jan process.',
        ...runtime,
      },
      null,
      2
    )
  )
  process.exit(1)
}

if (runtime.otherJanProcesses.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'Other Jan GUI/runtime processes are present. Stop them before manual dev smoke.',
        ...runtime,
      },
      null,
      2
    )
  )
  process.exit(1)
}

const focus = run('osascript', [
  '-e',
  `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
])

const report = {
  ok: focus.ok,
  pid: Number(pid),
  repoLocalJanProcesses: runtime.repoLocalJanProcesses,
  otherJanProcesses: runtime.otherJanProcesses,
  focused: focus.ok,
  error: focus.ok ? undefined : focus.stderr || focus.stdout || `osascript exited ${focus.status}`,
}

console.log(JSON.stringify(report, null, 2))
if (!focus.ok) process.exit(1)
