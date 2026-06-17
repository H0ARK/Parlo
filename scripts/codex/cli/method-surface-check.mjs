#!/usr/bin/env node
/**
 * Check Jan's codex app-server method surface against the active runtime's method surface.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const DEFAULT_CODEX_BINARY =
  process.platform === 'darwin'
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex'
const CODEX_BINARY = process.env.CODEX_BINARY || DEFAULT_CODEX_BINARY
const PROBE_METHOD = 'listMethods'
const FALLBACK_PROBE_METHOD = 'jan_method_surface_probe_does_not_exist'
const REQUEST_TIMEOUT_MS = 8_000

const CLIENT_METHOD_SOURCES = [
  'web-app/src/lib/codex-app-server/client.ts',
  'web-app/src/lib/codex-app-server/chat-backend.ts',
  'web-app/src/lib/codex-app-server/api.ts',
  'web-app/src/lib/codex-app-server/method-aliases.ts',
]
const RAW_RPC_CATALOG_SOURCE =
  'web-app/src/containers/model-tools-panel/tools/raw-rpc-utils.ts'

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function normalizeMethods(methods) {
  return Array.from(new Set(methods.filter(Boolean).map((value) => value.trim()))).sort()
}

function collectMethodsFromMethodAliases(sourceFile) {
  const rawText = readFileSync(resolve(process.cwd(), sourceFile), 'utf8')
  const aliasEntries = new Map()
  const aliasRegex = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g
  let match
  while ((match = aliasRegex.exec(rawText)) !== null) {
    const sourceMethod = match[1].trim()
    const fallbackMethod = match[2].trim()
    if (!isCodexMethodCandidate(sourceMethod) || !isCodexMethodCandidate(fallbackMethod)) {
      continue
    }
    aliasEntries.set(sourceMethod, fallbackMethod)
  }
  return aliasEntries
}

function isCodexMethodCandidate(value) {
  const normalized = value.trim()
  if (!normalized || normalized.includes(' ')) return false
  return (
    normalized.includes('/') ||
    /[A-Z]/.test(normalized) ||
    normalized.includes('_')
  )
}

function resolveAliasMethodChain(method, methodAliasMap, visited = new Set()) {
  if (!methodAliasMap.has(method)) {
    return {
      status: 'resolved',
      resolvedMethod: method,
      chain: [method],
    }
  }

  if (visited.has(method)) {
    return {
      status: 'cycle',
      resolvedMethod: null,
      chain: [...visited, method],
    }
  }

  visited.add(method)
  const fallback = methodAliasMap.get(method)
  if (!fallback) {
    return {
      status: 'resolved',
      resolvedMethod: method,
      chain: [method],
    }
  }

  const next = resolveAliasMethodChain(fallback, methodAliasMap, visited)
  if (next.status !== 'resolved') {
    return next
  }

  return {
    status: 'resolved',
    resolvedMethod: next.resolvedMethod,
    chain: [method, ...next.chain],
  }
}

function collectCalledMethodsFromSource(sourceFile, methodAliasMap) {
  const rawText = readFileSync(resolve(process.cwd(), sourceFile), 'utf8')
  const text = stripComments(rawText)
  const methods = new Set()
  const patterns = [
    /(?:this\.|return\s+)?requestAppServerWithFallback\(\s*['"]([^'"]+)['"]/g,
    /requestAppServer\(\s*['"]([^'"]+)['"]/g,
    /callCodexAppServer\([^,]+,\s*['"]([^'"]+)['"]/g,
    /\.rpc\.request\(\s*['"]([^'"]+)['"]/g,
    /unsupportedAppServerMethod\(\s*['"]([^'"]+)['"]/g,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const method = match[1].trim()
      const resolved = resolveAliasMethodChain(method, methodAliasMap)
      if (resolved.status === 'cycle') {
        logAliasCycle(resolved)
        continue
      }

      const resolvedMethod = resolved.resolvedMethod ?? method
      if (isCodexMethodCandidate(resolvedMethod)) {
        methods.add(resolvedMethod)
      }
    }
  }

  return methods
}

function collectMethodsFromRawRpcCatalog(sourceFile) {
  const rawText = readFileSync(resolve(process.cwd(), sourceFile), 'utf8')
  const methods = new Set()
  const methodRegex = /method:\s*['"]([^'"]+)['"]/g
  let match
  while ((match = methodRegex.exec(rawText)) !== null) {
    const method = match[1].trim()
    if (isCodexMethodCandidate(method)) methods.add(method)
  }
  return normalizeMethods(Array.from(methods))
}

function collectJanMethodSurface() {
  const methodAliasMap = collectMethodsFromMethodAliases(
    'web-app/src/lib/codex-app-server/method-aliases.ts'
  )
  const methodSet = new Set()
  for (const source of CLIENT_METHOD_SOURCES) {
    for (const method of collectCalledMethodsFromSource(source, methodAliasMap)) {
      methodSet.add(method)
    }
  }
  for (const fallback of methodAliasMap.values()) methodSet.add(fallback)
  return {
    methods: normalizeMethods(Array.from(methodSet)),
    aliases: Object.fromEntries(Array.from(methodAliasMap.entries())),
    methodAliasMap,
  }
}

function logAliasCycle(aliasIssue) {
  console.error(
    `[alias-cycle] ${aliasIssue.method} chain: ${aliasIssue.chain.join(' -> ')}`
  )
}

function collectMethodStrings(value, candidates) {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach((item) => collectMethodStrings(item, candidates))
    return
  }
  if (typeof value === 'string') {
    for (const match of value.matchAll(/`([^`]+)`/g)) {
      const value = match[1].trim()
      if (isCodexMethodCandidate(value)) {
        candidates.push(value)
      }
    }
    for (const match of value.matchAll(/["'`]?([a-z][A-Za-z0-9_]*\/[A-Za-z0-9_\/]*)["'`]?/g)) {
      candidates.push(match[1])
    }
    for (const match of value.matchAll(/\[[^\]]*\]/g)) {
      try {
        collectMethodStrings(JSON.parse(match[0]), candidates)
      } catch {
        // Ignore non-JSON list fragments.
      }
    }
    return
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value)) collectMethodStrings(nested, candidates)
  }
}

function parseMethodsFromResponsePayload(payload) {
  const candidates = []
  collectMethodStrings(payload?.result, candidates)
  collectMethodStrings(payload?.error, candidates)
  return normalizeMethods(candidates)
}

async function queryAppServerMethods(binary) {
  const child = spawn(binary, ['app-server', '--stdio'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stdout = createInterface({ input: child.stdout })
  const pending = new Map()
  const pendingTimeouts = new Map()
  const rawOutput = []
  const stderr = []
  let nextId = 1

  const close = (code, signal) => {
    for (const resolve of pending.values()) {
      resolve({
        id: null,
        error: {
          message: `app-server exited before response (${code ?? 'null'}, ${signal ?? 'null'})`,
        },
      })
    }
    pending.clear()
  }

  child.on('close', close)
  child.on('error', (error) => close(error instanceof Error ? error.message : 'error', null))
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))
  stdout.on('line', (line) => {
    rawOutput.push(line)
    try {
      const message = JSON.parse(line)
      if (message.id === undefined || message.id === null) return
      const callback = pending.get(message.id)
      if (!callback) return
      const timeout = pendingTimeouts.get(message.id)
      if (timeout) clearTimeout(timeout)
      pendingTimeouts.delete(message.id)
      pending.delete(message.id)
      callback(message)
    } catch {
      // Ignore noisy startup logs that are not JSON-RPC envelopes.
    }
  })

  const request = (method, params = {}) =>
    new Promise((resolveRequest) => {
      const id = nextId++
      const timeout = setTimeout(() => {
        pending.delete(id)
        pendingTimeouts.delete(id)
        resolveRequest({ id, error: { message: `Timeout waiting for response to method '${method}'.` } })
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, resolveRequest)
      pendingTimeouts.set(id, timeout)
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: '2.0', method, params })}\n`)
    })

  const notify = (method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  const initialize = await request('initialize', {
    clientInfo: { name: 'jan', title: 'Jan', version: '0.0.0' },
    capabilities: { experimentalApi: true },
  })
  notify('initialized')

  let probeResponse = await request(PROBE_METHOD)
  if (!probeResponse || probeResponse.error == null) {
    probeResponse = await request(FALLBACK_PROBE_METHOD)
  }

  const upstreamMethods = parseMethodsFromResponsePayload(probeResponse)
  child.stdin.end()
  child.kill()
  return { initialize, probe: probeResponse, upstreamMethods, rawOutput, stderr: stderr.join('') }
}

function compareMethodSurfaces(janMethods, upstreamMethods, methodAliasMap) {
  const upstreamSet = new Set(upstreamMethods.map((method) => method.trim()))
  const reverseAliasMap = new Map(Array.from(methodAliasMap.entries()).map(([source, fallback]) => [fallback, source]))
  const missing = []
  const fallbackCovered = []
  const aliasIssues = []
  for (const method of janMethods) {
    if (upstreamSet.has(method)) continue

    const aliasResolution = resolveAliasMethodChain(method, methodAliasMap)
    if (aliasResolution.status === 'cycle') {
      aliasIssues.push({ method, chain: aliasResolution.chain })
      continue
    }

    const fallback = aliasResolution.resolvedMethod
    if (fallback && upstreamSet.has(fallback) && fallback !== method) {
      fallbackCovered.push({ method, fallback, chain: aliasResolution.chain })
      continue
    }

    const reverseFallback = reverseAliasMap.get(method)
    if (reverseFallback && upstreamSet.has(reverseFallback)) {
      const reverseResolution = resolveAliasMethodChain(reverseFallback, methodAliasMap)
      if (reverseResolution.status === 'cycle') {
        aliasIssues.push({ method, chain: reverseResolution.chain })
        continue
      }

      fallbackCovered.push({
        method,
        fallback: reverseFallback,
        chain: [...reverseResolution.chain, method],
      })
      continue
    }

    missing.push(method)
  }
  const janSet = new Set(janMethods)
  return { missing, fallbackCovered, aliasIssues, extras: upstreamMethods.filter((method) => !janSet.has(method)) }
}

function compareRawRpcCatalogMethods(catalogMethods, upstreamMethods, methodAliasMap) {
  const upstreamSet = new Set(upstreamMethods.map((method) => method.trim()))
  const missing = []
  const fallbackCovered = []
  const aliasIssues = []
  for (const method of catalogMethods) {
    if (upstreamSet.has(method)) continue

    const aliasResolution = resolveAliasMethodChain(method, methodAliasMap)
    if (aliasResolution.status === 'cycle') {
      aliasIssues.push({ method, chain: aliasResolution.chain })
      continue
    }

    const fallback = aliasResolution.resolvedMethod
    if (fallback && upstreamSet.has(fallback) && fallback !== method) {
      fallbackCovered.push({ method, fallback, chain: aliasResolution.chain })
      continue
    }

    missing.push(method)
  }
  return { missing, fallbackCovered, aliasIssues }
}

const janSurface = collectJanMethodSurface()
const runtimeSurface = await queryAppServerMethods(CODEX_BINARY)
const comparison = compareMethodSurfaces(janSurface.methods, runtimeSurface.upstreamMethods, janSurface.methodAliasMap)
const rawRpcCatalogMethods = collectMethodsFromRawRpcCatalog(RAW_RPC_CATALOG_SOURCE)
const rawRpcCatalogComparison = compareRawRpcCatalogMethods(rawRpcCatalogMethods, runtimeSurface.upstreamMethods, janSurface.methodAliasMap)
const overall =
  comparison.missing.length ||
  comparison.aliasIssues.length ||
  rawRpcCatalogComparison.missing.length ||
  rawRpcCatalogComparison.aliasIssues.length
    ? 'failed'
    : 'passed'
const report = {
  timestamp: new Date().toISOString(),
  binary: CODEX_BINARY,
  initialize: runtimeSurface.initialize,
  probe: runtimeSurface.probe,
  upstreamMethods: runtimeSurface.upstreamMethods,
  janMethods: janSurface.methods,
  aliasMap: janSurface.aliases,
  comparison,
  overall,
  rawRpcCatalogMethods,
  rawRpcCatalogComparison,
}

console.log(JSON.stringify(report, null, 2))
for (const { method, fallback, chain } of comparison.fallbackCovered) {
  const chainText = chain ? ` via ${chain.join(' -> ')}` : ''
  console.error(`[alias] ${method} now falls back to ${fallback}${chainText}`)
}
for (const { method, fallback, chain } of rawRpcCatalogComparison.fallbackCovered) {
  const chainText = chain ? ` via ${chain.join(' -> ')}` : ''
  console.error(`[raw-rpc-alias] ${method} now falls back to ${fallback}${chainText}`)
}
for (const aliasIssue of comparison.aliasIssues) {
  logAliasCycle(aliasIssue)
}
for (const aliasIssue of rawRpcCatalogComparison.aliasIssues) {
  logAliasCycle(aliasIssue)
}
if (comparison.aliasIssues.length || rawRpcCatalogComparison.aliasIssues.length) {
  process.exitCode = 1
}
if (overall !== 'passed') process.exitCode = 1
