#!/usr/bin/env node
/**
 * Verify additional Codex CLI subcommands are discoverable and helpable.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function resolveBinary() {
  if (process.env.CODEX_BINARY) {
    return process.env.CODEX_BINARY
  }

  return process.platform === 'darwin' &&
    existsSync('/Applications/Codex.app/Contents/Resources/codex')
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex'
}

const REQUIRED_COMMANDS = [
  'exec',
  'review',
  'login',
  'logout',
  'mcp',
  'plugin',
  'mcp-server',
  'app-server',
  'remote-control',
  'app',
  'completion',
  'update',
  'doctor',
  'sandbox',
  'debug',
  'apply',
  'resume',
  'archive',
  'unarchive',
  'fork',
  'cloud',
  'exec-server',
  'features',
  'help',
]
const OPTIONAL_COMMANDS = [
  'proto',
]
const COMMAND_HELP_TIMEOUT_MS = 5000

function run(command, args, timeoutMs = COMMAND_HELP_TIMEOUT_MS) {
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
  }
}

function parseCommands(helpText) {
  const lines = helpText.split('\n')
  const commandStart = lines.findIndex((line) =>
    /^\s*(?:Available\s+)?Commands:/i.test(line)
  )
  if (commandStart === -1) return new Set()

  const found = new Set()
  for (const line of lines.slice(commandStart + 1)) {
    const match = line.match(/^\s{2,}([A-Za-z][-\w]*)\b/)
    if (!match) {
      if (line.trim() === '') continue
      if (!line.startsWith(' ')) break
      continue
    }
    found.add(match[1])
  }

  return found
}

function runCommandHelp(binary, command) {
  const commandHelp = run(binary, [command, '--help'])
  if (commandHelp.ok) return commandHelp

  if (command === 'help') {
    return run(binary, ['help'])
  }

  return commandHelp
}

function evaluate(binary = 'codex') {
  const result = {
    timestamp: new Date().toISOString(),
    binary,
    required: Object.fromEntries(
      REQUIRED_COMMANDS.map((name) => [name, { available: false, helpOk: false }])
    ),
    optional: Object.fromEntries(
      OPTIONAL_COMMANDS.map((name) => [name, { available: false, helpOk: false }])
    ),
    overall: 'failed',
  }

  const help = run(binary, ['--help'])
  if (!help.ok) {
    return { result: { ...result, output: help.stderr || help.stdout }, exitCode: 1 }
  }

  const availableCommands = parseCommands(help.stdout)
  for (const command of REQUIRED_COMMANDS) {
    result.required[command].available = availableCommands.has(command)
    const commandHelp = runCommandHelp(binary, command)
    result.required[command].helpOk = commandHelp.ok
  }
  for (const command of OPTIONAL_COMMANDS) {
    result.optional[command].available = availableCommands.has(command)
    if (result.optional[command].available) {
      const commandHelp = runCommandHelp(binary, command)
      result.optional[command].helpOk = commandHelp.ok
    }
  }

  const requiredCommandAvailable = REQUIRED_COMMANDS.every(
    (command) => result.required[command].available
  )
  const requiredCommandHelp = REQUIRED_COMMANDS.every(
    (command) => result.required[command].helpOk
  )
  result.overall = requiredCommandAvailable && requiredCommandHelp ? 'passed' : 'failed'

  return { result, exitCode: result.overall === 'passed' ? 0 : 1 }
}

export function runCodexCommandsParityCheck() {
  return evaluate(resolveBinary())
}

export function runCodexCommandsParityCheckCli() {
  const { result, exitCode } = runCodexCommandsParityCheck()
  console.log(JSON.stringify(result, null, 2))

  for (const [command, check] of Object.entries(result.required)) {
    if (!check.available) {
      console.error(`${command} command is not listed in Codex --help`)
    } else if (!check.helpOk) {
      const probeCommand = command === 'help' ? 'help' : `${command} --help`
      console.error(
        `${command} command exists but '${probeCommand}' failed`
      )
    }
  }

  for (const [command, check] of Object.entries(result.optional)) {
    if (check.available && !check.helpOk) {
      const probeCommand = command === 'help' ? 'help' : `${command} --help`
      console.error(
        `${command} command exists but '${probeCommand}' failed`
      )
    }
  }

  return exitCode
}

const targetScriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && process.argv[1] === targetScriptPath) {
  process.exit(runCodexCommandsParityCheckCli())
}
