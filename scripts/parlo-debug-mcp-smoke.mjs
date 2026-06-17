#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const statePath =
  process.env.JAN_DEBUG_STATE_PATH ||
  join(homedir(), 'Library/Application Support/Jan/data/.jan-debug/state.json')
const maxSnapshotAgeMs = Number(process.env.JAN_DEBUG_MAX_AGE_MS || 15000)
const allowClientErrors = process.env.JAN_DEBUG_ALLOW_CLIENT_ERRORS === '1'

function frame(message) {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

function parseFrames(buffer) {
  const messages = []
  let rest = buffer

  while (true) {
    const separator = rest.indexOf('\r\n\r\n')
    if (separator === -1) break

    const header = rest.slice(0, separator)
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
    if (!lengthMatch) break

    const length = Number(lengthMatch[1])
    const bodyStart = separator + 4
    const bodyEnd = bodyStart + length
    if (rest.length < bodyEnd) break

    const body = rest.slice(bodyStart, bodyEnd)
    try {
      messages.push(JSON.parse(body))
    } catch (error) {
      messages.push({ parseError: error.message, raw: body })
    }
    rest = rest.slice(bodyEnd)
  }

  return { messages, rest }
}

async function ensureSnapshotExists() {
  await access(statePath, constants.R_OK)
  const raw = await readFile(statePath, 'utf8')
  const snapshot = JSON.parse(raw)
  const generatedAtMs = Date.parse(snapshot.generatedAt)
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error('Snapshot is missing a valid generatedAt timestamp')
  }
  const ageMs = Date.now() - generatedAtMs
  if (ageMs > maxSnapshotAgeMs) {
    throw new Error(
      `Snapshot is stale: age=${ageMs}ms max=${maxSnapshotAgeMs}ms. Start the repo-local Jan Tauri app and wait for the bridge to refresh.`
    )
  }
  return { snapshot, ageMs }
}

async function main() {
  const { snapshot, ageMs } = await ensureSnapshotExists()
  const child = spawn(process.execPath, [new URL('./jan-debug-mcp.mjs', import.meta.url).pathname], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, JAN_DEBUG_STATE_PATH: statePath },
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'jan-debug-mcp-smoke', version: '0.1.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'jan_debug_get_selected_model', arguments: {} },
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'jan_debug_get_route', arguments: {} },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'jan_debug_get_client_diagnostics', arguments: {} },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'jan_debug_get_smoke_evidence', arguments: {} },
    },
  ]

  child.stdin.write(requests.map(frame).join(''))
  child.stdin.end()

  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(124)
    }, 5000)

    child.on('exit', code => {
      clearTimeout(timer)
      resolve(code ?? 0)
    })
  })

  const { messages } = parseFrames(stdout)
  const selectedResponse = messages.find(message => message.id === 2)
  const routeResponse = messages.find(message => message.id === 3)
  const diagnosticsResponse = messages.find(message => message.id === 4)
  const smokeEvidenceResponse = messages.find(message => message.id === 5)

  if (
    !selectedResponse?.result ||
    !routeResponse?.result ||
    !diagnosticsResponse?.result ||
    !smokeEvidenceResponse?.result
  ) {
    throw new Error(`MCP smoke failed: missing tool responses. exit=${exitCode} stderr=${stderr.trim()}`)
  }

  const selectedPayload = JSON.parse(selectedResponse.result.content[0].text)
  const routePayload = JSON.parse(routeResponse.result.content[0].text)
  const diagnosticsPayload = JSON.parse(diagnosticsResponse.result.content[0].text)
  const smokeEvidencePayload = JSON.parse(smokeEvidenceResponse.result.content[0].text)

  if (
    typeof selectedPayload.snapshotAgeMs === 'number' &&
    selectedPayload.snapshotAgeMs > maxSnapshotAgeMs
  ) {
    throw new Error(
      `MCP returned a stale selected-model snapshot: age=${selectedPayload.snapshotAgeMs}ms max=${maxSnapshotAgeMs}ms`
    )
  }
  if (!selectedPayload.selectedProvider || !selectedPayload.selectedModel?.id) {
    throw new Error(
      `MCP selected-model snapshot is incomplete: provider=${selectedPayload.selectedProvider ?? 'missing'} model=${selectedPayload.selectedModel?.id ?? 'missing'}`
    )
  }
  if (!routePayload.route?.pathname) {
    throw new Error('MCP route snapshot is incomplete: missing route.pathname')
  }

  const report = {
    ok: true,
    statePath,
    snapshotGeneratedAt: snapshot.generatedAt,
    snapshotAgeMs: ageMs,
    selectedProvider: selectedPayload.selectedProvider ?? null,
    selectedModel: selectedPayload.selectedModel?.id ?? null,
    route: routePayload.route?.pathname ?? null,
    clientWarnings: diagnosticsPayload.warningCount ?? null,
    clientErrors: diagnosticsPayload.errorCount ?? null,
    smokeEvidence: {
      routeReady: smokeEvidencePayload.routeReady ?? null,
      selectedModelReady: smokeEvidencePayload.selectedModelReady ?? null,
      selectedModelInProviderCatalog:
        smokeEvidencePayload.selectedModelInProviderCatalog ?? null,
      serverStatus: smokeEvidencePayload.serverStatus ?? null,
      hasCodexAppServerLogs: smokeEvidencePayload.hasCodexAppServerLogs ?? null,
      codexRuntimeLogCount: smokeEvidencePayload.codexRuntimeLogCount ?? null,
      codexRuntimeProcessEventCount:
        smokeEvidencePayload.codexRuntimeProcessEventCount ?? null,
      hasCurrentThread: smokeEvidencePayload.hasCurrentThread ?? null,
      threadCount: smokeEvidencePayload.threadCount ?? null,
      permissionPending: smokeEvidencePayload.permissionPending ?? null,
      userInputPending: smokeEvidencePayload.userInputPending ?? null,
      clientErrorCount: smokeEvidencePayload.clientErrorCount ?? null,
    },
    responseCount: messages.length,
  }

  if (!allowClientErrors && Number(report.clientErrors ?? 0) > 0) {
    throw new Error(
      `Jan debug bridge reported clientErrors=${report.clientErrors}. Fix webview client errors before desktop smoke, or set JAN_DEBUG_ALLOW_CLIENT_ERRORS=1 for investigation.`
    )
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, statePath, error: error.message }, null, 2))
  process.exit(1)
})
