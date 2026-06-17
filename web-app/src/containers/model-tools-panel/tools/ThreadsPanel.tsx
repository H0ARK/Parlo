import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CodexReviewTarget } from '@/lib/codex-app-server/api'

import {
  stringifyCodexJson,
  type CodexThreadDescriptor,
} from '../shared/codex-helpers'

type JsonObject = Record<string, unknown>
type ReviewDeliveryMode = 'detached' | 'inline'
type ThreadActionParamField = {
  key: string
  value: string
}
type ThreadInjectItemField = {
  value: string
}

function buildMetadataJson(previous: JsonObject, source: string, workspace: string): string {
  const next: JsonObject = {
    ...previous,
  }

  if (source.trim()) {
    next.source = source.trim()
  } else {
    delete next.source
  }

  if (workspace.trim()) {
    next.workspace = workspace.trim()
  } else {
    delete next.workspace
  }

  return stringifyCodexJson(next, '{}')
}

function buildSettingsJson(previous: JsonObject, approvalPolicy: string, sandbox: string): string {
  const next: JsonObject = {
    ...previous,
  }

  if (approvalPolicy.trim()) {
    next.approvalPolicy = approvalPolicy.trim()
  } else {
    delete next.approvalPolicy
  }

  if (sandbox.trim()) {
    next.sandbox = sandbox.trim()
  } else {
    delete next.sandbox
  }

  return stringifyCodexJson(next, '{}')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseThreadActionParams(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!isPlainObject(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function parseThreadActionParamValue(value: string): unknown {
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

function parseThreadInjectItems(value: string): unknown[] | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function parseThreadInjectItemValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
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

function parseThreadMetadataJson(value: string): JsonObject | null {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (!isPlainObject(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function parseThreadSettingsJson(value: string): JsonObject | null {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (!isPlainObject(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

type CodexThreadSummary = {
  id: string
  name?: string
  source?: string
  status?: string
  updatedAt?: string
  turns?: number | null
  turnItems?: number | null
  goal?: string
}

type ThreadsPanelState = {
  codexInjectItemsJson: string
  codexLoadedThreads: unknown
  codexRealtimeAudioBase64: string
  codexRealtimeText: string
  codexStoredThreads: unknown
  codexTargetItemId: string
  codexTargetTurnId: string
  codexThreadDescriptors: CodexThreadDescriptor[]
  codexThreadFilter: string
  codexThreadGoal: unknown
  codexThreadGoalObjective: string
  codexThreadId: string
  codexThreadMetadataJson: string
  codexThreadName: string
  codexThreadSettingsJson: string
  codexThreadSnapshot: unknown
  codexConversationSummary: unknown
  codexGitDiffToRemote: unknown
  codexAuthStatus: unknown
  codexThreadSort: 'updated' | 'name' | 'source'
  codexThreadSourceFilter: 'all' | 'loaded' | 'stored'
  codexThreadTurnItems: unknown
  codexThreadTurns: unknown
  codexThreadActionParamsJson: string
  codexThreadReviewBranch: string
  codexThreadReviewDelivery: ReviewDeliveryMode
  codexThreadReviewType: CodexReviewTarget['type']
  codexTurnItemsLimit: string
  currentThreadIdForCaps: string | null | undefined
  cwd?: string
  filteredCodexThreadDescriptors: CodexThreadDescriptor[]
  selectedCodexThreadSummary: CodexThreadSummary | null
  selectableCodexItemIds: string[]
  selectableCodexThreadIds: string[]
  selectableCodexTurnIds: string[]
  targetCodexThreadId: string
  threadBusy: boolean
}

type ThreadsPanelActions = {
  onArchive: () => void
  onClearGoal: () => void
  onCompact: () => void
  onCleanTerminals: () => void
  onFork: () => void
  onGetGoal: () => void
  onInjectItems: () => void
  onInterrupt: () => void
  onMemoryOff: () => void
  onMemoryOn: () => void
  onMetadata: () => void
  onName: () => void
  onRead: (janThreadId?: string, params?: Record<string, unknown>) => Promise<unknown> | void
  onReadTurnItems: (janThreadId?: string, params?: Record<string, unknown>) => Promise<unknown> | void
  onRealtimeAudio: () => void
  onRealtimeStart: () => void
  onRealtimeStop: () => void
  onRealtimeText: () => void
  onRefresh: () => void
  onReload: () => void
  onResetMemory: () => void
  onReview: (params?: Record<string, unknown>) => void
  onRollback: () => void
  onSearchThreads: () => void
  onStartThread: () => void
  onResumeThread: () => void
  onStartTurn: () => void
  onListRealtimeVoices: () => void
  onApproveGuardianDeniedAction: () => void
  onIncrementElicitation: () => void
  onDecrementElicitation: () => void
  onReadConversationSummary: () => void
  onReadGitDiffToRemote: () => void
  onReadAuthStatus: () => void
  onSetCodexInjectItemsJson: (value: string) => void
  onSetCodexRealtimeAudioBase64: (value: string) => void
  onSetCodexRealtimeText: (value: string) => void
  onSetCodexTargetItemId: (value: string) => void
  onSetCodexTargetTurnId: (value: string) => void
  onSetCodexThreadFilter: (value: string) => void
  onSetCodexThreadGoalObjective: (value: string) => void
  onSetCodexThreadId: (value: string) => void
  onSetCodexThreadMetadataJson: (value: string) => void
  onSetCodexThreadName: (value: string) => void
  onSetCodexThreadSettingsJson: (value: string) => void
  onSetCodexThreadSort: (value: 'updated' | 'name' | 'source') => void
  onSetCodexThreadSourceFilter: (value: 'all' | 'loaded' | 'stored') => void
  onSetCodexTurnItemsLimit: (value: string) => void
  onSetCodexThreadActionParamsJson: (value: string) => void
  onSetCodexThreadReviewBranch: (value: string) => void
  onSetCodexThreadReviewDelivery: (value: 'detached' | 'inline') => void
  onSetCodexThreadReviewType: (value: CodexReviewTarget['type']) => void
  onSettings: () => void
  onSetGoal: () => void
  onTemplateInjectText: () => void
  onTemplateMetadata: () => void
  onTemplateReviewBranch: () => void
  onTemplateReviewUncommitted: () => void
  onTemplateSettings: () => void
  onUnarchive: () => void
  onUnsubscribe: () => void
}

type ThreadsPanelProps = {
  state: ThreadsPanelState
  actions: ThreadsPanelActions
  isCodexProtoTransport?: boolean
}

export function ThreadsPanel({ state, actions }: ThreadsPanelProps) {
  const {
    codexInjectItemsJson,
    codexLoadedThreads,
    codexRealtimeAudioBase64,
    codexRealtimeText,
    codexStoredThreads,
    codexTargetItemId,
    codexTargetTurnId,
    codexThreadDescriptors,
    codexThreadFilter,
    codexThreadGoal,
    codexThreadGoalObjective,
    codexThreadId,
    codexThreadMetadataJson,
    codexThreadName,
    codexThreadSettingsJson,
    codexThreadSnapshot,
    codexConversationSummary,
    codexGitDiffToRemote,
    codexAuthStatus,
    codexThreadSort,
    codexThreadSourceFilter,
    codexThreadTurnItems,
    codexThreadTurns,
    codexThreadActionParamsJson,
    codexThreadReviewBranch,
    codexThreadReviewDelivery,
    codexThreadReviewType,
    codexTurnItemsLimit,
    currentThreadIdForCaps,
    filteredCodexThreadDescriptors,
    selectableCodexItemIds,
    selectableCodexThreadIds,
    selectableCodexTurnIds,
    selectedCodexThreadSummary,
    targetCodexThreadId,
    threadBusy,
  } = state
  const {
    onArchive,
    onClearGoal,
    onCompact,
    onCleanTerminals,
    onFork,
    onGetGoal,
    onInjectItems,
    onInterrupt,
    onMemoryOff,
    onMemoryOn,
    onMetadata,
    onName,
    onRead,
    onReadTurnItems,
    onRealtimeAudio,
    onRealtimeStart,
    onRealtimeStop,
    onRealtimeText,
    onRefresh,
    onReload,
    onResetMemory,
    onReview,
    onRollback,
    onSearchThreads,
    onStartThread,
    onResumeThread,
    onStartTurn,
    onListRealtimeVoices,
    onApproveGuardianDeniedAction,
    onIncrementElicitation,
    onDecrementElicitation,
    onReadConversationSummary,
    onReadGitDiffToRemote,
    onReadAuthStatus,
    onSetCodexInjectItemsJson,
    onSetCodexRealtimeAudioBase64,
    onSetCodexRealtimeText,
    onSetCodexTargetItemId,
    onSetCodexTargetTurnId,
    onSetCodexThreadFilter,
    onSetCodexThreadGoalObjective,
    onSetCodexThreadId,
    onSetCodexThreadMetadataJson,
    onSetCodexThreadName,
    onSetCodexThreadSettingsJson,
    onSetCodexThreadSort,
    onSetCodexThreadSourceFilter,
    onSetCodexTurnItemsLimit,
    onSetCodexThreadActionParamsJson,
    onSetCodexThreadReviewBranch,
    onSetCodexThreadReviewDelivery,
    onSetCodexThreadReviewType,
    onSettings,
    onSetGoal,
    onTemplateInjectText,
    onTemplateMetadata,
    onTemplateReviewBranch,
    onTemplateReviewUncommitted,
    onTemplateSettings,
    onUnarchive,
    onUnsubscribe,
  } = actions
  const parsedMetadata = parseThreadMetadataJson(codexThreadMetadataJson)
  const parsedSettings = parseThreadSettingsJson(codexThreadSettingsJson)
  const metadata = parsedMetadata ?? {}
  const settings = parsedSettings ?? {}
  const threadMetadataMessage = parsedMetadata === null
    ? 'Thread metadata JSON must be a valid JSON object.'
    : null
  const threadSettingsMessage = parsedSettings === null
    ? 'Thread settings JSON must be a valid JSON object.'
    : null

  const metadataSource = typeof metadata.source === 'string' ? metadata.source : ''
  const metadataWorkspace = typeof metadata.workspace === 'string' ? metadata.workspace : ''
  const settingsApprovalPolicy = typeof settings.approvalPolicy === 'string' ? settings.approvalPolicy : ''
  const settingsSandbox = typeof settings.sandbox === 'string' ? settings.sandbox : ''

  const updateThreadMetadataField = (field: 'source' | 'workspace', value: string) => {
    if (field === 'source') {
      onSetCodexThreadMetadataJson(
        buildMetadataJson(parseThreadMetadataJson(codexThreadMetadataJson) ?? {}, value, metadataWorkspace)
      )
      return
    }

    onSetCodexThreadMetadataJson(
      buildMetadataJson(
        parseThreadMetadataJson(codexThreadMetadataJson) ?? {},
        metadataSource,
        value
      )
    )
  }

  const updateThreadSettingsField = (
    field: 'approvalPolicy' | 'sandbox',
    value: string
  ) => {
    if (field === 'approvalPolicy') {
      onSetCodexThreadSettingsJson(
        buildSettingsJson(parseThreadSettingsJson(codexThreadSettingsJson) ?? {}, value, settingsSandbox)
      )
      return
    }

    onSetCodexThreadSettingsJson(
      buildSettingsJson(
        parseThreadSettingsJson(codexThreadSettingsJson) ?? {},
        settingsApprovalPolicy,
        value
      )
    )
  }

  const reviewTypeValue = codexThreadReviewType
  const reviewDeliveryValue: ReviewDeliveryMode =
    codexThreadReviewDelivery.trim() === 'inline' ? 'inline' : 'detached'
  const [reviewCommitSha, setReviewCommitSha] = useState('')
  const [reviewCommitTitle, setReviewCommitTitle] = useState('')
  const [reviewCustomInstructions, setReviewCustomInstructions] = useState('')
  const [showAdvancedThreadActionParams, setShowAdvancedThreadActionParams] =
    useState(false)
  const [threadActionParamFields, setThreadActionParamFields] = useState<
    ThreadActionParamField[]
  >([{ key: '', value: '' }])
  const [showAdvancedInjectItemsJson, setShowAdvancedInjectItemsJson] =
    useState(false)
  const [threadInjectItemFields, setThreadInjectItemFields] = useState<
    ThreadInjectItemField[]
  >([{ value: '' }])
  const reviewTargetMode =
    reviewTypeValue === 'baseBranch'
      ? 'baseBranch'
      : reviewTypeValue === 'commit'
        ? 'commit'
        : reviewTypeValue === 'custom'
          ? 'custom'
          : reviewTypeValue === 'uncommittedChanges'
            ? 'uncommittedChanges'
            : 'uncommittedChanges'

  const buildThreadReviewTarget = (): CodexReviewTarget | null => {
    if (reviewTargetMode === 'baseBranch') {
      return {
        type: 'baseBranch',
        branch: codexThreadReviewBranch.trim() || 'main',
      }
    }

    if (reviewTargetMode === 'commit') {
      const sha = reviewCommitSha.trim()
      if (!sha) return null
      const title = reviewCommitTitle.trim()
      return {
        type: 'commit',
        sha,
        ...(title ? { title } : {}),
      }
    }

    if (reviewTargetMode === 'custom') {
      const instructions = reviewCustomInstructions.trim()
      if (!instructions) return null
      return {
        type: 'custom',
        instructions,
      }
    }

    return { type: 'uncommittedChanges' }
  }

  const parsedThreadActionParams = parseThreadActionParams(
    codexThreadActionParamsJson || '{}'
  )
  const threadActionParamsMessage = parsedThreadActionParams === null
    ? 'Thread action params JSON must be a valid JSON object.'
    : null
  const parsedThreadInjectItems = parseThreadInjectItems(
    codexInjectItemsJson || '[]'
  )
  const threadInjectItemsMessage = parsedThreadInjectItems === null
    ? 'Thread inject items JSON must be a valid JSON array.'
    : null

  const setThreadActionParamFieldsFromValue = (
    fields: ThreadActionParamField[] = threadActionParamFields
  ) => {
    const nextPayload = fields.reduce<Record<string, unknown>>((acc, field) => {
      const nextKey = field.key.trim()
      if (!nextKey) return acc
      if (Object.prototype.hasOwnProperty.call(acc, nextKey)) return acc
      acc[nextKey] = parseThreadActionParamValue(field.value)
      return acc
    }, {})
    onSetCodexThreadActionParamsJson(stringifyCodexJson(nextPayload, '{}'))
  }

  const setThreadActionParamField = (
    index: number,
    field: ThreadActionParamField
  ) => {
    const nextFields = threadActionParamFields.map((nextField, nextIndex) =>
      nextIndex === index ? field : nextField
    )
    setThreadActionParamFields(nextFields)
    if (!showAdvancedThreadActionParams) {
      setThreadActionParamFieldsFromValue(nextFields)
    }
  }

  const addThreadActionParamField = () => {
    setThreadActionParamFields([...threadActionParamFields, { key: '', value: '' }])
  }

  const removeThreadActionParamField = (index: number) => {
    const nextFields = threadActionParamFields.filter((_, nextIndex) => {
      return nextIndex !== index
    })
    const fallbackFields = nextFields.length ? nextFields : [{ key: '', value: '' }]
    setThreadActionParamFields(fallbackFields)
    if (!showAdvancedThreadActionParams) {
      setThreadActionParamFieldsFromValue(fallbackFields)
    }
  }
  const setThreadInjectItemFieldsFromValue = (
    fields: ThreadInjectItemField[] = threadInjectItemFields
  ) => {
    const nextItems = fields.reduce<unknown[]>((acc, field) => {
      const nextValue = field.value.trim()
      if (!nextValue) return acc
      acc.push(parseThreadInjectItemValue(field.value))
      return acc
    }, [])
    onSetCodexInjectItemsJson(stringifyCodexJson(nextItems, '[]'))
  }

  const setThreadInjectItemField = (
    index: number,
    value: string
  ) => {
    const nextFields = threadInjectItemFields.map((nextField, nextIndex) =>
      nextIndex === index ? { ...nextField, value } : nextField
    )
    setThreadInjectItemFields(nextFields)
    if (!showAdvancedInjectItemsJson) {
      setThreadInjectItemFieldsFromValue(nextFields)
    }
  }

  const addThreadInjectItem = () => {
    setThreadInjectItemFields([...threadInjectItemFields, { value: '' }])
  }

  const removeThreadInjectItem = (index: number) => {
    const nextFields = threadInjectItemFields.filter((_, nextIndex) => {
      return nextIndex !== index
    })
    const fallbackFields = nextFields.length ? nextFields : [{ value: '' }]
    setThreadInjectItemFields(fallbackFields)
    if (!showAdvancedInjectItemsJson) {
      setThreadInjectItemFieldsFromValue(fallbackFields)
    }
  }

  useEffect(() => {
    if (showAdvancedThreadActionParams) return
    const nextParsedThreadActionParams = parseThreadActionParams(
      codexThreadActionParamsJson || '{}'
    )
    if (!nextParsedThreadActionParams) {
      setThreadActionParamFields([{ key: '', value: '' }])
      return
    }
    const nextFields = Object.entries(nextParsedThreadActionParams).map(
      ([fieldKey, fieldValue]) => ({
        key: fieldKey,
        value:
          typeof fieldValue === 'string'
            ? fieldValue
            : stringifyCodexJson(fieldValue, String(fieldValue ?? '')),
      })
    )
    setThreadActionParamFields(nextFields.length ? nextFields : [{ key: '', value: '' }])
  }, [showAdvancedThreadActionParams, codexThreadActionParamsJson])

  useEffect(() => {
    if (showAdvancedInjectItemsJson) return
    const nextParsedInjectItems = parseThreadInjectItems(codexInjectItemsJson || '[]')
    if (!nextParsedInjectItems) {
      setThreadInjectItemFields([{ value: '' }])
      return
    }
    const nextFields = nextParsedInjectItems.map((item) => {
      if (typeof item === 'string') return { value: item }
      return { value: stringifyCodexJson(item, '') }
    })
    setThreadInjectItemFields(nextFields.length ? nextFields : [{ value: '' }])
  }, [showAdvancedInjectItemsJson, codexInjectItemsJson])

  const reviewTarget = buildThreadReviewTarget()
  const hasCurrentThread = Boolean(currentThreadIdForCaps)
  const canRunTargetedThreadAction = hasCurrentThread && Boolean(targetCodexThreadId) && !threadBusy
  const canRunTypedReview =
    hasCurrentThread && Boolean(targetCodexThreadId) && !threadBusy && reviewTarget !== null
  const buildThreadReviewParams = () => {
    if (!reviewTarget) return null
    return {
      delivery: reviewDeliveryValue,
      target: reviewTarget,
    }
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Threads</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || threadBusy}
          onClick={() => onRefresh()}
        >
          Refresh
        </button>
      </div>
      <div className="mb-1 flex gap-1">
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Codex thread id"
          value={codexThreadId}
          onChange={(event) => onSetCodexThreadId(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || !targetCodexThreadId || threadBusy}
          onClick={() => onRead()}
        >
          Read
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || !targetCodexThreadId || threadBusy}
          onClick={() => onReadTurnItems()}
        >
          Read turn items
        </button>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        <div className="min-h-12 grid grid-cols-1 gap-1">
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Thread metadata source"
            value={metadataSource}
            onChange={(event) => updateThreadMetadataField('source', event.target.value)}
          />
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Thread metadata workspace"
            value={metadataWorkspace}
            onChange={(event) =>
              updateThreadMetadataField('workspace', event.target.value)
            }
          />
        <details className="rounded border border-border/60 px-2 py-1">
          <summary className="cursor-pointer text-[9px] text-muted-foreground">
            Advanced metadata JSON
          </summary>
            <textarea
              className="mt-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="Thread metadata JSON"
              value={codexThreadMetadataJson}
              onChange={(event) => onSetCodexThreadMetadataJson(event.target.value)}
            />
          </details>
          {threadMetadataMessage ? (
            <div className="text-destructive">{threadMetadataMessage}</div>
          ) : null}
        </div>
        <div className="min-h-12 grid grid-cols-1 gap-1">
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Thread approval policy"
            value={settingsApprovalPolicy}
            onChange={(event) =>
              updateThreadSettingsField('approvalPolicy', event.target.value)
            }
          />
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Thread sandbox"
            value={settingsSandbox}
            onChange={(event) =>
              updateThreadSettingsField('sandbox', event.target.value)
            }
          />
          <details className="rounded border border-border/60 px-2 py-1">
            <summary className="cursor-pointer text-[9px] text-muted-foreground">
              Advanced settings JSON
            </summary>
            <textarea
              className="mt-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="Thread settings JSON"
              value={codexThreadSettingsJson}
              onChange={(event) => onSetCodexThreadSettingsJson(event.target.value)}
            />
          </details>
          {threadSettingsMessage ? (
            <div className="text-destructive">{threadSettingsMessage}</div>
          ) : null}
        </div>
        <div className="min-h-12 grid grid-cols-1 gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              onClick={() =>
                setShowAdvancedInjectItemsJson((previous) => !previous)
              }
            >
              {showAdvancedInjectItemsJson
                ? 'Use item rows'
                : 'Advanced inject items JSON'}
            </button>
          </div>
          {showAdvancedInjectItemsJson ? (
            <textarea
              className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="Inject items JSON array"
              value={codexInjectItemsJson}
              onChange={(event) =>
                onSetCodexInjectItemsJson(event.target.value)
              }
            />
          ) : (
            <div className="space-y-1">
              {threadInjectItemFields.map((field, index) => (
                <div
                  key={`${field.value || 'item'}-${index}`}
                  className="grid grid-cols-[1fr_auto] gap-1"
                >
                  <textarea
                    className="min-h-8 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
                    placeholder="Inject item (JSON value/object or plain text)"
                    value={field.value}
                    onChange={(event) =>
                      setThreadInjectItemField(index, event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="text-[9px] underline disabled:opacity-50"
                    onClick={() => removeThreadInjectItem(index)}
                  >
                    remove
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-muted-foreground">
                  Add one inject item per row.
                </span>
                <button
                  type="button"
                  className="text-[9px] underline disabled:opacity-50"
                  onClick={addThreadInjectItem}
                >
                  + add item
                </button>
              </div>
            </div>
          )}
          {threadInjectItemsMessage ? (
            <div className="text-destructive">{threadInjectItemsMessage}</div>
          ) : null}
        </div>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button type="button" className="text-[9px] underline" onClick={() => onTemplateMetadata()}>Metadata template</button>
        <button type="button" className="text-[9px] underline" onClick={() => onTemplateSettings()}>Settings template</button>
        <button type="button" className="text-[9px] underline" onClick={() => onTemplateInjectText()}>Inject text template</button>
        <button type="button" className="text-[9px] underline" onClick={() => onTemplateReviewUncommitted()}>Review uncommitted template</button>
        <button type="button" className="text-[9px] underline" onClick={() => onTemplateReviewBranch()}>Review branch template</button>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-3">
        <select
          className="h-6 rounded border bg-background px-2 text-[10px]"
          value={reviewTargetMode}
          onChange={(event) =>
            onSetCodexThreadReviewType(
              event.target.value as 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom'
            )
          }
        >
          <option value="uncommittedChanges">Uncommitted changes</option>
          <option value="baseBranch">Base branch</option>
          <option value="commit">Commit</option>
          <option value="custom">Custom instructions</option>
        </select>
        {reviewTargetMode === 'baseBranch' ? (
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Review branch (for base branch mode)"
            value={codexThreadReviewBranch}
            onChange={(event) => onSetCodexThreadReviewBranch(event.target.value)}
          />
        ) : null}
        {reviewTargetMode === 'commit' ? (
          <>
            <Input
              className="h-6 px-2 text-[10px]"
              placeholder="Review commit SHA"
              value={reviewCommitSha}
              onChange={(event) => setReviewCommitSha(event.target.value)}
            />
            <Input
              className="h-6 px-2 text-[10px]"
              placeholder="Optional commit title"
              value={reviewCommitTitle}
              onChange={(event) => setReviewCommitTitle(event.target.value)}
            />
          </>
        ) : null}
        {reviewTargetMode === 'custom' ? (
          <textarea
            className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
            placeholder="Custom review instructions"
            value={reviewCustomInstructions}
            onChange={(event) => setReviewCustomInstructions(event.target.value)}
          />
        ) : null}
        <select
          className="h-6 rounded border bg-background px-2 text-[10px]"
          value={reviewDeliveryValue === 'inline' ? 'inline' : 'detached'}
          onChange={(event) =>
            onSetCodexThreadReviewDelivery(event.target.value as 'detached' | 'inline')
          }
        >
          <option value="detached">Detached</option>
          <option value="inline">Inline</option>
        </select>
      </div>
      <div className="mb-1">
        <div className="mb-1 flex gap-2">
          <button
            type="button"
            className="text-[9px] underline"
            onClick={() =>
              setShowAdvancedThreadActionParams((previous) => !previous)
            }
          >
            {showAdvancedThreadActionParams
              ? 'Use params form'
              : 'Advanced action params JSON'}
          </button>
        </div>
        {showAdvancedThreadActionParams ? (
          <textarea
            className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
            placeholder="Thread action params JSON"
            value={codexThreadActionParamsJson}
            onChange={(event) =>
              onSetCodexThreadActionParamsJson(event.target.value)
            }
          />
        ) : (
          <div className="mb-1 space-y-1">
            {threadActionParamFields.map((field, index) => (
              <div
                key={`${field.key || 'param'}-${index}`}
                className="grid grid-cols-[1.2fr_1.8fr_auto] gap-1"
              >
                <Input
                  className="h-6 px-2 text-[10px]"
                  placeholder="param key"
                  value={field.key}
                  onChange={(event) =>
                    setThreadActionParamField(index, {
                      ...field,
                      key: event.target.value,
                    })
                  }
                />
                <Input
                  className="h-6 px-2 text-[10px]"
                  placeholder="param value"
                  value={field.value}
                  onChange={(event) =>
                    setThreadActionParamField(index, {
                      ...field,
                      value: event.target.value,
                    })
                  }
                />
                <button
                  type="button"
                  className="text-[9px] underline disabled:opacity-50"
                  onClick={() => removeThreadActionParamField(index)}
                >
                  remove
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] text-muted-foreground">
                Add top-level params for thread action payload.
              </span>
              <button
                type="button"
                className="text-[9px] underline disabled:opacity-50"
                onClick={addThreadActionParamField}
              >
                + add param
              </button>
            </div>
          </div>
        )}
        {threadActionParamsMessage ? (
          <div className="mb-1 text-destructive">{threadActionParamsMessage}</div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onSearchThreads()}>Search</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onStartThread()}>Start</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onResumeThread()}>Resume</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onStartTurn()}>Start turn</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !codexThreadId.trim()} onClick={() => onListRealtimeVoices()}>Realtime voices</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onApproveGuardianDeniedAction()}>Approve guardian</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onIncrementElicitation()}>Increment elicitation</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onDecrementElicitation()}>Decrement elicitation</button>
        </div>
      </div>
      <div className="mb-1 rounded border bg-background/40 p-1">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[9px]">
          <span className="text-muted-foreground">Thread diagnostics</span>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onReadConversationSummary()}>Conversation summary</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onReadGitDiffToRemote()}>Git diff to remote</button>
          <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!currentThreadIdForCaps || threadBusy || !!threadActionParamsMessage} onClick={() => onReadAuthStatus()}>Auth status</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words">
            {codexConversationSummary != null
              ? JSON.stringify(codexConversationSummary, null, 2)
              : '— conversation summary'}
          </pre>
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words">
            {codexGitDiffToRemote != null
              ? JSON.stringify(codexGitDiffToRemote, null, 2)
              : '— git diff to remote'}
          </pre>
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words">
            {codexAuthStatus != null ? JSON.stringify(codexAuthStatus, null, 2) : '— auth status'}
          </pre>
        </div>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-3">
        <Input className="h-6 px-2 text-[10px]" placeholder="Thread name" value={codexThreadName} onChange={(event) => onSetCodexThreadName(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Goal objective" value={codexThreadGoalObjective} onChange={(event) => onSetCodexThreadGoalObjective(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Turn id for items / rollback" value={codexTargetTurnId} onChange={(event) => onSetCodexTargetTurnId(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Item id for rollback" value={codexTargetItemId} onChange={(event) => onSetCodexTargetItemId(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Turn items limit" value={codexTurnItemsLimit} onChange={(event) => onSetCodexTurnItemsLimit(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Realtime text" value={codexRealtimeText} onChange={(event) => onSetCodexRealtimeText(event.target.value)} />
        <Input className="h-6 px-2 text-[10px]" placeholder="Realtime audio base64" value={codexRealtimeAudioBase64} onChange={(event) => onSetCodexRealtimeAudioBase64(event.target.value)} />
      </div>
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onFork()}>Fork</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onArchive()}>Archive</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onUnarchive()}>Unarchive</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onUnsubscribe()}>Unsubscribe</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction || !codexThreadName.trim()} onClick={() => onName()}>Name</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction || !!threadMetadataMessage} onClick={() => onMetadata()}>Metadata</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction || !!threadSettingsMessage} onClick={() => onSettings()}>Settings</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onSetGoal()}>Set goal</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onGetGoal()}>Get goal</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onClearGoal()}>Clear goal</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onMemoryOn()}>Memory on</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onMemoryOff()}>Memory off</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onResetMemory()}>Reset memory</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onInterrupt()}>Interrupt</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onCompact()}>Compact</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onReload()}>Reload</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onRollback()}>Rollback</button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!canRunTargetedThreadAction}
          onClick={() =>
            onReview({
              delivery: reviewDeliveryValue,
              target: {
                type: 'uncommittedChanges',
              },
            })
          }
        >
          Review uncommitted
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!canRunTargetedThreadAction}
          onClick={() =>
            onReview({
              delivery: reviewDeliveryValue,
              target: {
                type: 'baseBranch',
                branch: codexThreadReviewBranch.trim() || 'main',
              },
            })
          }
        >
          Review branch
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!canRunTypedReview}
          onClick={() => {
            const params = buildThreadReviewParams()
            if (!params) return
            onReview(params)
          }}
        >
          Review with typed params
        </button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction || !!threadInjectItemsMessage} onClick={() => onInjectItems()}>Inject items</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onCleanTerminals()}>Clean terminals</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onRealtimeStart()}>Realtime start</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onRealtimeText()}>Realtime text</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onRealtimeAudio()}>Realtime audio</button>
        <button type="button" className="text-[9px] underline disabled:opacity-50" disabled={!canRunTargetedThreadAction} onClick={() => onRealtimeStop()}>Realtime stop</button>
      </div>
      <div className="mb-0.5 flex items-center gap-2 text-[8px] text-muted-foreground">
        <span>Thread data sources</span>
        <span className="text-blue-300">L:{codexThreadDescriptors.filter((t) => t.source === 'loaded').length}</span>
        <span className="text-amber-300">S:{codexThreadDescriptors.filter((t) => t.source === 'stored').length}</span>
        <span className="text-[7px]">(table is the primary readable view; raw below for diagnostics)</span>
      </div>
      <details className="mb-1 text-[8px]">
        <summary className="cursor-pointer text-muted-foreground">Raw loaded / stored responses (JSON)</summary>
        <div className="mt-0.5 grid grid-cols-1 gap-1 md:grid-cols-2">
          <pre className="max-h-16 overflow-auto whitespace-pre-wrap break-words border rounded p-0.5">
            {codexLoadedThreads ? JSON.stringify(codexLoadedThreads, null, 2) : '— loaded threads'}
          </pre>
          <pre className="max-h-16 overflow-auto whitespace-pre-wrap break-words border rounded p-0.5">
            {codexStoredThreads ? JSON.stringify(codexStoredThreads, null, 2) : '— stored threads'}
          </pre>
        </div>
      </details>
      {codexThreadDescriptors.length ? (
        <div className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-3">
          <Input className="h-6 px-2 text-[10px]" placeholder="Search threads" value={codexThreadFilter} onChange={(event) => onSetCodexThreadFilter(event.target.value)} />
          <select className="h-6 rounded border bg-background px-2 text-[10px]" value={codexThreadSourceFilter} onChange={(event) => onSetCodexThreadSourceFilter(event.target.value as 'all' | 'loaded' | 'stored')}>
            <option value="all">All sources</option>
            <option value="loaded">Loaded only</option>
            <option value="stored">Stored only</option>
          </select>
          <select className="h-6 rounded border bg-background px-2 text-[10px]" value={codexThreadSort} onChange={(event) => onSetCodexThreadSort(event.target.value as 'updated' | 'name' | 'source')}>
            <option value="updated">Sort by updated</option>
            <option value="name">Sort by name</option>
            <option value="source">Sort by source</option>
          </select>
        </div>
      ) : null}
      {codexThreadDescriptors.length ? (
        <div className="mt-1">
          <div className="text-[9px] text-muted-foreground mb-0.5">
            {filteredCodexThreadDescriptors.length}/{codexThreadDescriptors.length} threads — loaded: {filteredCodexThreadDescriptors.filter((t) => t.source === 'loaded').length}/{codexThreadDescriptors.filter((t) => t.source === 'loaded').length} • stored: {filteredCodexThreadDescriptors.filter((t) => t.source === 'stored').length}/{codexThreadDescriptors.filter((t) => t.source === 'stored').length} (click row to select)
          </div>
          <table className="w-full text-[8px] font-mono border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-0.5 py-px">Id / Name</th>
                <th className="px-0.5 py-px">Status</th>
                <th className="px-0.5 py-px">Source</th>
                <th className="px-0.5 py-px">Updated</th>
                <th className="px-0.5 py-px">Turns</th>
                <th className="px-0.5 py-px">Items</th>
                <th className="px-0.5 py-px">Goal</th>
              </tr>
            </thead>
            <tbody>
              {filteredCodexThreadDescriptors.map((thread) => {
                const isSelected = targetCodexThreadId === thread.id
                const sourceBadge = thread.source === 'loaded' ? 'L' : 'S'
                const sourceClass = thread.source === 'loaded' ? 'bg-blue-500/30 text-blue-200' : 'bg-amber-500/30 text-amber-200'
                return (
                  <tr
                    key={thread.id}
                    className={cn(
                      'border-b hover:bg-accent cursor-pointer',
                      isSelected && 'bg-accent',
                      thread.source === 'loaded' ? 'border-l-2 border-l-blue-500/40' : 'border-l-2 border-l-amber-500/40'
                    )}
                    title={thread.id}
                    onClick={() => onSetCodexThreadId(thread.id)}
                  >
                    <td className="px-0.5 py-px truncate max-w-[12em]">
                      <span className={cn('inline-block w-3 text-center rounded text-[6px] mr-0.5 font-sans', sourceClass)}>{sourceBadge}</span>
                      {thread.name ?? thread.id}
                    </td>
                    <td className="px-0.5 py-px truncate text-muted-foreground">{thread.status ?? '—'}</td>
                    <td className="px-0.5 py-px">
                      <span className={cn('rounded px-0.5 text-[6px] font-sans', sourceClass)}>{thread.source}</span>
                    </td>
                    <td className="px-0.5 py-px truncate text-muted-foreground">{thread.updatedAt ?? '—'}</td>
                    <td className="px-0.5 py-px">{thread.turns ?? '—'}</td>
                    <td className="px-0.5 py-px">{thread.turnItems ?? '—'}</td>
                    <td className="px-0.5 py-px truncate max-w-[10em] text-muted-foreground">{thread.goal ?? '—'}</td>
                  </tr>
                )
              })}
              {!filteredCodexThreadDescriptors.length ? (
                <tr>
                  <td colSpan={7} className="px-0.5 py-1 text-muted-foreground">No matching Codex threads.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {selectableCodexThreadIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexThreadIds.map((threadId) => (
            <button
              key={threadId}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                targetCodexThreadId === threadId && 'bg-accent'
              )}
              title={threadId}
              onClick={() => onSetCodexThreadId(threadId)}
            >
              {threadId}
            </button>
          ))}
        </div>
      ) : null}
      {selectedCodexThreadSummary ? (
        <div className="mt-1 rounded border bg-background/40 p-1 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
            <span className="truncate">
              Selected thread: {selectedCodexThreadSummary.name ?? selectedCodexThreadSummary.id}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {selectedCodexThreadSummary.source ?? 'manual'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] md:grid-cols-4">
            <span className="text-muted-foreground">status</span>
            <span className="truncate">{selectedCodexThreadSummary.status ?? '—'}</span>
            <span className="text-muted-foreground">updated</span>
            <span className="truncate">{selectedCodexThreadSummary.updatedAt ?? '—'}</span>
            <span className="text-muted-foreground">turns</span>
            <span>{selectedCodexThreadSummary.turns ?? '—'}</span>
            <span className="text-muted-foreground">items</span>
            <span>{selectedCodexThreadSummary.turnItems ?? '—'}</span>
            <span className="text-muted-foreground">goal</span>
            <span className="truncate md:col-span-3">{selectedCodexThreadSummary.goal || '—'}</span>
          </div>
        </div>
      ) : null}
      <details className="mt-1 text-[8px]">
        <summary className="cursor-pointer text-muted-foreground">Selected thread raw data (snapshot / turns / items / goal JSON — reduced prominence for readable summaries)</summary>
        <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap break-words border rounded p-0.5">
          {codexThreadSnapshot || codexThreadTurns || codexThreadTurnItems || codexThreadGoal
            ? JSON.stringify(
                {
                  thread: codexThreadSnapshot,
                  turns: codexThreadTurns,
                  turnItems: codexThreadTurnItems,
                  goal: codexThreadGoal,
                },
                null,
                2
              )
            : '— selected thread'}
        </pre>
      </details>
      {selectableCodexTurnIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexTurnIds.map((turnId) => (
            <button
              key={turnId}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexTargetTurnId.trim() === turnId && 'bg-accent'
              )}
              title={turnId}
              onClick={() => onSetCodexTargetTurnId(turnId)}
            >
              turn:{turnId}
            </button>
          ))}
        </div>
      ) : null}
      {selectableCodexItemIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexItemIds.map((itemId) => (
            <button
              key={itemId}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexTargetItemId.trim() === itemId && 'bg-accent'
              )}
              title={itemId}
              onClick={() => onSetCodexTargetItemId(itemId)}
            >
              item:{itemId}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
