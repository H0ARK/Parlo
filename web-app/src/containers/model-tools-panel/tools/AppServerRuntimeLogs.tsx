import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type ParsedCodexAppServerLogLine = {
  line: string
  stream: 'stdout' | 'stderr' | 'system' | string
  timestamp: number
  level: 'error' | 'warn' | 'info' | 'debug' | 'system'
  text: string
}

type StreamFilter = 'all' | 'stdout' | 'stderr' | 'system'
type LevelFilter = 'all' | ParsedCodexAppServerLogLine['level']

const LOG_LINE_RE =
  /^\[(.*?)\]\s+\[(.*?)\]\s+\[(.*?)\]\s(.*)$/

const parseLogLevel = (
  stream: ParsedCodexAppServerLogLine['stream'],
  text: string
): ParsedCodexAppServerLogLine['level'] => {
  const normalized = `${stream} ${text}`.toLowerCase()
  if (normalized.includes('error') || normalized.includes('fatal')) return 'error'
  if (normalized.includes('warn') || normalized.includes('warning')) return 'warn'
  if (normalized.includes('debug')) return 'debug'
  if (stream === 'stderr') return 'error'
  if (stream === 'system') return 'system'
  return 'info'
}

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const formatClipboardText = (lines: ParsedCodexAppServerLogLine[]) =>
  lines
    .map(
      (line) =>
        `${formatTimestamp(line.timestamp)} [${line.level}] [${line.stream}] ${line.text}`
    )
    .join('\n')

const getLevelClass = (level: ParsedCodexAppServerLogLine['level']) => {
  switch (level) {
    case 'error':
      return 'text-red-500'
    case 'warn':
      return 'text-yellow-500'
    case 'system':
      return 'text-violet-500'
    case 'debug':
      return 'text-muted-foreground'
    default:
      return 'text-green-500'
  }
}

type AppServerRuntimeLogsProps = {
  codexRuntimeLogsLength: number
  runtimeLogsText: string
  onClearCodexRuntimeLogs: () => void
}

export function AppServerRuntimeLogs({
  codexRuntimeLogsLength,
  runtimeLogsText,
  onClearCodexRuntimeLogs,
}: AppServerRuntimeLogsProps) {
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [searchText, setSearchText] = useState('')

  const parsedLines = useMemo(() => {
    if (!runtimeLogsText.trim()) return []

    return runtimeLogsText
      .split('\n')
      .map((rawLine) => {
        const trimmed = rawLine.trim()
        if (!trimmed) return null

        const match = trimmed.match(LOG_LINE_RE)
        if (!match) {
          return {
            line: trimmed,
            stream: 'system',
            timestamp: Date.now(),
            level: 'info',
            text: trimmed,
          }
        }

        const [, rawTimestamp, , stream, lineText] = match
        const lineTimestamp = new Date(rawTimestamp).getTime()
        const fallbackTimestamp = Number.isNaN(lineTimestamp) ? Date.now() : lineTimestamp
        const normalizedStream =
          stream === 'stdout' || stream === 'stderr' || stream === 'system'
            ? stream
            : 'system'
        return {
          line: trimmed,
          stream: normalizedStream,
          timestamp: fallbackTimestamp,
          text: lineText,
          level: parseLogLevel(normalizedStream, lineText),
        } satisfies ParsedCodexAppServerLogLine
      })
      .filter(Boolean) as ParsedCodexAppServerLogLine[]
  }, [runtimeLogsText])

  const filteredLines = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    return parsedLines.filter((entry) => {
      const matchesStream =
        streamFilter === 'all' ? true : entry.stream === streamFilter
      const matchesLevel =
        levelFilter === 'all' ? true : entry.level === levelFilter
      const matchesSearch = normalizedSearch
        ? `${entry.line}`.toLowerCase().includes(normalizedSearch)
        : true
      return matchesStream && matchesLevel && matchesSearch
    })
  }, [levelFilter, parsedLines, searchText, streamFilter])

  const counts = useMemo(
    () => ({
      all: parsedLines.length,
      stdout: parsedLines.filter((line) => line.stream === 'stdout').length,
      stderr: parsedLines.filter((line) => line.stream === 'stderr').length,
      system: parsedLines.filter((line) => line.stream === 'system').length,
      errors: parsedLines.filter((line) => line.level === 'error').length,
      warnings: parsedLines.filter((line) => line.level === 'warn').length,
      info: parsedLines.filter((line) => line.level === 'info').length,
      debug: parsedLines.filter((line) => line.level === 'debug').length,
      systemLevel: parsedLines.filter((line) => line.level === 'system').length,
    }),
    [parsedLines]
  )

  const handleCopyVisibleLogs = async () => {
    if (!filteredLines.length) return
    const text = formatClipboardText(filteredLines)
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Visible app-server logs copied')
    } catch {
      toast.error('Could not copy logs')
    }
  }

  return (
    <div className="mt-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between">
        <span>
          App-server runtime logs ({filteredLines.length}/{codexRuntimeLogsLength})
        </span>
        <button
          type="button"
          className="text-[9px] underline"
          onClick={onClearCodexRuntimeLogs}
        >
          Clear
        </button>
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-1 text-[9px]">
        <select
          className="h-5 rounded border border-border bg-background px-1"
          value={streamFilter}
          onChange={(event) =>
            setStreamFilter(event.target.value as StreamFilter)
          }
          aria-label="Filter by stream"
        >
          <option value="all">
            all ({counts.all})
          </option>
          <option value="stdout">
            stdout ({counts.stdout})
          </option>
          <option value="stderr">
            stderr ({counts.stderr})
          </option>
          <option value="system">
            system ({counts.system})
          </option>
        </select>
        <select
          className="h-5 rounded border border-border bg-background px-1"
          value={levelFilter}
          onChange={(event) =>
            setLevelFilter(event.target.value as LevelFilter)
          }
          aria-label="Filter by severity"
        >
          <option value="all">level: all</option>
          <option value="error">error ({counts.errors})</option>
          <option value="warn">warn ({counts.warnings})</option>
          <option value="info">info ({counts.info})</option>
          <option value="debug">debug ({counts.debug})</option>
          <option value="system">system ({counts.systemLevel})</option>
        </select>
        <input
          className="h-5 min-w-28 flex-1 rounded border border-border bg-background px-1"
          placeholder="Filter text"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={filteredLines.length === 0}
          onClick={() => void handleCopyVisibleLogs()}
        >
          Copy visible
        </button>
      </div>
      <div className="text-muted-foreground mb-1 text-[9px]">
        {counts.errors} error-like, {counts.warnings} warning-like entries
      </div>
      <div className="rounded border border-border/50 p-1 max-h-28 overflow-auto font-mono">
        {filteredLines.length === 0 ? (
          <span className="text-muted-foreground">
            {runtimeLogsText
              ? '— (no log rows match current filters)'
              : '— (logs appear when Codex app-server processes run)'}
          </span>
        ) : (
          filteredLines.map((logLine) => (
            <div
              key={`${logLine.timestamp}-${logLine.line}`}
              className="mb-0.5 flex gap-1"
            >
              <span className="text-muted-foreground">
                [{formatTimestamp(logLine.timestamp)}]
              </span>
              <span className={`w-11 text-right ${getLevelClass(logLine.level)}`}>
                {logLine.level.toUpperCase().padEnd(5)}
              </span>
              <span className={logLine.stream === 'stderr' ? 'text-red-400' : ''}>
                [{logLine.stream}]
              </span>
              <span className="truncate break-all">{logLine.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
