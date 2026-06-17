import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useCodexAppServerRuntime } from '@/stores/codex-app-server-runtime-store'
import { useCodexUserInput } from '@/stores/codex-user-input-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { useChatSessionState } from '@/stores/chat-session-state-store'
import { isPlatformTauri } from '@/lib/platform/utils'

type JsonRecord = Record<string, unknown>

type JanDebugBridgeState = {
  generatedAt: string
  source: 'jan-debug-bridge'
  app: JsonRecord
  route: JsonRecord
  model: JsonRecord
  thread: JsonRecord
  codexRuntime: JsonRecord
  clientDiagnostics: JsonRecord
  permissions: JsonRecord
  userInput: JsonRecord
  sessionUi: JsonRecord
}

const DEBUG_DIR_NAME = '.jan-debug'
const DEBUG_STATE_FILE_NAME = 'state.json'
const MAX_LOG_LINES = 80
const MAX_PROCESS_EVENTS = 80
const MAX_CLIENT_DIAGNOSTICS = 80
const MAX_DIAGNOSTIC_TEXT_LENGTH = 5000
const WRITE_INTERVAL_MS = 1000

const SECRET_KEY_PATTERN =
  /(api[_-]?key|token|secret|authorization|password|credential|huggingface|hf[_-]?)/i

const clientDiagnostics: JsonRecord[] = []
let diagnosticsInstalled = false
let diagnosticsCapturing = false

const fallbackMacDataFolder = () => {
  if (typeof navigator === 'undefined' || !navigator.userAgent.includes('Mac')) {
    return null
  }
  return `${globalThis.window?.process?.env?.HOME ?? ''}/Library/Application Support/Jan/data`
}

const resolveJanDataFolder = async (serviceHub: ReturnType<typeof useServiceHub>) => {
  try {
    const fromService = await serviceHub.app().getJanDataFolder()
    if (fromService) return fromService
  } catch (error) {
    console.debug('Jan debug bridge service data-folder lookup failed:', error)
  }

  try {
    const configuration = await invoke<{ data_folder?: string }>('get_app_configurations')
    if (configuration?.data_folder) return configuration.data_folder
  } catch (error) {
    console.debug('Jan debug bridge get_app_configurations fallback failed:', error)
  }

  return fallbackMacDataFolder()
}

const redact = (value: unknown, depth = 0, maxStringLength = 600): unknown => {
  if (depth > 5) return '[max-depth]'
  if (value === null || typeof value === 'undefined') return value
  if (typeof value === 'string') {
    return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}...` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .slice(0, 80)
      .map((item) => redact(item, depth + 1, maxStringLength))
  }
  if (typeof value !== 'object') return String(value)

  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(entry, depth + 1, maxStringLength),
    ])
  )
}

const redactDiagnostic = (entry: JsonRecord): JsonRecord => ({
  timestamp: entry.timestamp,
  level: entry.level,
  source: entry.source,
  message: redact(entry.message, 0, MAX_DIAGNOSTIC_TEXT_LENGTH),
  args: Array.isArray(entry.args)
    ? entry.args.map((arg) => diagnosticText(arg))
    : undefined,
  stack: redact(entry.stack, 0, MAX_DIAGNOSTIC_TEXT_LENGTH),
  componentStack: redact(entry.componentStack, 0, MAX_DIAGNOSTIC_TEXT_LENGTH),
})

const diagnosticPayload = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  if (typeof value !== 'object' || value === null) return value

  const payload: JsonRecord = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    payload[key] = (value as JsonRecord)[key]
  }
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    payload[key] = entry
  }

  return Object.keys(payload).length > 0 ? payload : value
}

const diagnosticText = (value: unknown) => {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(redact(diagnosticPayload(value)))
  } catch {
    return String(value)
  }
}

const pushClientDiagnostic = (
  level: 'warn' | 'error',
  source: string,
  args: unknown[]
) => {
  if (diagnosticsCapturing) return
  diagnosticsCapturing = true
  try {
    const payloads = args.map(diagnosticPayload)
    const firstError = args.find((arg): arg is Error => arg instanceof Error)
    const firstStack = payloads
      .find((arg) => typeof (arg as JsonRecord)?.stack === 'string') as
      | JsonRecord
      | undefined
    const componentStack = payloads.find(
      (arg) => typeof (arg as JsonRecord)?.componentStack === 'string'
    ) as JsonRecord | undefined

    clientDiagnostics.push({
      timestamp: new Date().toISOString(),
      level,
      source,
      message: args.map(diagnosticText).join(' '),
      args: redact(payloads),
      stack: firstError?.stack ?? firstStack?.stack,
      componentStack: componentStack?.componentStack,
    })
    if (clientDiagnostics.length > MAX_CLIENT_DIAGNOSTICS) {
      clientDiagnostics.splice(0, clientDiagnostics.length - MAX_CLIENT_DIAGNOSTICS)
    }
  } catch (error) {
    clientDiagnostics.push({
      timestamp: new Date().toISOString(),
      level: 'error',
      source: 'jan-debug-bridge.diagnostics',
      message: `Failed to capture client diagnostic: ${String(error)}`,
    })
  } finally {
    diagnosticsCapturing = false
  }
}

const installClientDiagnostics = () => {
  if (diagnosticsInstalled || typeof window === 'undefined') return () => {}
  diagnosticsInstalled = true

  const originalWarn = console.warn
  const originalError = console.error
  const onWindowError = (event: ErrorEvent) => {
    pushClientDiagnostic('error', 'window.error', [
      event.message,
      event.filename,
      event.lineno,
      event.colno,
      event.error,
    ])
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    pushClientDiagnostic('error', 'window.unhandledrejection', [event.reason])
  }

  console.warn = (...args: unknown[]) => {
    pushClientDiagnostic('warn', 'console.warn', args)
    originalWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    pushClientDiagnostic('error', 'console.error', args)
    originalError(...args)
  }
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return () => {
    console.warn = originalWarn
    console.error = originalError
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    diagnosticsInstalled = false
  }
}

const safeThreadSummary = (thread: Thread | undefined) => {
  if (!thread) return null
  const rawThread = thread as Thread & JsonRecord
  return redact({
    id: thread.id,
    title: thread.title,
    model: thread.model,
    updated: rawThread.updated,
    created: rawThread.created,
    isFavorite: rawThread.isFavorite,
    project: rawThread.project,
  })
}

const buildDebugState = (): JanDebugBridgeState => {
  const modelState = useModelProvider.getState()
  const threadState = useThreads.getState()
  const appState = useAppState.getState()
  const runtimeState = useCodexAppServerRuntime.getState()
  const permissionState = useRuntimePermission.getState()
  const userInputState = useCodexUserInput.getState()
  const sessionState = useChatSessionState.getState()
  const currentThread = threadState.currentThreadId
    ? threadState.threads[threadState.currentThreadId]
    : undefined

  return {
    generatedAt: new Date().toISOString(),
    source: 'jan-debug-bridge',
    app: {
      platform: isPlatformTauri() ? 'tauri' : 'web',
      serverStatus: appState.serverStatus,
      activeModels: appState.activeModels,
      loadingModel: appState.loadingModel,
      currentStreamThreadId: appState.currentStreamThreadId,
      busyThreadIds: Object.keys(appState.busyThreads),
      errorMessage: redact(appState.errorMessage),
      backendError: appState.backendError,
      oomError: appState.oomError,
    },
    route: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      href: window.location.href,
    },
    model: {
      selectedProvider: modelState.selectedProvider,
      selectedModel: redact(modelState.selectedModel),
      providerCount: modelState.providers.length,
      providers: modelState.providers.map((provider) =>
        redact({
          provider: provider.provider,
          active: provider.active,
          modelIds: provider.models?.map((model) => model.id).slice(0, 100),
          settings: provider.settings,
        })
      ),
    },
    thread: {
      currentThreadId: threadState.currentThreadId,
      currentThread: safeThreadSummary(currentThread),
      threadCount: Object.keys(threadState.threads).length,
      recentThreads: Object.values(threadState.threads)
        .slice(-20)
        .map((thread) => safeThreadSummary(thread)),
    },
    codexRuntime: {
      logCount: runtimeState.logs.length,
      recentLogs: runtimeState.logs.slice(-MAX_LOG_LINES).map((entry) => redact(entry)),
      processEventCount: runtimeState.processEvents.length,
      recentProcessEvents: runtimeState.processEvents
        .slice(-MAX_PROCESS_EVENTS)
        .map((entry) => redact(entry)),
    },
    clientDiagnostics: {
      warningCount: clientDiagnostics.filter((entry) => entry.level === 'warn').length,
      errorCount: clientDiagnostics.filter((entry) => entry.level === 'error').length,
      recent: clientDiagnostics.slice(-MAX_CLIENT_DIAGNOSTICS).map(redactDiagnostic),
    },
    permissions: {
      pending: redact(permissionState.pending),
      rememberedCount: Object.keys(permissionState.remembered).length,
      recentAudit: permissionState.audit.slice(0, 20).map((entry) => redact(entry)),
    },
    userInput: {
      pending: userInputState.pending
        ? {
            questionCount: userInputState.pending.questions.length,
            questions: userInputState.pending.questions.map((question) => redact(question)),
          }
        : null,
    },
    sessionUi: {
      currentThreadSession: threadState.currentThreadId
        ? redact(sessionState.getSession(threadState.currentThreadId))
        : null,
      knownSessionCount: Object.keys(sessionState.bySession).length,
    },
  }
}

const buildFallbackDebugState = (error: unknown): JanDebugBridgeState => ({
  generatedAt: new Date().toISOString(),
  source: 'jan-debug-bridge',
  app: {
    platform: isPlatformTauri() ? 'tauri' : 'web',
    debugBridgeError: String(error),
  },
  route: {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    href: window.location.href,
  },
  model: {
    debugBridgeError: 'full model snapshot unavailable',
  },
  thread: {
    debugBridgeError: 'full thread snapshot unavailable',
  },
  codexRuntime: {
    debugBridgeError: 'full runtime snapshot unavailable',
  },
  clientDiagnostics: {
    warningCount: clientDiagnostics.filter((entry) => entry.level === 'warn').length,
    errorCount: clientDiagnostics.filter((entry) => entry.level === 'error').length,
    recent: clientDiagnostics.slice(-MAX_CLIENT_DIAGNOSTICS).map(redactDiagnostic),
  },
  permissions: {
    debugBridgeError: 'full permission snapshot unavailable',
  },
  userInput: {
    debugBridgeError: 'full user-input snapshot unavailable',
  },
  sessionUi: {
    debugBridgeError: 'full session UI snapshot unavailable',
  },
})

export function JanDebugBridge() {
  const serviceHub = useServiceHub()

  useEffect(() => {
    if (!isPlatformTauri()) return
    let cancelled = false
    let debugFilePath: string | null = null
    const uninstallClientDiagnostics = installClientDiagnostics()

    const publish = async () => {
      try {
        if (!debugFilePath) {
          const dataFolder = await resolveJanDataFolder(serviceHub)
          if (!dataFolder) return
          const debugDir = await serviceHub.path().join(dataFolder, DEBUG_DIR_NAME)
          debugFilePath = await serviceHub
            .path()
            .join(debugDir, DEBUG_STATE_FILE_NAME)
          await invoke('mkdir', { args: [debugDir] })
        }

        let state: JanDebugBridgeState
        try {
          state = buildDebugState()
        } catch (error) {
          state = buildFallbackDebugState(error)
        }
        (window as Window & { __JAN_DEBUG_BRIDGE__?: JanDebugBridgeState }).__JAN_DEBUG_BRIDGE__ =
          state
        await invoke('write_file_sync', {
          args: [debugFilePath, JSON.stringify(state, null, 2)],
        })
      } catch (error) {
        console.debug('Jan debug bridge publish failed:', error)
      }
    }

    void publish()
    const interval = window.setInterval(() => {
      if (!cancelled) void publish()
    }, WRITE_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      uninstallClientDiagnostics()
    }
  }, [serviceHub])

  return null
}
