#!/usr/bin/env node
import { spawn } from 'node:child_process'
import {
  closeSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 1420
const HOST = '127.0.0.1'
const LOCK_PATH = join(tmpdir(), 'jan-vite-dev.lock')
const LOCK_WAIT_ATTEMPTS = 150
const STALE_LOCK_AGE_MS = 10_000

function isPortInUse(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function releaseLock() {
  try {
    unlinkSync(LOCK_PATH)
  } catch {
    // ignore
  }
}

function getLockPid() {
  try {
    const pid = Number(readFileSync(LOCK_PATH, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function isLockOlderThan(ms) {
  try {
    return Date.now() - statSync(LOCK_PATH).mtimeMs > ms
  } catch {
    return false
  }
}

function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

async function waitForExistingVite() {
  const lockPid = getLockPid()

  if (lockPid && !isProcessRunning(lockPid)) {
    console.warn(
      `[dev-web] Removing stale Vite dev-server lock from exited process ${lockPid}.`
    )
    releaseLock()
    return false
  }

  if (!lockPid && isLockOlderThan(STALE_LOCK_AGE_MS)) {
    console.warn('[dev-web] Removing stale legacy Vite dev-server lock.')
    releaseLock()
    return false
  }

  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    if (await isPortInUse(PORT, HOST)) {
      console.log(
        `[dev-web] Port ${PORT} is already in use — reusing existing Vite dev server.`
      )
      return true
    }
    await sleep(200)
  }

  console.warn('[dev-web] Timed out waiting for Vite dev server on port 1420.')
  return false
}

if (await isPortInUse(PORT, HOST)) {
  console.log(
    `[dev-web] Port ${PORT} is already in use — reusing existing Vite dev server.`
  )
  process.exit(0)
}

if (!acquireLock()) {
  const foundExistingVite = await waitForExistingVite()
  if (foundExistingVite) {
    process.exit(0)
  }

  releaseLock()
  if (!acquireLock()) {
    console.error('[dev-web] Failed to acquire Vite dev-server lock.')
    process.exit(1)
  }
}

const child = spawn('yarn', ['workspace', '@janhq/web-app', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    IS_TAURI: process.env.IS_TAURI ?? 'true',
    IS_DEV: process.env.IS_DEV ?? 'true',
  },
})

const cleanup = () => {
  releaseLock()
}

child.on('exit', (code, signal) => {
  cleanup()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

process.on('SIGINT', () => {
  cleanup()
  child.kill('SIGINT')
})

process.on('SIGTERM', () => {
  cleanup()
  child.kill('SIGTERM')
})
