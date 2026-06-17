#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_STATE_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Jan',
  'data',
  '.jan-debug',
  'state.json'
)

const statePath = process.env.JAN_DEBUG_STATE_PATH || DEFAULT_STATE_PATH

const tools = [
  {
    name: 'jan_debug_ping_app',
    description: 'Check whether the Jan debug bridge snapshot is available.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_state',
    description: 'Return the complete sanitized Jan debug bridge snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_route',
    description: 'Return Jan route/window location from the debug bridge.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_selected_model',
    description: 'Return selected provider/model and provider model ids.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_codex_runtime',
    description: 'Return recent Codex app-server logs and process events.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_threads',
    description: 'Return current and recent Jan thread summaries.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_client_diagnostics',
    description: 'Return recent Jan webview console warnings/errors and unhandled client exceptions.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'jan_debug_get_smoke_evidence',
    description: 'Return a compact desktop-smoke evidence summary derived from the sanitized Jan debug snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

const readState = () => {
  if (!existsSync(statePath)) {
    return {
      ok: false,
      statePath,
      error: 'Jan debug bridge snapshot not found. Start the Jan Tauri app and wait for .jan-debug/state.json.',
    }
  }

  try {
    return {
      ok: true,
      statePath,
      state: JSON.parse(readFileSync(statePath, 'utf8')),
    }
  } catch (error) {
    return {
      ok: false,
      statePath,
      error: String(error),
    }
  }
}

const snapshotMeta = (snapshot) => {
  const generatedAt = snapshot.state?.generatedAt
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : NaN
  const ageMs = Number.isFinite(generatedAtMs) ? Date.now() - generatedAtMs : null

  return {
    statePath: snapshot.statePath,
    generatedAt,
    snapshotAgeMs: ageMs,
  }
}

const content = (value) => [
  {
    type: 'text',
    text: JSON.stringify(value, null, 2),
  },
]

const buildSmokeEvidence = (state) => {
  const recentLogs = Array.isArray(state.codexRuntime?.recentLogs)
    ? state.codexRuntime.recentLogs
    : []
  const recentProcessEvents = Array.isArray(state.codexRuntime?.recentProcessEvents)
    ? state.codexRuntime.recentProcessEvents
    : []
  const recentDiagnostics = Array.isArray(state.clientDiagnostics?.recent)
    ? state.clientDiagnostics.recent
    : []
  const recentThreads = Array.isArray(state.thread?.recentThreads)
    ? state.thread.recentThreads
    : []
  const providerModelIds = Array.isArray(state.model?.providers)
    ? state.model.providers.flatMap((provider) =>
        Array.isArray(provider?.modelIds) ? provider.modelIds : []
      )
    : []

  return {
    routeReady: Boolean(state.route?.pathname),
    selectedModelReady: Boolean(
      state.model?.selectedProvider && state.model?.selectedModel?.id
    ),
    selectedProvider: state.model?.selectedProvider ?? null,
    selectedModel: state.model?.selectedModel?.id ?? null,
    selectedModelInProviderCatalog: providerModelIds.includes(
      state.model?.selectedModel?.id
    ),
    serverStatus: state.app?.serverStatus ?? null,
    hasCodexAppServerLogs: recentLogs.some((entry) =>
      String(entry?.sessionId ?? '').includes('codex-app-server')
    ),
    codexRuntimeLogCount: state.codexRuntime?.logCount ?? 0,
    codexRuntimeProcessEventCount: state.codexRuntime?.processEventCount ?? 0,
    hasProcessEvents: recentProcessEvents.length > 0,
    currentThreadId: state.thread?.currentThreadId ?? null,
    hasCurrentThread: Boolean(state.thread?.currentThreadId),
    threadCount: state.thread?.threadCount ?? 0,
    recentThreadCount: recentThreads.length,
    permissionPending: Boolean(state.permissions?.pending),
    rememberedPermissionCount: state.permissions?.rememberedCount ?? 0,
    userInputPending: Boolean(state.userInput?.pending),
    clientWarningCount: state.clientDiagnostics?.warningCount ?? 0,
    clientErrorCount: state.clientDiagnostics?.errorCount ?? 0,
    recentErrorMessages: recentDiagnostics
      .filter((entry) => entry?.level === 'error')
      .slice(-5)
      .map((entry) => entry.message),
  }
}

const callTool = (name) => {
  const snapshot = readState()
  const meta = snapshotMeta(snapshot)
  if (name === 'jan_debug_ping_app') {
    return {
      content: content({
        ok: snapshot.ok,
        ...meta,
        source: snapshot.state?.source,
        error: snapshot.error,
      }),
    }
  }
  if (!snapshot.ok) return { content: content(snapshot), isError: true }

  const state = snapshot.state
  switch (name) {
    case 'jan_debug_get_state':
      return { content: content({ ...meta, ...state }) }
    case 'jan_debug_get_route':
      return { content: content({ ...meta, route: state.route }) }
    case 'jan_debug_get_selected_model':
      return { content: content({ ...meta, ...state.model }) }
    case 'jan_debug_get_codex_runtime':
      return { content: content({ ...meta, ...state.codexRuntime }) }
    case 'jan_debug_get_threads':
      return { content: content({ ...meta, ...state.thread }) }
    case 'jan_debug_get_client_diagnostics':
      return { content: content({ ...meta, ...state.clientDiagnostics }) }
    case 'jan_debug_get_smoke_evidence':
      return { content: content({ ...meta, ...buildSmokeEvidence(state) }) }
    default:
      return {
        content: content({ error: `Unknown tool: ${name}` }),
        isError: true,
      }
  }
}

const send = (message) => {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

let buffer = Buffer.alloc(0)

const handleMessage = (message) => {
  if (!message || typeof message !== 'object') return
  const { id, method, params } = message

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'jan-debug-mcp', version: '0.1.0' },
      },
    })
    return
  }

  if (method === 'notifications/initialized') return

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } })
    return
  }

  if (method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id,
      result: callTool(params?.name),
    })
    return
  }

  if (typeof id !== 'undefined') {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    })
  }
}

const pump = () => {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) return
    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8')
    buffer = buffer.slice(bodyEnd)
    try {
      handleMessage(JSON.parse(body))
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: String(error) },
      })
    }
  }
}

if (process.argv.includes('--self-test')) {
  console.log(
    JSON.stringify({
      ok: true,
      statePath,
      toolCount: tools.length,
      tools: tools.map((tool) => tool.name),
    })
  )
  process.exit(0)
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  pump()
})
