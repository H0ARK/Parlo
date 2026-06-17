import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  encodeUtf8Base64,
  parseCodexArgTokens,
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

type JsonObject = Record<string, unknown>

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeRuntimeSnapshot(value: unknown) {
  if (!value) {
    return {
      title: 'Runtime action results',
      rows: ['No runtime action result yet.'],
    }
  }

  if (Array.isArray(value)) {
    return {
      title: `Runtime action returned ${value.length} item${value.length === 1 ? '' : 's'}`,
      rows: value.slice(0, 4).map((item, index) => {
        if (isPlainObject(item)) {
          const label =
            typeof item.name === 'string'
              ? item.name
              : typeof item.path === 'string'
                ? item.path
                : `item ${index + 1}`
          return `${label} (${Object.keys(item).join(', ') || 'object'})`
        }
        return `${index + 1}: ${String(item)}`
      }),
    }
  }

  if (!isPlainObject(value)) {
    return {
      title: 'Runtime action result',
      rows: [String(value)],
    }
  }

  const rows: string[] = []
  const addValue = (label: string, entry: unknown) => {
    if (typeof entry === 'undefined' || entry === null || entry === '') return
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      rows.push(`${label}: ${entry}`)
      return
    }
    if (Array.isArray(entry)) {
      rows.push(`${label}: ${entry.length} item${entry.length === 1 ? '' : 's'}`)
      return
    }
    if (isPlainObject(entry)) {
      rows.push(`${label}: ${Object.keys(entry).length} keys`)
    }
  }

  addValue('status', value.status)
  addValue('exitCode', value.exitCode)
  addValue('handle', value.processHandle ?? value.processId ?? value.handle)
  addValue('path', value.path ?? value.uri ?? value.watchId)
  addValue('cwd', value.cwd)
  addValue('stdout', typeof value.stdout === 'string' ? `${value.stdout.length} chars` : value.stdout)
  addValue('stderr', typeof value.stderr === 'string' ? `${value.stderr.length} chars` : value.stderr)
  addValue('error', value.error)

  const keys = Object.keys(value)
  if (!rows.length) {
    rows.push(`keys: ${keys.join(', ') || 'none'}`)
  } else {
    rows.push(`top-level keys: ${keys.join(', ') || 'none'}`)
  }

  return {
    title: 'Runtime action result summary',
    rows,
  }
}

function parseStringArray(value: string): string[] | null {
  const parsed = parseCodexJson<unknown>(value, undefined)
  if (
    Array.isArray(parsed) &&
    parsed.every((item): item is string => typeof item === 'string')
  ) {
    return parsed.filter((item): item is string => typeof item === 'string')
  }
  if (typeof parsed === 'string') {
    const tokens = parseCodexArgTokens(parsed)
    return tokens
  }
  return null
}


function parseCommandArray(value: string): { command: string; args: string[] } {
  const parsed = parseCodexJson<unknown>(value, undefined)
  let commandParts: string[] = []

  if (
    Array.isArray(parsed) &&
    parsed.every((item): item is string => typeof item === 'string')
  ) {
    commandParts = parsed
  } else if (typeof parsed === 'string') {
    const tokens = parseCodexArgTokens(parsed)
    if (tokens === null) {
      return {
        command: '',
        args: [],
      }
    }
    commandParts = tokens
  }

  return {
    command: commandParts[0] ?? '',
    args: commandParts.slice(1),
  }
}

function parseCommandExecPayload(
  value: string,
  fallbackCwd: string,
  onInvalid?: (message: string) => void
) {
  const parsed = parseCodexJson<unknown>(value, null)
  if (parsed !== null && !isPlainObject(parsed)) {
    onInvalid?.('Command/exec params must be a JSON object.')
    return {
      command: '',
      args: [],
      cwd: fallbackCwd,
      extras: {},
    }
  }
  const parsedRecord = parsed ?? {}
  const objectCommand = parsedRecord.command
  let commandParts = {
    command: '',
    args: [] as string[],
  }
  if (typeof objectCommand === 'string') {
    commandParts = parseCommandArray(objectCommand)
  } else if (Array.isArray(objectCommand)) {
    if (!objectCommand.every((item): item is string => typeof item === 'string')) {
      onInvalid?.('Command/exec params command field must be an array of strings when provided as an array.')
      commandParts = {
        command: '',
        args: [],
      }
    } else {
      commandParts = {
        command: objectCommand[0] ?? '',
        args: objectCommand.slice(1),
      }
    }
  } else if (typeof objectCommand !== 'undefined') {
    onInvalid?.('Command/exec params command field must be a string or array of strings.')
  }

  const extras = {
    ...(parsedRecord as JsonObject),
  }
  const hasCwd = Object.prototype.hasOwnProperty.call(parsedRecord, 'cwd')
  if (typeof extras.command !== 'undefined') {
    delete extras.command
  }
  if (typeof extras.cwd !== 'undefined') {
    delete extras.cwd
  }
  if (hasCwd && typeof parsedRecord.cwd !== 'string') {
    onInvalid?.('Command/exec params cwd must be a string when supplied.')
  }
  return {
    command: commandParts.command,
    args: commandParts.args,
    cwd:
      typeof parsedRecord.cwd === 'string' && hasCwd
        ? parsedRecord.cwd
        : fallbackCwd,
    extras,
  }
}


function buildJsonString(value: string[] | string, fallback: string[] = []) {
  if (Array.isArray(value)) {
    return stringifyCodexJson(value, '[]')
  }
  const parsed = parseCodexJson<unknown>(value, undefined)
  if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) {
    return stringifyCodexJson(parsed, '[]')
  }
  return stringifyCodexJson(fallback.filter(Boolean).map((entry) => entry.trim()), '[]')
}

function parsePtySize(value: string) {
  const parsed = parseCodexJson<unknown>(value, undefined)
  const rows =
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as JsonObject).rows === 'number'
      ? (parsed as JsonObject).rows
      : 24
  const cols =
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as JsonObject).cols === 'number'
      ? (parsed as JsonObject).cols
      : 80

  return {
    rows: Number.isFinite(rows) ? rows : 24,
    cols: Number.isFinite(cols) ? cols : 80,
  }
}

function parseTerminalSize(rowsValue: string, colsValue: string, onInvalid?: (message: string) => void) {
  const rows = Number.parseInt(rowsValue, 10)
  const cols = Number.parseInt(colsValue, 10)
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
    onInvalid?.('Terminal rows and cols must be positive integers.')
    return null
  }
  return { rows, cols }
}

type CodexProcessTerminalSession = {
  handle: string
  kind: 'process' | 'command'
  label: string
  status: 'running' | 'exited' | 'unknown'
  lines: string[]
}

type CommandExecExtraField = {
  key: string
  value: string
}

type RuntimeFsProcessPanelState = {
  codexCommandExecParams: string
  codexProcessHandle: string
  codexProcessTerminalCols: string
  codexProcessTerminalExpanded: boolean
  codexProcessTerminalFilter: string
  codexProcessTerminalRows: string
  codexProcessTerminals: CodexProcessTerminalSession[]
  codexRuntimeCopyDestination: string
  codexRuntimeFileText: string
  codexRuntimePath: string
  codexRuntimePtySize: string
  codexRuntimeSnapshot: unknown
  codexRuntimeSpawnCommand: string
  codexRuntimeStdin: string
  codexRuntimeWatchId: string
  currentThreadIdForCaps: string | null | undefined
  cwd: string
  filteredCodexProcessTerminalLines: string[]
  runtimeBusy: boolean
  selectableCodexProcessHandles: string[]
  selectedCodexProcessTerminal: CodexProcessTerminalSession | null
}

type RuntimeFsProcessPanelActions = {
  onAppendCodexTerminalLines: (
    handle: string,
    lines: string[],
    patch?: Partial<Omit<CodexProcessTerminalSession, 'handle' | 'lines'>>
  ) => void
  onClearCodexProcessEvents: () => void
  onClearCodexProcessTerminals: () => void
  onReadCodexRuntimeFile: () => void
  onRunCodexRuntimeAction: (
    method: string,
    params: Record<string, unknown>,
    success?: string
  ) => Promise<unknown>
  onSetCapError: (error: string | null) => void
  onSetCodexCommandExecParams: (value: string) => void
  onSetCodexProcessHandle: (value: string) => void
  onSetCodexProcessTerminalCols: (value: string) => void
  onSetCodexProcessTerminalExpanded: (
    value: boolean | ((value: boolean) => boolean)
  ) => void
  onSetCodexProcessTerminalFilter: (value: string) => void
  onSetCodexProcessTerminalRows: (value: string) => void
  onSetCodexRuntimeCopyDestination: (value: string) => void
  onSetCodexRuntimeFileText: (value: string) => void
  onSetCodexRuntimePath: (value: string) => void
  onSetCodexRuntimePtySize: (value: string) => void
  onSetCodexRuntimeSnapshot: (value: unknown) => void
  onSetCodexRuntimeSpawnCommand: (value: string) => void
  onSetCodexRuntimeStdin: (value: string) => void
  onSetCodexRuntimeWatchId: (value: string) => void
  onSpawnCodexRuntimeProcess: (command?: string) => Promise<void>
  onWriteCodexRuntimeFile: () => void
}

type RuntimeFsProcessPanelProps = {
  state: RuntimeFsProcessPanelState
  actions: RuntimeFsProcessPanelActions
}

export function RuntimeFsProcessPanel({ state, actions }: RuntimeFsProcessPanelProps) {
  const {
    codexCommandExecParams,
    codexProcessHandle,
    codexProcessTerminalCols,
    codexProcessTerminalExpanded,
    codexProcessTerminalFilter,
    codexProcessTerminalRows,
    codexProcessTerminals,
    codexRuntimeCopyDestination,
    codexRuntimeFileText,
    codexRuntimePath,
    codexRuntimePtySize,
    codexRuntimeSnapshot,
    codexRuntimeSpawnCommand,
    codexRuntimeStdin,
    codexRuntimeWatchId,
    currentThreadIdForCaps,
    cwd,
    filteredCodexProcessTerminalLines,
    runtimeBusy,
    selectableCodexProcessHandles,
    selectedCodexProcessTerminal,
  } = state
  const {
    onAppendCodexTerminalLines,
    onClearCodexProcessEvents,
    onClearCodexProcessTerminals,
    onReadCodexRuntimeFile,
    onRunCodexRuntimeAction,
    onSetCapError,
    onSetCodexCommandExecParams,
    onSetCodexProcessHandle,
    onSetCodexProcessTerminalCols,
    onSetCodexProcessTerminalExpanded,
    onSetCodexProcessTerminalFilter,
    onSetCodexProcessTerminalRows,
    onSetCodexRuntimeCopyDestination,
    onSetCodexRuntimeFileText,
    onSetCodexRuntimePath,
    onSetCodexRuntimePtySize,
    onSetCodexRuntimeSnapshot,
    onSetCodexRuntimeSpawnCommand,
    onSetCodexRuntimeStdin,
    onSetCodexRuntimeWatchId,
    onSpawnCodexRuntimeProcess,
    onWriteCodexRuntimeFile,
  } = actions
  const [spawnCommand, setSpawnCommand] = useState('')
  const [spawnArgs, setSpawnArgs] = useState('[]')
  const [commandExecCommand, setCommandExecCommand] = useState('')
  const [commandExecArgs, setCommandExecArgs] = useState('[]')
  const [commandExecCwd, setCommandExecCwd] = useState(cwd)
  const [commandExecExtraFields, setCommandExecExtraFields] = useState<
    CommandExecExtraField[]
  >([{ key: '', value: '' }])
  const [runtimePtyRows, setRuntimePtyRows] = useState('24')
  const [runtimePtyCols, setRuntimePtyCols] = useState('80')
  const [showSpawnJson, setShowSpawnJson] = useState(false)
  const [showCommandExecJson, setShowCommandExecJson] = useState(false)
  const [showPtyJson, setShowPtyJson] = useState(false)
  const runtimeSnapshotSummary = summarizeRuntimeSnapshot(codexRuntimeSnapshot)

  useEffect(() => {
    const parsed = parseCommandArray(codexRuntimeSpawnCommand)
    setSpawnCommand(parsed.command)
    setSpawnArgs(buildJsonString(parsed.args, ['']))
  }, [codexRuntimeSpawnCommand])

  useEffect(() => {
    const payload = parseCommandExecPayload(codexCommandExecParams, cwd)
    setCommandExecCommand(payload.command)
    setCommandExecArgs(buildJsonString(payload.args, ['']))
    setCommandExecCwd(payload.cwd)
    const extras = payload.extras
    const nextExtras = (() => {
      if (!extras || typeof extras !== 'object' || Array.isArray(extras)) {
        return [{ key: '', value: '' }]
      }
      const nextEntries = Object.entries(extras).map(([key, value]) => ({
        key,
        value:
          typeof value === 'string'
            ? value
            : stringifyCodexJson(value, String(value ?? '')),
      }))
      return nextEntries.length ? nextEntries : [{ key: '', value: '' }]
    })()
    setCommandExecExtraFields(nextExtras)
  }, [codexCommandExecParams, cwd])

  useEffect(() => {
    const size = parsePtySize(codexRuntimePtySize)
    setRuntimePtyRows(String(size.rows))
    setRuntimePtyCols(String(size.cols))
  }, [codexRuntimePtySize])

  const composeSpawnPayload = () => {
    const command = spawnCommand.trim()
    if (!command) {
      onSetCapError('Process spawn command is required.')
      return null
    }
    const args = parseStringArray(spawnArgs)
    if (args === null) {
      onSetCapError('Spawn args must be a JSON array of strings or command tokens.')
      return null
    }
    return {
      command,
      args,
      payload: stringifyCodexJson([command, ...args], '[]'),
    }
  }

  const composeCommandExecPayload = () => {
    const command = commandExecCommand.trim()
    if (!command) {
      onSetCapError('Command/exec command is required.')
      return null
    }
    const args = parseStringArray(commandExecArgs)
    if (args === null) {
      onSetCapError('Command/exec args must be a JSON array of strings or command tokens.')
      return null
    }
    const extras = commandExecExtraFields.reduce<Record<string, unknown>>(
      (accumulator, field) => {
        const fieldKey = field.key.trim()
        if (!fieldKey) return accumulator
        if (Object.prototype.hasOwnProperty.call(accumulator, fieldKey)) {
          onSetCapError(`Command/exec extra key duplicated: ${fieldKey}`)
        }
        accumulator[fieldKey] = parseCommandExecValue(field.value)
        return accumulator
      },
      {}
    )
    const payload = {
      command: [command, ...args],
      cwd: commandExecCwd,
      ...extras,
    }
    return { payload, serialized: stringifyCodexJson(payload, '{}') }
  }

  const parseCommandExecValue = (value: string): unknown => {
    const trimmed = value.trim()
    if (!trimmed) return value
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (!Number.isNaN(Number(trimmed))) return Number(trimmed)
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return value
      }
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return value
  }

  const syncCommandExecParamsFromFields = (
    fields: CommandExecExtraField[] = commandExecExtraFields
  ) => {
    const command = commandExecCommand.trim()
    if (!command) return
    const args = parseStringArray(commandExecArgs)
    if (args === null) return
    const normalizedExtras = fields.reduce<Record<string, unknown>>((acc, field) => {
      const fieldKey = field.key.trim()
      if (!fieldKey) return acc
      if (Object.prototype.hasOwnProperty.call(acc, fieldKey)) return acc
      acc[fieldKey] = parseCommandExecValue(field.value)
      return acc
    }, {})
    onSetCodexCommandExecParams(
      stringifyCodexJson(
        {
          command: [command, ...args],
          cwd: commandExecCwd,
          ...normalizedExtras,
        },
        '{}'
      )
    )
  }

  const setCommandExecExtraField = (
    index: number,
    field: CommandExecExtraField
  ) => {
    const nextFields = commandExecExtraFields.map((nextField, nextIndex) =>
      nextIndex === index ? field : nextField
    )
    setCommandExecExtraFields(nextFields)
    if (!showCommandExecJson) {
      syncCommandExecParamsFromFields(nextFields)
    }
  }

  const addCommandExecExtraField = () => {
    setCommandExecExtraFields([...commandExecExtraFields, { key: '', value: '' }])
  }

  const removeCommandExecExtraField = (index: number) => {
    const nextFields = commandExecExtraFields.filter((_, nextIndex) => {
      return nextIndex !== index
    })
    const fallbackFields = nextFields.length ? nextFields : [{ key: '', value: '' }]
    setCommandExecExtraFields(fallbackFields)
    if (!showCommandExecJson) {
      syncCommandExecParamsFromFields(fallbackFields)
    }
  }

  const composePtySize = () => {
    const size = parseTerminalSize(runtimePtyRows, runtimePtyCols, onSetCapError)
    if (!size) return null
    onSetCodexRuntimePtySize(stringifyCodexJson(size, '{}'))
    return size
  }

  const runSelectedTerminalStdin = () => {
    if (!selectedCodexProcessTerminal) return
    const handle = selectedCodexProcessTerminal.handle
    if (selectedCodexProcessTerminal.kind === 'command') {
      void onRunCodexRuntimeAction(
        'command/stdin',
        {
          processId: handle,
          deltaBase64: encodeUtf8Base64(codexRuntimeStdin),
        },
        'Codex command stdin sent'
      )
      return
    }
    void onRunCodexRuntimeAction(
      'process/writeStdin',
      {
        processHandle: handle,
        deltaBase64: encodeUtf8Base64(codexRuntimeStdin),
      },
      'Codex stdin sent'
    )
  }

  const runSelectedTerminalResize = () => {
    if (!selectedCodexProcessTerminal) return
    const size = parseTerminalSize(
      codexProcessTerminalRows,
      codexProcessTerminalCols,
      onSetCapError
    )
    if (!size) return
    onSetCodexRuntimePtySize(stringifyCodexJson(size, '{}'))
    const handle = selectedCodexProcessTerminal.handle
    if (selectedCodexProcessTerminal.kind === 'command') {
      void onRunCodexRuntimeAction(
        'command/resize',
        { processId: handle, size },
        'Codex command PTY resized'
      )
      return
    }
    void onRunCodexRuntimeAction(
      'process/resizePty',
      { processHandle: handle, size },
      'Codex PTY resized'
    )
  }

  const runSelectedTerminalStop = () => {
    if (!selectedCodexProcessTerminal) return
    const handle = selectedCodexProcessTerminal.handle
    if (selectedCodexProcessTerminal.kind === 'command') {
      void onRunCodexRuntimeAction(
        'command/terminate',
        { processId: handle },
        'Codex command terminated'
      )
      return
    }
    void onRunCodexRuntimeAction(
      'process/kill',
      { processHandle: handle },
      'Codex process killed'
    )
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Runtime FS / Process</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || runtimeBusy}
          onClick={() =>
            onSetCodexRuntimeSnapshot((previous: unknown) => ({
              ...((previous as Record<string, unknown> | null) ?? {}),
              cwd,
            }))
          }
        >
          Set cwd
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Calls Codex app-server filesystem and process RPCs directly through the
        active agent session. This is the Codex runtime view, separate from
        Jan&apos;s local file browser.
      </div>
      <div className="mb-1 flex gap-1">
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Path for fs/readFile, fs/writeFile, fs/readDirectory"
          value={codexRuntimePath}
          onChange={(event) => onSetCodexRuntimePath(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() => void onReadCodexRuntimeFile()}
        >
          Read
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() => void onWriteCodexRuntimeFile()}
        >
          Write
        </button>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-4">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Copy destination path"
          value={codexRuntimeCopyDestination}
          onChange={(event) =>
            onSetCodexRuntimeCopyDestination(event.target.value)
          }
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Watch id"
          value={codexRuntimeWatchId}
          onChange={(event) => onSetCodexRuntimeWatchId(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Spawn command"
          value={spawnCommand}
          onChange={(event) => setSpawnCommand(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder='Spawn args (JSON array or command tokens)'
          value={spawnArgs}
          onChange={(event) => setSpawnArgs(event.target.value)}
        />
      </div>
      <div className="mb-1 flex gap-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          onClick={() => setShowSpawnJson((previous: boolean) => !previous)}
        >
          {showSpawnJson ? 'Hide' : 'Advanced'} spawn JSON
        </button>
      </div>
      {showSpawnJson ? (
        <textarea
          className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          value={codexRuntimeSpawnCommand}
          onChange={(event) => onSetCodexRuntimeSpawnCommand(event.target.value)}
        />
      ) : null}
      <textarea
        className="mb-1 min-h-16 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
        placeholder="File text for fs/writeFile, populated by fs/readFile"
        value={codexRuntimeFileText}
        onChange={(event) => onSetCodexRuntimeFileText(event.target.value)}
      />
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-3">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="command/exec command"
          value={commandExecCommand}
          onChange={(event) => setCommandExecCommand(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder='command/exec args (JSON array or command tokens)'
          value={commandExecArgs}
          onChange={(event) => setCommandExecArgs(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="command/exec cwd"
          value={commandExecCwd}
          onChange={(event) => setCommandExecCwd(event.target.value)}
        />
      </div>
      <div className="mb-1 flex gap-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          onClick={() =>
            setShowCommandExecJson((previous: boolean) => !previous)
          }
        >
          {showCommandExecJson ? 'Hide' : 'Advanced'} command/exec JSON
        </button>
      </div>
      {showCommandExecJson ? (
        <textarea
          className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="command/exec params JSON"
          value={codexCommandExecParams}
          onChange={(event) => onSetCodexCommandExecParams(event.target.value)}
        />
      ) : null}
      {!showCommandExecJson ? (
        <div className="mb-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-muted-foreground">
              Command/exec extra params
            </span>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={runtimeBusy}
              onClick={addCommandExecExtraField}
            >
              + add extra
            </button>
          </div>
          {commandExecExtraFields.map((field, index) => (
            <div
              key={`${field.key || 'extra'}-${index}`}
              className="grid grid-cols-[1.2fr_1.8fr_auto] gap-1"
            >
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="extra key"
                value={field.key}
                onChange={(event) =>
                  setCommandExecExtraField(index, {
                    ...field,
                    key: event.target.value,
                  })
                }
              />
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="extra value"
                value={field.value}
                onChange={(event) =>
                  setCommandExecExtraField(index, {
                    ...field,
                    value: event.target.value,
                  })
                }
              />
              <button
                type="button"
                className="text-[9px] underline disabled:opacity-50"
                disabled={runtimeBusy}
                onClick={() => removeCommandExecExtraField(index)}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/readDirectory',
              { path: codexRuntimePath.trim() },
              'Codex directory read'
            )
          }
        >
          Read directory
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/getMetadata',
              { path: codexRuntimePath.trim() },
              'Codex metadata read'
            )
          }
        >
          Metadata
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/createDirectory',
              { path: codexRuntimePath.trim(), recursive: true },
              'Codex directory created'
            )
          }
        >
          Mkdir
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimePath.trim() || runtimeBusy}
          onClick={() => {
            const confirmed = window.confirm(
              `Remove ${codexRuntimePath.trim()} through Codex app-server?`
            )
            if (!confirmed) return
            void onRunCodexRuntimeAction(
              'fs/remove',
              {
                path: codexRuntimePath.trim(),
                recursive: true,
                force: true,
              },
              'Codex filesystem path removed'
            )
          }}
        >
          Remove
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !codexRuntimePath.trim() ||
            !codexRuntimeCopyDestination.trim() ||
            runtimeBusy
          }
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/copy',
              {
                sourcePath: codexRuntimePath.trim(),
                destinationPath: codexRuntimeCopyDestination.trim(),
              },
              'Codex filesystem path copied'
            )
          }
        >
          Copy
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !codexRuntimePath.trim() ||
            !codexRuntimeWatchId.trim() ||
            runtimeBusy
          }
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/watch',
              {
                watchId: codexRuntimeWatchId.trim(),
                path: codexRuntimePath.trim(),
              },
              'Codex filesystem watch started'
            )
          }
        >
          Watch
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexRuntimeWatchId.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'fs/unwatch',
              { watchId: codexRuntimeWatchId.trim() },
              'Codex filesystem watch stopped'
            )
          }
        >
          Unwatch
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={runtimeBusy || !spawnCommand.trim()}
          onClick={() => {
            const payload = composeSpawnPayload()
            if (!payload) return
            onSetCodexRuntimeSpawnCommand(payload.payload)
            void onSpawnCodexRuntimeProcess(payload.payload)
          }}
        >
          Spawn process
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={runtimeBusy || !commandExecCommand.trim()}
          onClick={() => {
            const payload = composeCommandExecPayload()
            if (!payload) return
            onSetCodexCommandExecParams(payload.serialized)
            void onRunCodexRuntimeAction(
              'command/exec',
              payload.payload,
              'Codex command exec started'
            )
          }}
        >
          Command exec
        </button>
      </div>
      <div className="mb-1 flex gap-1">
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Process handle"
          value={codexProcessHandle}
          onChange={(event) => onSetCodexProcessHandle(event.target.value)}
        />
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="stdin"
          value={codexRuntimeStdin}
          onChange={(event) => onSetCodexRuntimeStdin(event.target.value)}
        />
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="PTY rows"
          value={runtimePtyRows}
          onChange={(event) => setRuntimePtyRows(event.target.value)}
        />
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="PTY cols"
          value={runtimePtyCols}
          onChange={(event) => setRuntimePtyCols(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          onClick={() => setShowPtyJson((previous: boolean) => !previous)}
        >
          {showPtyJson ? 'Hide' : 'Advanced'} PTY JSON
        </button>
      </div>
      {showPtyJson ? (
        <textarea
          className="mb-1 min-h-10 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="PTY size JSON"
          value={codexRuntimePtySize}
          onChange={(event) => onSetCodexRuntimePtySize(event.target.value)}
        />
      ) : null}
      <div className="mb-1 flex gap-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'process/writeStdin',
              {
                processHandle: codexProcessHandle.trim(),
                deltaBase64: encodeUtf8Base64(codexRuntimeStdin),
              },
              'Codex stdin sent'
            )
          }
        >
          Stdin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'command/stdin',
              {
                processId: codexProcessHandle.trim(),
                deltaBase64: encodeUtf8Base64(codexRuntimeStdin),
              },
              'Codex command stdin sent'
            )
          }
        >
          Cmd stdin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() => {
            const size = composePtySize()
            if (!size) return
            void onRunCodexRuntimeAction(
              'process/resizePty',
              {
                processHandle: codexProcessHandle.trim(),
                size,
              },
              'Codex PTY resized'
            )
          }}
        >
          Resize
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() => {
            const size = composePtySize()
            if (!size) return
            void onRunCodexRuntimeAction(
              'command/resize',
              {
                processId: codexProcessHandle.trim(),
                size,
              },
              'Codex command PTY resized'
            )
          }}
        >
          Cmd resize
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'process/kill',
              { processHandle: codexProcessHandle.trim() },
              'Codex process killed'
            )
          }
        >
          Kill
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexProcessHandle.trim() || runtimeBusy}
          onClick={() =>
            void onRunCodexRuntimeAction(
              'command/terminate',
              { processId: codexProcessHandle.trim() },
              'Codex command terminated'
            )
          }
        >
          Cmd terminate
        </button>
      </div>
      <div
        className={cn(
          'mb-1 rounded border border-border/60 bg-[#050505] text-[10px] text-zinc-100',
          codexProcessTerminalExpanded &&
            'fixed inset-4 z-50 flex flex-col shadow-2xl'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1 font-mono">
          <span>Codex process terminal</span>
          <div className="flex gap-2">
            <Input
              className="h-5 w-32 border-white/20 bg-black/40 px-1.5 text-[9px] text-zinc-100"
              placeholder="Search output"
              value={codexProcessTerminalFilter}
              onChange={(event) =>
                onSetCodexProcessTerminalFilter(event.target.value)
              }
            />
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexProcessTerminal}
              onClick={async () => {
                if (!selectedCodexProcessTerminal) return
                await navigator.clipboard.writeText(
                  selectedCodexProcessTerminal.lines.join('\n')
                )
                toast.success('Codex terminal output copied')
              }}
            >
              Copy output
            </button>
            <Input
              className="h-5 w-12 border-white/20 bg-black/40 px-1.5 text-[9px] text-zinc-100"
              placeholder="rows"
              value={codexProcessTerminalRows}
              onChange={(event) =>
                onSetCodexProcessTerminalRows(event.target.value)
              }
            />
            <Input
              className="h-5 w-12 border-white/20 bg-black/40 px-1.5 text-[9px] text-zinc-100"
              placeholder="cols"
              value={codexProcessTerminalCols}
              onChange={(event) =>
                onSetCodexProcessTerminalCols(event.target.value)
              }
            />
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexProcessTerminal || runtimeBusy}
              onClick={runSelectedTerminalResize}
            >
              Apply size
            </button>
            <button
              type="button"
              className="text-[9px] underline"
              onClick={() =>
                onSetCodexProcessTerminalExpanded(
                  (expanded: boolean) => !expanded
                )
              }
            >
              {codexProcessTerminalExpanded ? 'Collapse' : 'Expand'}
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!codexProcessHandle.trim()}
              onClick={() =>
                onAppendCodexTerminalLines(
                  codexProcessHandle.trim(),
                  [`attached ${codexProcessHandle.trim()}`],
                  { label: codexProcessHandle.trim() }
                )
              }
            >
              Attach handle
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!codexProcessTerminals.length}
              onClick={() => {
                onClearCodexProcessTerminals()
                onClearCodexProcessEvents()
              }}
            >
              Clear terminals
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-2 py-1 text-[9px] text-zinc-400">
          <div className="min-w-0">
            {selectedCodexProcessTerminal ? (
              <>
                Selected {selectedCodexProcessTerminal.kind} handle:{' '}
                <span className="font-mono text-zinc-100">
                  {selectedCodexProcessTerminal.handle}
                </span>{' '}
                · {selectedCodexProcessTerminal.status} ·{' '}
                {selectedCodexProcessTerminal.lines.length} lines
              </>
            ) : (
              'Select a terminal session for kind-aware stdin, resize, and stop actions.'
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexProcessTerminal || runtimeBusy}
              onClick={runSelectedTerminalStdin}
            >
              Send stdin to selected
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexProcessTerminal || runtimeBusy}
              onClick={runSelectedTerminalResize}
            >
              Resize selected
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexProcessTerminal || runtimeBusy}
              onClick={runSelectedTerminalStop}
            >
              Stop selected
            </button>
          </div>
        </div>
        {codexProcessTerminals.length ? (
          <div
            className={cn(
              'grid grid-cols-1 md:grid-cols-[11rem_1fr]',
              codexProcessTerminalExpanded && 'min-h-0 flex-1'
            )}
          >
            <div
              className={cn(
                'max-h-44 overflow-auto border-b border-white/10 p-1 md:border-b-0 md:border-r',
                codexProcessTerminalExpanded && 'max-h-none'
              )}
            >
              {codexProcessTerminals.map((session) => (
                <button
                  key={session.handle}
                  type="button"
                  className={cn(
                    'mb-1 flex w-full min-w-0 flex-col rounded border border-white/10 px-1.5 py-1 text-left hover:bg-white/10',
                    codexProcessHandle.trim() === session.handle && 'bg-white/10'
                  )}
                  title={session.handle}
                  onClick={() => onSetCodexProcessHandle(session.handle)}
                >
                  <span className="truncate font-mono text-[9px]">
                    {session.kind}:{session.label}
                  </span>
                  <span className="text-[9px] text-zinc-400">
                    {session.status} · {session.lines.length} lines
                  </span>
                </button>
              ))}
            </div>
            <div
              className={cn(
                'max-h-52 min-h-28 overflow-auto p-2 font-mono leading-relaxed',
                codexProcessTerminalExpanded && 'max-h-none min-h-0'
              )}
            >
              {selectedCodexProcessTerminal ? (
                filteredCodexProcessTerminalLines.length ? (
                  filteredCodexProcessTerminalLines.map((line, index) => (
                    <div
                      key={`${codexProcessHandle}-${index}`}
                      className="whitespace-pre-wrap break-words"
                    >
                      {line || ' '}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500">
                    No terminal lines match the current search.
                  </div>
                )
              ) : (
                <div className="text-zinc-500">
                  Select a process session to view output.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-2 py-3 text-zinc-500">
            Spawn a process, run command/exec, or attach a known process handle
            to start a terminal session.
          </div>
        )}
      </div>
      <div className="rounded border bg-background/40 p-1 text-[10px]">
        <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
          <span>{runtimeSnapshotSummary.title}</span>
          {codexRuntimeSnapshot ? (
            <span className="text-muted-foreground">
              diagnostics available
            </span>
          ) : null}
        </div>
        <div className="space-y-0.5 text-[9px] text-muted-foreground">
          {runtimeSnapshotSummary.rows.slice(0, 6).map((row) => (
            <div key={row} className="truncate" title={row}>
              {row}
            </div>
          ))}
        </div>
        {codexRuntimeSnapshot ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[9px] text-muted-foreground">
              Raw runtime result JSON
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border bg-background/60 p-1 font-mono text-[9px]">
              {stringifyCodexJson(codexRuntimeSnapshot, '{}')}
            </pre>
          </details>
        ) : null}
      </div>
      {selectableCodexProcessHandles.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexProcessHandles.map((processHandle) => (
            <button
              key={processHandle}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexProcessHandle.trim() === processHandle && 'bg-accent'
              )}
              title={processHandle}
              onClick={() => onSetCodexProcessHandle(processHandle)}
            >
              proc:{processHandle}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
