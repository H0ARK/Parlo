#!/usr/bin/env node
/**
 * Desktop smoke preflight for the Jan Codex runtime.
 *
 * This does not replace the real Tauri desktop smoke checklist. It verifies the
 * local prerequisites that should be true before a human starts that checklist.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd, execPath, platform } from 'node:process'

const root = cwd()
const defaultCodexBinary =
  platform === 'darwin' &&
  existsSync('/Applications/Codex.app/Contents/Resources/codex')
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex'
const codexBinary = process.env.CODEX_BINARY || defaultCodexBinary

function run(command, args, timeout = 10_000) {
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { __error: String(error) }
  }
}

function checkFile(path, label = path) {
  return {
    label,
    ok: existsSync(join(root, path)),
    detail: path,
  }
}

function parseMethodSurfaceReport(output) {
  const startIndex = output.indexOf('{')
  if (startIndex < 0) return null
  try {
    return JSON.parse(output.slice(startIndex))
  } catch {
    return null
  }
}

function parseJsonReport(output) {
  const startIndex = output.indexOf('{')
  if (startIndex < 0) return null
  try {
    return JSON.parse(output.slice(startIndex))
  } catch {
    return null
  }
}

function inspectRepoLocalJanRuntime() {
  const processList = run('pgrep', ['-lf', 'target/debug/Jan'], 5_000)
  const repoLocalJanProcesses = processList.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /\btarget\/debug\/Jan\b/.test(line))
  const janProcessList = run(
    'ps',
    ['-axo', 'pid=,comm=,command='],
    5_000
  )
  const otherJanProcesses = janProcessList.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line =>
      /\bJan(\.app|$)|target\/universal-apple-darwin\/.*\/Jan|MacOS\/Jan/.test(
        line
      )
    )
    .filter(line => !/\btarget\/debug\/Jan\b/.test(line))
    .filter(line => !/\b(?:rg|grep|ps)\b/.test(line))

  const localApiPortOwner = run(
    'lsof',
    ['-nP', '-iTCP:1337', '-sTCP:LISTEN'],
    5_000
  )
  const localApiPortOwnerLines = localApiPortOwner.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  return {
    repoLocalJanProcesses,
    otherJanProcesses,
    localApiPortOwnerLines,
  }
}

const packageJson = readJson(join(root, 'package.json'))
const scripts = packageJson.scripts ?? {}
const requireSmokeReportValidation = process.env.REQUIRE_SMOKE_REPORT === '1'
const requireJanDebugBridge = process.env.REQUIRE_JAN_DEBUG_BRIDGE === '1'
const smokeReportPath = process.env.SMOKE_REPORT_PATH?.trim()
const repoLocalJanRuntime = requireJanDebugBridge
  ? inspectRepoLocalJanRuntime()
  : null

const requiredScripts = [
  'dev:tauri',
  'build:tauri',
  'build:tauri:darwin',
  'build:web',
  'codex:parity:cli',
  'codex:parity:cli:commands',
  'codex:parity:appserver:methods',
  'codex:desktop:smoke:report',
  'codex:desktop:smoke:validate',
  'codex:desktop:ready',
  'codex:desktop:focus-dev',
  'codex:desktop:capture-dev',
  'jan:debug:mcp:self-test',
  'jan:debug:mcp:smoke',
]

const codexVersion = run(codexBinary, ['-V'])
const appServerHelp = run(codexBinary, ['app-server', '--help'])
const checklistText = existsSync(join(root, 'DESKTOP_SMOKE_CHECKLIST.md'))
  ? readFileSync(join(root, 'DESKTOP_SMOKE_CHECKLIST.md'), 'utf8')
  : ''
const methodSurfaceCheck = run(
  execPath,
  [join(root, 'scripts/codex/cli/method-surface-check.mjs')],
  20_000
)
const methodSurfaceReport = parseMethodSurfaceReport(methodSurfaceCheck.stdout)
const smokeReportValidatorSelfTest = run(
  execPath,
  [join(root, 'scripts/codex/desktop/validate-smoke-report.mjs'), '--self-test'],
  20_000
)
const janDebugMcpSelfTest = run('yarn', ['jan:debug:mcp:self-test'], 10_000)
const janDebugMcpLiveSmoke = requireJanDebugBridge
  ? run('yarn', ['jan:debug:mcp:smoke'], 10_000)
  : null
const janDebugMcpLiveReport = janDebugMcpLiveSmoke
  ? parseJsonReport(janDebugMcpLiveSmoke.stdout)
  : null
const threadsPanelSource = existsSync(
  join(root, 'web-app/src/containers/model-tools-panel/tools/ThreadsPanel.tsx')
)
  ? readFileSync(
      join(root, 'web-app/src/containers/model-tools-panel/tools/ThreadsPanel.tsx'),
      'utf8'
    )
  : ''
const modelToolsPanelSource = existsSync(
  join(root, 'web-app/src/containers/ModelToolsPanel.tsx')
)
  ? readFileSync(
      join(root, 'web-app/src/containers/ModelToolsPanel.tsx'),
      'utf8'
    )
  : ''
const desktopReadySource = existsSync(
  join(root, 'scripts/codex/desktop/ready.mjs')
)
  ? readFileSync(join(root, 'scripts/codex/desktop/ready.mjs'), 'utf8')
  : ''
const smokeReportSource = existsSync(
  join(root, 'scripts/codex/desktop/smoke-report.mjs')
)
  ? readFileSync(join(root, 'scripts/codex/desktop/smoke-report.mjs'), 'utf8')
  : ''
const smokeReportValidatorSource = existsSync(
  join(root, 'scripts/codex/desktop/validate-smoke-report.mjs')
)
  ? readFileSync(
      join(root, 'scripts/codex/desktop/validate-smoke-report.mjs'),
      'utf8'
    )
  : ''

const checks = [
  {
    label: 'Codex binary resolves',
    ok: codexVersion.ok,
    detail: codexVersion.ok
      ? codexVersion.stdout.trim() || codexVersion.stderr.trim()
      : `${codexBinary}: ${codexVersion.stderr || 'not runnable'}`,
  },
  {
    label: 'Codex app-server help exposes stdio',
    ok: appServerHelp.ok && /--stdio\b/.test(appServerHelp.stdout + appServerHelp.stderr),
    detail: appServerHelp.ok
      ? 'app-server --help contains --stdio'
      : appServerHelp.stderr || 'app-server --help failed',
  },
  ...requiredScripts.map((name) => ({
    label: `package script ${name}`,
    ok: typeof scripts[name] === 'string' && scripts[name].trim().length > 0,
    detail: scripts[name] ?? 'missing',
  })),
  checkFile('DESKTOP_SMOKE_CHECKLIST.md'),
  checkFile('scripts/codex-smoke-test.mjs'),
  checkFile('scripts/codex/cli/parity-check.mjs'),
  checkFile('scripts/codex/cli/commands-check.mjs'),
  checkFile('scripts/codex/cli/method-surface-check.mjs'),
  checkFile('scripts/codex/desktop/smoke-report.mjs'),
  checkFile('scripts/codex/desktop/validate-smoke-report.mjs'),
  checkFile('scripts/codex/desktop/ready.mjs'),
  checkFile('scripts/codex/desktop/focus-dev.mjs'),
  checkFile('scripts/codex/desktop/capture-dev.mjs'),
  checkFile('scripts/jan-debug-mcp.mjs'),
  checkFile('scripts/jan-debug-mcp-smoke.mjs'),
  checkFile('src-tauri/tauri.conf.json'),
  checkFile('src-tauri/capabilities/default.json'),
  checkFile('src-tauri/capabilities/desktop.json'),
  {
    label: 'Desktop checklist references smoke report workflow',
    ok: /codex:desktop:smoke:report|reports\/codex-desktop-smoke/.test(
      checklistText
    ),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop checklist references smoke report validation',
    ok: /codex:desktop:smoke:validate|validate-smoke-report/.test(checklistText),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop checklist references final ready gate',
    ok: /codex:desktop:ready/.test(checklistText),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop checklist references Jan debug bridge smoke',
    ok: /jan:debug:mcp:smoke|Jan debug bridge/.test(checklistText),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop checklist covers approval flow',
    ok: /Approval dialog|Approve for session|Deny/.test(checklistText),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop checklist covers clean shutdown',
    ok: /Clean Shutdown|terminated cleanly|zombie/.test(checklistText),
    detail: 'DESKTOP_SMOKE_CHECKLIST.md',
  },
  {
    label: 'Desktop smoke report validates when enforced',
    ok: !requireSmokeReportValidation
      ? true
      : (() => {
          const validateArgs = [join(root, 'scripts/codex/desktop/validate-smoke-report.mjs')]
          validateArgs.push(smokeReportPath || '--latest')
          const validate = run(
            execPath,
            validateArgs,
            20_000
          )
          if (validate.ok) return true
          return false
        })(),
    detail: requireSmokeReportValidation
      ? smokeReportPath
        ? `Desktop smoke report must pass validation: ${smokeReportPath}. Run yarn codex:desktop:smoke:validate ${smokeReportPath}.`
        : `Desktop smoke report must pass validation. Run yarn codex:desktop:smoke:validate --latest or pass a report path to yarn codex:desktop:ready.`
      : 'Optional validation gate (set REQUIRE_SMOKE_REPORT=1)',
  },
  {
    label: 'Desktop smoke report validator self-test passes',
    ok: smokeReportValidatorSelfTest.ok,
    detail: smokeReportValidatorSelfTest.ok
      ? smokeReportValidatorSelfTest.stdout.trim() || 'self-test passed'
      : smokeReportValidatorSelfTest.stderr ||
        smokeReportValidatorSelfTest.stdout.trim() ||
        'validator self-test failed',
  },
  {
    label: 'Final ready gate requires smoke report validation',
    ok: /REQUIRE_SMOKE_REPORT:\s*['"]1['"]/.test(desktopReadySource),
    detail: 'scripts/codex/desktop/ready.mjs',
  },
  {
    label: 'Final ready gate requires live Jan debug bridge validation',
    ok: /REQUIRE_JAN_DEBUG_BRIDGE:\s*['"]1['"]/.test(desktopReadySource),
    detail: 'scripts/codex/desktop/ready.mjs',
  },
  {
    label: 'Smoke report generation enforces live Jan debug bridge preflight',
    ok: /REQUIRE_JAN_DEBUG_BRIDGE:\s*['"]1['"]/.test(smokeReportSource),
    detail: 'scripts/codex/desktop/smoke-report.mjs',
  },
  {
    label: 'Smoke report validator parses Jan debug bridge JSON evidence',
    ok:
      /parseJanDebugBridgeSnapshot/.test(smokeReportValidatorSource) &&
      /janDebugBridgeSnapshot\?\.ok\s*===\s*true/.test(
        smokeReportValidatorSource
      ) &&
      /janDebugBridgeSnapshot\?\.clientErrors\s*===\s*0/.test(
        smokeReportValidatorSource
      ) &&
      /janDebugBridgeSnapshot\?\.selectedProvider\s*===\s*['"]codex['"]/.test(
        smokeReportValidatorSource
      ) &&
      /responseCount/.test(smokeReportValidatorSource) &&
      /smokeEvidence\?\.routeReady\s*===\s*true/.test(
        smokeReportValidatorSource
      ) &&
      /smokeEvidence\?\.selectedModelReady\s*===\s*true/.test(
        smokeReportValidatorSource
      ) &&
      /smokeEvidence\?\.selectedModelInProviderCatalog\s*===\s*true/.test(
        smokeReportValidatorSource
      ) &&
      /smokeEvidence\?\.serverStatus\s*===\s*['"]running['"]/.test(
        smokeReportValidatorSource
      ) &&
      /smokeEvidence\?\.hasCodexAppServerLogs\s*===\s*true/.test(
        smokeReportValidatorSource
      ) &&
      /smokeEvidence\?\.clientErrorCount\s*===\s*0/.test(
        smokeReportValidatorSource
      ),
    detail: 'scripts/codex/desktop/validate-smoke-report.mjs',
  },
  {
    label: 'Jan debug MCP self-test passes',
    ok: janDebugMcpSelfTest.ok,
    detail: janDebugMcpSelfTest.ok
      ? janDebugMcpSelfTest.stdout.trim() || 'jan debug MCP self-test passed'
      : janDebugMcpSelfTest.stderr ||
        janDebugMcpSelfTest.stdout.trim() ||
        'jan debug MCP self-test failed',
  },
  {
    label: 'Jan debug bridge live snapshot validates when enforced',
    ok: requireJanDebugBridge
      ? janDebugMcpLiveSmoke?.ok === true &&
        janDebugMcpLiveReport?.clientErrors === 0
      : true,
    detail: requireJanDebugBridge
      ? janDebugMcpLiveSmoke?.ok
        ? janDebugMcpLiveReport?.clientErrors === 0
          ? janDebugMcpLiveSmoke.stdout.trim() || 'live Jan debug bridge smoke passed'
          : `Jan debug bridge reported clientErrors=${janDebugMcpLiveReport?.clientErrors ?? 'unknown'}. Fix webview client errors before desktop smoke.`
        : janDebugMcpLiveSmoke?.stderr ||
          janDebugMcpLiveSmoke?.stdout.trim() ||
          'Run yarn dev:tauri for the repo-local app, then yarn jan:debug:mcp:smoke.'
      : 'Optional live bridge gate (set REQUIRE_JAN_DEBUG_BRIDGE=1)',
  },
  {
    label: 'Jan debug bridge live snapshot uses Codex provider when enforced',
    ok: requireJanDebugBridge
      ? janDebugMcpLiveReport?.selectedProvider === 'codex'
      : true,
    detail: requireJanDebugBridge
      ? janDebugMcpLiveReport?.selectedProvider === 'codex'
        ? `selectedProvider=${janDebugMcpLiveReport.selectedProvider}, selectedModel=${janDebugMcpLiveReport.selectedModel ?? 'unknown'}`
        : `selectedProvider=${janDebugMcpLiveReport?.selectedProvider ?? 'unknown'}, selectedModel=${janDebugMcpLiveReport?.selectedModel ?? 'unknown'}. Select or create a Codex-runtime chat before desktop smoke.`
      : 'Optional Codex-provider gate (set REQUIRE_JAN_DEBUG_BRIDGE=1)',
  },
  {
    label: 'Repo-local Jan runtime is unambiguous when bridge is enforced',
    ok: requireJanDebugBridge
      ? (repoLocalJanRuntime?.repoLocalJanProcesses.length ?? 0) === 1 &&
        (repoLocalJanRuntime?.otherJanProcesses.length ?? 0) === 0
      : true,
    detail: requireJanDebugBridge
      ? JSON.stringify(
          {
            repoLocalJanProcesses:
              repoLocalJanRuntime?.repoLocalJanProcesses ?? [],
            otherJanProcesses:
              repoLocalJanRuntime?.otherJanProcesses ?? [],
            localApiPort1337:
              repoLocalJanRuntime?.localApiPortOwnerLines ?? [],
          },
          null,
          2
        )
      : 'Optional duplicate-process gate (set REQUIRE_JAN_DEBUG_BRIDGE=1)',
  },
  {
    label: 'Thread panel exposes Clean terminals action',
    ok: /Clean terminals/.test(threadsPanelSource),
    detail: 'web-app/src/containers/model-tools-panel/tools/ThreadsPanel.tsx',
  },
  {
    label: 'ModelToolsPanel wires clean terminals handler',
    ok: /onCleanTerminals\s*[:=]\s*\(?\s*[\n\r ]*\)?\s*=>[\s\S]*cleanCodexBackgroundTerminals/.test(
      modelToolsPanelSource
    ),
    detail: 'web-app/src/containers/ModelToolsPanel.tsx',
  },
  {
    label: 'Codex app-server method surface audit passes',
    ok: methodSurfaceCheck.ok && methodSurfaceReport?.overall === 'passed',
    detail: methodSurfaceReport?.overall === 'passed'
      ? `overall=${methodSurfaceReport.overall}, methods=${methodSurfaceReport.upstreamMethods?.length ?? 0}`
      : methodSurfaceCheck.stderr ||
        methodSurfaceCheck.stdout.trim() ||
        'method-surface audit failed',
  },
]

const failed = checks.filter((check) => !check.ok)
const report = {
  timestamp: new Date().toISOString(),
  codexBinary,
  overall: failed.length ? 'failed' : 'passed',
  checks,
}

for (const check of checks) {
  const status = check.ok ? 'PASS' : 'FAIL'
  console.log(`${status} ${check.label} - ${check.detail}`)
}
console.log(JSON.stringify(report, null, 2))

if (failed.length) {
  process.exitCode = 1
}
