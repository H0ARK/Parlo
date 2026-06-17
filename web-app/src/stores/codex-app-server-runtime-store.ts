import { create } from 'zustand'

export type CodexAppServerLogLine = {
  sessionId: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
  timestamp: number
}

export type CodexAppServerProcessEvent = {
  processHandle: string
  stream: string
  text: string
  exitCode?: number
  stdout?: string
  stderr?: string
  timestamp: number
}

type CodexAppServerRuntimeState = {
  logs: CodexAppServerLogLine[]
  processEvents: CodexAppServerProcessEvent[]
  appendLog: (line: CodexAppServerLogLine) => void
  appendProcessEvent: (event: CodexAppServerProcessEvent) => void
  clearLogs: () => void
  clearProcessEvents: (processHandle?: string) => void
  getLogText: (sessionId?: string, maxChars?: number) => string
}

const MAX_LOG_LINES = 500
const MAX_PROCESS_EVENTS = 1000

export const useCodexAppServerRuntime =
  create<CodexAppServerRuntimeState>()((set, get) => ({
    logs: [],
    processEvents: [],

    appendLog: (line) =>
      set((state) => ({
        logs: [...state.logs, line].slice(-MAX_LOG_LINES),
      })),

    appendProcessEvent: (event) =>
      set((state) => ({
        processEvents: [...state.processEvents, event].slice(
          -MAX_PROCESS_EVENTS
        ),
      })),

    clearLogs: () => set({ logs: [] }),

    clearProcessEvents: (processHandle) =>
      set((state) => ({
        processEvents: processHandle
          ? state.processEvents.filter(
              (event) => event.processHandle !== processHandle
            )
          : [],
      })),

    getLogText: (sessionId, maxChars = 16000) => {
      const lines = get().logs.filter(
        (line) => !sessionId || line.sessionId === sessionId
      )
      const text = lines
        .map((line) => {
          const timestamp = new Date(line.timestamp).toISOString()
          return `[${timestamp}] [${line.sessionId}] [${line.stream}] ${line.line}`
        })
        .join('\n')
        .trim()

      return text.length > maxChars ? text.slice(text.length - maxChars) : text
    },
  }))
