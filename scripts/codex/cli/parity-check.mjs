#!/usr/bin/env node
/**
 * Headless Codex CLI parity check.
 *
 * This module validates that the active Codex CLI binary exposes the command
 * surface required by Jan's CLI bridge and that version/help flows stay stable.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function resolveBinary() {
  if (process.env.CODEX_BINARY) {
    return process.env.CODEX_BINARY
  }

  const candidateBinary =
    process.platform === 'darwin' &&
    existsSync('/Applications/Codex.app/Contents/Resources/codex')
      ? '/Applications/Codex.app/Contents/Resources/codex'
      : 'codex'

  return candidateBinary
}

const REQUIRED_COMMANDS = [
  'exec',
  'login',
  'logout',
  'completion',
  'apply',
  'cloud',
  'help',
  'app',
  'archive',
  'app-server',
  'mcp-server',
  'fork',
  'unarchive',
  'review',
  'doctor',
  'features',
  'sandbox',
  'update',
  'debug',
  'plugin',
  'resume',
  'exec-server',
  'mcp',
  'remote-control',
]
const OPTIONAL_COMMANDS = [
  'proto',
]
const DEFAULT_TIMEOUT_MS = 5000

function run(command, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const spawn = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  })

  return {
    ok: spawn.status === 0,
    exitCode: spawn.status,
    stdout: spawn.stdout?.toString() ?? '',
    stderr: spawn.error ? String(spawn.error.message) : spawn.stderr?.toString() ?? '',
    command,
    args,
  }
}

function parseHelpCommands(helpText) {
  const lines = helpText.split('\n')
  const commandsStartIndex = lines.findIndex((line) =>
    /^\s*(?:Available\s+)?Commands:/i.test(line)
  )
  if (commandsStartIndex === -1) return new Set()

  const commands = new Set()
  for (const line of lines.slice(commandsStartIndex + 1)) {
    const match = line.match(/^\s{2,}([A-Za-z][-\w]*)\b/)
    if (!match) {
      if (line.trim() === '') continue
      if (!line.startsWith(' ')) break
      continue
    }
    commands.add(match[1])
  }

  return commands
}

function runCommandHelp(binary, command) {
  const commandHelp = run(binary, [command, '--help'])
  if (commandHelp.ok) return commandHelp

  if (command === 'help') {
    return run(binary, ['help'])
  }

  return commandHelp
}

function runParityChecks(binary = 'codex') {
  const result = {
    timestamp: new Date().toISOString(),
    binary,
    required: Object.fromEntries(
      REQUIRED_COMMANDS.map((name) => [name, { available: false, helpOk: false }])
    ),
    optional: Object.fromEntries(
      OPTIONAL_COMMANDS.map((name) => [name, { available: false, helpOk: false }])
    ),
    version: {
      ok: false,
      command: '-V',
      value: '',
      stderr: '',
    },
    appServer: {
      direct: {
        ok: false,
        hasStdio: false,
        stderr: '',
      },
      npxFallback: {
        ok: false,
        hasStdio: false,
        stderr: '',
      },
    },
    overall: 'failed',
  }

  const help = run(binary, ['--help'])
  if (!help.ok) {
    return {
      result: {
        ...result,
        appServer: {
          direct: { ...result.appServer.direct, stderr: help.stderr },
          npxFallback: result.appServer.npxFallback,
        },
      },
      exitCode: 1,
    }
  }

  const commands = parseHelpCommands(help.stdout)
  for (const command of REQUIRED_COMMANDS) {
    const commandCheck = runCommandHelp(binary, command)
    result.required[command].available = commands.has(command)
    result.required[command].helpOk = commandCheck.ok
  }
  for (const command of OPTIONAL_COMMANDS) {
    result.optional[command].available = commands.has(command)
    if (result.optional[command].available) {
      const commandCheck = runCommandHelp(binary, command)
      result.optional[command].helpOk = commandCheck.ok
    }
  }

  const versionShort = run(binary, ['-V'])
  if (versionShort.ok) {
    result.version = {
      ok: true,
      command: '-V',
      value: versionShort.stdout.trim() || versionShort.stderr.trim(),
      stderr: versionShort.stderr,
    }
  } else {
    const versionLong = run(binary, ['--version'])
    result.version = {
      ok: versionLong.ok,
      command: '--version',
      value: versionLong.stdout.trim() || versionLong.stderr.trim(),
      stderr: versionLong.stderr,
    }
  }

  const appServerHelp = run(binary, ['app-server', '--help'])
  const hasDirectAppServerCommand = commands.has('app-server')
  result.appServer.direct.ok = appServerHelp.ok && hasDirectAppServerCommand
  const appServerText = `${appServerHelp.stdout}\n${appServerHelp.stderr}`
  result.appServer.direct.hasStdio = /--stdio|app-server --stdio/i.test(appServerText)
  result.appServer.direct.stderr = appServerHelp.stderr

  const npxHelp = run('npx', ['-y', '@openai/codex', 'app-server', '--help'], 12_000)
  const npxCommands = parseHelpCommands(
    run('npx', ['-y', '@openai/codex', '--help'], 12_000).stdout
  )
  const hasNpxAppServerCommand = npxCommands.has('app-server')
  result.appServer.npxFallback.ok = npxHelp.ok
    ? hasNpxAppServerCommand
    : false
  const npxText = `${npxHelp.stdout}\n${npxHelp.stderr}`
  result.appServer.npxFallback.hasStdio = /--stdio|app-server --stdio/i.test(npxText)
  result.appServer.npxFallback.stderr = npxHelp.stderr

  const allRequiredAvailable = REQUIRED_COMMANDS.every(
    (name) => result.required[name].available && result.required[name].helpOk
  )
  const versionOk = result.version.ok
  const appServerTransportMode = result.appServer.direct.ok || result.appServer.npxFallback.ok
  result.overall =
    allRequiredAvailable && versionOk && appServerTransportMode && (result.appServer.direct.hasStdio || result.appServer.npxFallback.hasStdio)
      ? 'passed'
      : 'failed'

  return { result, exitCode: result.overall === 'passed' ? 0 : 1 }
}

export function runCodexCliParityCheck() {
  return runParityChecks(resolveBinary())
}

export function runCodexCliParityCheckCli() {
  const { result, exitCode } = runCodexCliParityCheck()
  console.log(JSON.stringify(result, null, 2))

  if (!REQUIRED_COMMANDS.every((name) => result.required[name].available && result.required[name].helpOk)) {
    console.error('One or more expected CLI commands were unavailable or missing --help support.')
  }
  for (const [command, check] of Object.entries(result.optional)) {
    if (check.available && !check.helpOk) {
      console.warn(`${command} command exists but '${command} --help' failed; treated as optional.`)
    }
  }
  if (!result.version.ok) {
    console.error('Version probe failed.')
  }
  if (!result.appServer.direct.ok && !result.appServer.npxFallback.ok) {
    console.warn('app-server transport is not detected from direct binary or npx fallback.')
  }
 if (!result.appServer.direct.hasStdio && !result.appServer.npxFallback.hasStdio) {
    console.warn('app-server --stdio transport flag was not detected in help output.')
  }

  return exitCode
}

const targetScriptPath = fileURLToPath(import.meta.url)
const invocationPath = process.argv[1]
if (invocationPath && targetScriptPath === invocationPath) {
  process.exit(runCodexCliParityCheckCli())
}
