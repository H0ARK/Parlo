#!/usr/bin/env node
/**
 * Generate a current desktop smoke report template for the Jan Codex runtime.
 *
 * This does not run the interactive Tauri smoke. It creates a timestamped,
 * current-commit report template so the remaining manual pass records evidence
 * consistently and does not rely on stale checklist metadata.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { cwd, platform } from 'node:process'

const root = cwd()
const reportsDir = join(root, 'reports', 'codex-desktop-smoke')
const checklistPath = join(root, 'DESKTOP_SMOKE_CHECKLIST.md')
const defaultCodexBinary =
  platform === 'darwin' && existsSync('/Applications/Codex.app/Contents/Resources/codex')
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex'
const codexBinary = process.env.CODEX_BINARY || defaultCodexBinary

function run(command, args, timeout = 10_000, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      ...env,
    },
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

function safeLine(value, fallback = 'unknown') {
  const trimmed = String(value ?? '').trim()
  return trimmed.length ? trimmed.replace(/\n/g, ' ') : fallback
}

function safeMultiline(value) {
  const text = String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim()
  return text.length ? text : 'No evidence collected yet.'
}

function parseJsonReport(output) {
  const startIndex = String(output ?? '').indexOf('{')
  if (startIndex < 0) return null
  try {
    return JSON.parse(String(output).slice(startIndex))
  } catch {
    return null
  }
}

function inspectDesktopRuntime() {
  const processList = run('pgrep', ['-lf', 'target/debug/Jan'], 5_000)
  const repoLocalJanProcesses = processList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\btarget\/debug\/Jan\b/.test(line))
  const janProcessList = run(
    'ps',
    ['-axo', 'pid=,comm=,command='],
    5_000
  )
  const otherJanProcesses = janProcessList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /\bJan(\.app|$)|target\/universal-apple-darwin\/.*\/Jan|MacOS\/Jan/.test(
        line
      )
    )
    .filter((line) => !/\btarget\/debug\/Jan\b/.test(line))
    .filter((line) => !/\b(?:rg|grep|ps)\b/.test(line))

  const localApiPortOwner = run(
    'lsof',
    ['-nP', '-iTCP:1337', '-sTCP:LISTEN'],
    5_000
  )
  const localApiPort1337 = localApiPortOwner.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    repoLocalJanProcesses,
    otherJanProcesses,
    localApiPort1337,
  }
}

function extractLaunchEvidence(logPath) {
  if (!logPath || !existsSync(logPath)) {
    return null
  }

  const raw = safeMultiline(readFileSync(logPath, 'utf8'))
  if (!raw) {
    return null
  }

  const lines = raw.split('\n')
  const signals = [
    'Frontend dev server',
    'Running BeforeDevCommand',
    'Running DevCommand',
    'Running `target/debug/Jan`',
    'Running target/debug/Jan',
    'Compiled',
    'Installing extensions',
    'App server',
  ]

  const matches = lines.filter((line) =>
    signals.some((signal) => line.includes(signal))
  )

  const selected = (matches.length ? matches : lines.slice(-40)).map((line) =>
    line.replace(/\u001b\[[0-9;]*m/g, '').trim()
  )

  if (!selected.length) {
    return null
  }

  return selected
    .slice(-30)
    .map((line) => `- ${line}`)
    .join('\n')
}

function extractChecklistSections(text) {
  const sections = []
  const lines = text.split('\n')
  let current = null
  for (const line of lines) {
    const heading = line.match(/^###\s+(.+)$/)
    if (heading) {
      current = { title: heading[1], checks: [] }
      sections.push(current)
      continue
    }
    const check = line.match(/^- \[ \]\s+(.+)$/)
    if (check && current) {
      current.checks.push(check[1])
    }
  }
  return sections
}

function getSourceWorktreeState() {
  const result = run('git', [
    'status',
    '--porcelain',
    '--',
    '.',
    ':(exclude)reports/codex-desktop-smoke',
  ])
  if (!result.ok) return 'unknown'
  return result.stdout.trim() ? 'dirty' : 'clean'
}

const now = new Date()
const timestamp = now.toISOString().replace(/[:.]/g, '-')
const branch = safeLine(run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout)
const commit = safeLine(run('git', ['rev-parse', '--short', 'HEAD']).stdout)
const sourceWorktree = getSourceWorktreeState()
const codexVersionResult = run(codexBinary, ['-V'])
const codexVersion = safeLine(
  codexVersionResult.stdout || codexVersionResult.stderr,
  `${codexBinary} not runnable`
)
const preflight = run(
  'yarn',
  ['codex:desktop:preflight'],
  30_000,
  { REQUIRE_JAN_DEBUG_BRIDGE: '1' }
)
const focusDev =
  /^dev:tauri\b/i.test((process.env.SMOKE_LAUNCH_MODE || '').trim())
    ? run('yarn', ['codex:desktop:focus-dev'], 10_000)
    : null
const screenshotCapture =
  process.env.SMOKE_CAPTURE_SCREEN === '1'
    ? run('yarn', ['codex:desktop:capture-dev'], 15_000)
    : null
const janDebugBridge = run('yarn', ['jan:debug:mcp:smoke'], 15_000)
const checklistText = existsSync(checklistPath) ? readFileSync(checklistPath, 'utf8') : ''
const sections = extractChecklistSections(checklistText)
const reportPath = join(reportsDir, `${timestamp}-${branch.replace(/[^a-zA-Z0-9._-]+/g, '-')}-${commit}.md`)

const launchEvidence = extractLaunchEvidence(
  process.env.SMOKE_LAUNCH_LOG
)
const launchMode = (process.env.SMOKE_LAUNCH_MODE || 'TODO dev:tauri / built app').trim()
const screenshotEvidence = (process.env.SMOKE_SCREENSHOTS || 'TODO paths or notes').trim()
const janDebugBridgeReport = parseJsonReport(janDebugBridge.stdout)
const desktopRuntimeReport = inspectDesktopRuntime()
const focusDevReport = focusDev ? parseJsonReport(focusDev.stdout) : null
const screenshotCaptureReport = screenshotCapture
  ? parseJsonReport(screenshotCapture.stdout)
  : null
const resolvedScreenshotEvidence =
  screenshotCapture?.ok && screenshotCaptureReport?.screenshotPath
    ? screenshotCaptureReport.screenshotPath
    : screenshotEvidence
const janDebugBridgeEvidence = janDebugBridge.ok
  ? janDebugBridgeReport?.clientErrors === 0
    ? `captured automatically; clientErrors=0\n\n\`\`\`json\n${safeMultiline(janDebugBridge.stdout)}\n\`\`\``
    : `TODO fix Jan debug bridge client errors before marking desktop smoke ready; clientErrors=${janDebugBridgeReport?.clientErrors ?? 'unknown'}\n\n\`\`\`json\n${safeMultiline(janDebugBridge.stdout)}\n\`\`\``
  : `TODO run yarn jan:debug:mcp:smoke against the repo-local desktop app\n\n\`\`\`text\n${safeMultiline(janDebugBridge.stdout || janDebugBridge.stderr)}\n\`\`\``
const processEventEvidence = launchEvidence
  ? `\n\n\n\`\`\`text\n${launchEvidence}\n\`\`\``
  : 'TODO'

const body = `# Jan Codex Runtime Desktop Smoke Report

- Date: ${now.toISOString()}
- Branch: ${branch}
- Commit: ${commit}
- Source worktree: ${sourceWorktree}
- Codex binary: ${codexBinary}
- Codex version: ${codexVersion}
- Checklist: ${existsSync(checklistPath) ? basename(checklistPath) : 'missing'}
- Preflight: ${preflight.ok ? 'passed' : 'failed'}

## Preflight output

\`\`\`text
${(preflight.stdout || preflight.stderr || 'no output').trim()}
\`\`\`

## Result summary

- Overall: TODO pass/fail
- Tester: TODO
- App launch mode: ${launchMode}
- Worktree status: ${sourceWorktree}
- Screenshots or recordings: ${resolvedScreenshotEvidence}
- Dev focus evidence: ${
  focusDev
    ? focusDev.ok
      ? `captured automatically; focused=${focusDevReport?.focused === true}`
      : 'TODO focus repo-local dev Jan before manual smoke'
    : 'not required for built app mode'
}

${
  focusDev
    ? `\`\`\`json\n${safeMultiline(focusDev.stdout || focusDev.stderr)}\n\`\`\`\n`
    : ''
}
- Jan debug bridge snapshot: ${janDebugBridgeEvidence}
- Desktop runtime process snapshot:

\`\`\`json
${JSON.stringify(desktopRuntimeReport, null, 2)}
\`\`\`

- New bugs found: TODO

## Test matrix

${sections
  .map((section) => {
    const checks = section.checks.length
      ? section.checks.map((check) => `- [ ] ${check}\n  Evidence: TODO`).join('\n')
      : '- [ ] Section exercised\n  Evidence: TODO'
    return `### ${section.title}\n\n${checks}`
  })
  .join('\n\n')}

## Required evidence attachments

- [ ] Approval dialog in action
  Evidence: TODO
- [ ] Streaming chat with command output
  Evidence: TODO
- [ ] Review panel after Codex edit
  Evidence: TODO
- [ ] Runtime terminal/process panel
  Evidence: TODO
- [ ] Process start / event logs
  Evidence:${processEventEvidence}

## Final decision

- [ ] Ready to mark Codex clone v1 complete
- [ ] Not ready; blockers listed below

Blockers:
- TODO
`

if (process.argv.includes('--write')) {
  mkdirSync(reportsDir, { recursive: true })
  writeFileSync(reportPath, body)
  console.log(reportPath)
} else {
  console.log(body)
}
