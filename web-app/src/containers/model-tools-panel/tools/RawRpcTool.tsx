import { useEffect, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

import {
  RawRpcMethodCatalog,
  type RawRpcCatalogItem,
} from './RawRpcMethodCatalog'
import { resolveCodexRawRpcMethod } from './raw-rpc-utils'

type RawRpcParamField = {
  key: string
  value: string
}

type RawRpcToolState = {
  codexMcpServerName: string
  codexMcpToolArguments: string
  codexMcpToolName: string
  codexRawRpcCatalog: RawRpcCatalogItem[]
  codexRawRpcCatalogFilter: string
  codexRawRpcMethod: string
  codexRawRpcParams: string
  codexRawRpcSnapshot: unknown
  filteredCodexRawRpcCatalog: RawRpcCatalogItem[]
  rawRpcBusy: boolean
}

type RawRpcToolActions = {
  parseCodexRawRpcPresetJson: (value: string, fallback: unknown) => unknown
  runCodexRawRpc: () => Promise<void>
  setCodexRawRpcCatalogFilter: (value: string) => void
  setCodexRawRpcMethod: (value: string) => void
  setCodexRawRpcParams: (value: string) => void
}

type RawRpcToolProps = {
  state: RawRpcToolState
  actions: RawRpcToolActions
}

function normalizeTargets(value: string[]) {
  return value
    .map((target) => target.trim())
    .filter((target) => target.length > 0)
}

export function RawRpcTool({
  state,
  actions,
}: RawRpcToolProps) {
  const {
    codexMcpServerName,
    codexMcpToolArguments,
    codexMcpToolName,
    codexRawRpcCatalog,
    codexRawRpcCatalogFilter,
    codexRawRpcMethod,
    codexRawRpcParams,
    codexRawRpcSnapshot,
    filteredCodexRawRpcCatalog,
    rawRpcBusy,
  } = state
  const {
    parseCodexRawRpcPresetJson,
    runCodexRawRpc,
    setCodexRawRpcCatalogFilter,
    setCodexRawRpcMethod,
    setCodexRawRpcParams,
  } = actions


  const catalogMethods = useMemo(
    () =>
      Array.from(new Set(codexRawRpcCatalog.map((item) => item.method))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [codexRawRpcCatalog]
  )
  const catalogMethodDefaults = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    for (const item of codexRawRpcCatalog) {
      if (!map.has(item.method)) {
        map.set(item.method, item.params)
      }
    }
    return map
  }, [codexRawRpcCatalog])

  const [pluginShareRemotePluginId, setPluginShareRemotePluginId] = useState('')
  const [pluginSharePluginPath, setPluginSharePluginPath] = useState('')
  const [pluginShareTargets, setPluginShareTargets] = useState<string[]>([''])
  const [fuzzySessionId, setFuzzySessionId] = useState('')
  const [fuzzyQuery, setFuzzyQuery] = useState('')
  const [fuzzyLimit, setFuzzyLimit] = useState('50')
  const [allowUnknownRawRpcMethod, setAllowUnknownRawRpcMethod] = useState(false)
  const [showAdvancedRawRpcJson, setShowAdvancedRawRpcJson] = useState(false)
  const [rawRpcParamFields, setRawRpcParamFields] = useState<RawRpcParamField[]>([
    { key: '', value: '' },
  ])

  const parsedRawRpcParams = parseCodexJson<unknown>(
    codexRawRpcParams || '{}',
    {}
  )
  const methodText = codexRawRpcMethod.trim()
  const resolvedMethodText = resolveCodexRawRpcMethod(methodText)
  const isKnownRawRpcMethod =
    catalogMethods.includes(methodText) ||
    (resolvedMethodText !== methodText &&
      catalogMethods.includes(resolvedMethodText))
  const hasRawRpcParamsError =
    typeof parsedRawRpcParams !== 'object' ||
    parsedRawRpcParams === null ||
    Array.isArray(parsedRawRpcParams)
  const rawRpcParamsMessage = hasRawRpcParamsError
    ? 'Raw RPC params must be a valid JSON object.'
    : null
  const canCallRawRpc =
    !rawRpcBusy &&
    Boolean(methodText) &&
    !hasRawRpcParamsError &&
    (isKnownRawRpcMethod || allowUnknownRawRpcMethod)

  const setMethodWithPreset = (method: string) => {
    const trimmed = method.trim()
    setCodexRawRpcMethod(trimmed)
    setAllowUnknownRawRpcMethod(false)
    const resolved = resolveCodexRawRpcMethod(trimmed)
    if (!showAdvancedRawRpcJson) {
      const defaults =
        catalogMethodDefaults.get(trimmed) ?? catalogMethodDefaults.get(resolved)
      if (defaults) {
        setCodexRawRpcParams(stringifyCodexJson(defaults, codexRawRpcParams))
      }
    }
  }

  const syncPresetMethod = (method: string, params: Record<string, unknown>) => {
    setMethodWithPreset(method)
    if (!showAdvancedRawRpcJson) {
      setCodexRawRpcParams(stringifyCodexJson(params, codexRawRpcParams))
    }
  }

  const onSetPluginShareTarget = (index: number, value: string) => {
    const nextTargets = [...pluginShareTargets]
    nextTargets[index] = value
    setPluginShareTargets(nextTargets)
  }

  const addPluginShareTarget = () => {
    setPluginShareTargets((previous) => [...previous, ''])
  }

  const removePluginShareTarget = (index: number) => {
    setPluginShareTargets((previous) => {
      const nextTargets = previous.filter((_, nextIndex) => nextIndex !== index)
      return nextTargets.length > 0 ? nextTargets : ['']
    })
  }

  const parseRawRpcValue = (value: string): unknown => {
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

  const setRawRpcParamsFromFields = (
    fields: RawRpcParamField[] = rawRpcParamFields
  ) => {
    const nextPayload = fields.reduce<Record<string, unknown>>((acc, field) => {
      const fieldKey = field.key.trim()
      if (!fieldKey) return acc
      if (Object.prototype.hasOwnProperty.call(acc, fieldKey)) return acc
      acc[fieldKey] = parseRawRpcValue(field.value)
      return acc
    }, {})
    setCodexRawRpcParams(stringifyCodexJson(nextPayload, '{}'))
  }

  const setRawRpcParamField = (index: number, field: RawRpcParamField) => {
    const nextFields = rawRpcParamFields.map((nextField, nextIndex) =>
      nextIndex === index ? field : nextField
    )
    setRawRpcParamFields(nextFields)
    if (!showAdvancedRawRpcJson) {
      setRawRpcParamsFromFields(nextFields)
    }
  }

  const addRawRpcParamField = () => {
    setRawRpcParamFields([...rawRpcParamFields, { key: '', value: '' }])
  }

  const removeRawRpcParamField = (index: number) => {
    const nextFields = rawRpcParamFields.filter((_, nextIndex) => {
      return nextIndex !== index
    })
    const fallbackFields = nextFields.length ? nextFields : [{ key: '', value: '' }]
    setRawRpcParamFields(fallbackFields)
    if (!showAdvancedRawRpcJson) {
      setRawRpcParamsFromFields(fallbackFields)
    }
  }

  useEffect(() => {
    if (!showAdvancedRawRpcJson) {
      const parsed = parsedRawRpcParams
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setRawRpcParamFields([{ key: '', value: '' }])
        return
      }
      const nextFields = Object.entries(parsed).map(([fieldKey, fieldValue]) => ({
        key: fieldKey,
        value:
          typeof fieldValue === 'string'
            ? fieldValue
            : stringifyCodexJson(fieldValue, String(fieldValue ?? '')),
      }))
      setRawRpcParamFields(nextFields.length ? nextFields : [{ key: '', value: '' }])
    }
  }, [codexRawRpcParams, showAdvancedRawRpcJson, parsedRawRpcParams])

  const buildFuzzyParams = () => {
    const params: Record<string, unknown> = {
      sessionId: fuzzySessionId.trim(),
    }
    if (fuzzyQuery.trim()) {
      params.query = fuzzyQuery.trim()
    }
    const limit = Number.parseInt(fuzzyLimit, 10)
    if (Number.isFinite(limit) && limit > 0) {
      params.limit = limit
    }
    return params
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Raw app-server RPC</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!canCallRawRpc}
          onClick={() => void runCodexRawRpc()}
        >
          {rawRpcBusy ? 'Calling' : 'Call'}
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Escape hatch for current or future Codex app-server methods that do not
        yet have dedicated UI controls. High-use thread and config operations
        have dedicated typed panels (Threads / Config-Admin) with structured
        fields and advanced-JSON fallbacks; prefer those for common paths.
      </div>
      <RawRpcMethodCatalog
        filter={codexRawRpcCatalogFilter}
        items={filteredCodexRawRpcCatalog}
        totalCount={codexRawRpcCatalog.length}
        onFilterChange={setCodexRawRpcCatalogFilter}
        onSelect={syncPresetMethod}
      />
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!codexMcpServerName.trim() || !codexMcpToolName.trim()}
            onClick={() =>
            syncPresetMethod('mcpServer/tool/call', {
              server: codexMcpServerName.trim(),
              toolName: codexMcpToolName.trim(),
              arguments: parseCodexRawRpcPresetJson(
                codexMcpToolArguments || '{}',
                {}
              ),
            })
          }
        >
          preset: MCP tool
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!pluginShareRemotePluginId.trim()}
            onClick={() =>
            syncPresetMethod('plugin/share/list', {
              remotePluginId: pluginShareRemotePluginId.trim(),
            })
          }
        >
          preset: plugin/share/list
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!pluginShareRemotePluginId.trim() || !pluginSharePluginPath.trim()}
            onClick={() =>
            syncPresetMethod('plugin/share/checkout', {
              remotePluginId: pluginShareRemotePluginId.trim(),
              pluginPath: pluginSharePluginPath.trim(),
            })
          }
        >
          preset: plugin/share/checkout
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!pluginShareRemotePluginId.trim()}
            onClick={() =>
            syncPresetMethod('plugin/share/updateTargets', {
              remotePluginId: pluginShareRemotePluginId.trim(),
              targets: normalizeTargets(pluginShareTargets),
            })
          }
        >
          preset: plugin/share/updateTargets
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!pluginShareRemotePluginId.trim() || !pluginSharePluginPath.trim()}
            onClick={() =>
            syncPresetMethod('plugin/share/save', {
              remotePluginId: pluginShareRemotePluginId.trim(),
              pluginPath: pluginSharePluginPath.trim(),
              targets: normalizeTargets(pluginShareTargets),
            })
          }
        >
          preset: plugin/share/save
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!pluginShareRemotePluginId.trim()}
            onClick={() =>
            syncPresetMethod('plugin/share/delete', {
              remotePluginId: pluginShareRemotePluginId.trim(),
            })
          }
        >
          preset: plugin/share/delete
        </button>
        <div className="mb-1 flex w-full flex-wrap gap-x-2 gap-y-1">
          <Input
            className="h-6 min-w-0 flex-1 px-2 text-[10px]"
            placeholder="plugin share remote id"
            value={pluginShareRemotePluginId}
            onChange={(event) => setPluginShareRemotePluginId(event.target.value)}
          />
          <Input
            className="h-6 min-w-0 flex-1 px-2 text-[10px]"
            placeholder="plugin share plugin path"
            value={pluginSharePluginPath}
            onChange={(event) => setPluginSharePluginPath(event.target.value)}
          />
          <div className="w-full space-y-1">
            <div className="mb-1 text-[9px] text-muted-foreground">Plugin share targets</div>
            {pluginShareTargets.map((target, index) => (
              <div key={`plugin-target-${index}`} className="flex gap-1">
                <Input
                  className="h-6 min-w-0 px-2 text-[10px]"
                  placeholder="plugin share target"
                  value={target}
                  onChange={(event) =>
                    onSetPluginShareTarget(index, event.target.value)
                  }
                />
                <button
                  type="button"
                  className="text-[9px] underline disabled:opacity-50"
                  disabled={rawRpcBusy || pluginShareTargets.length <= 1}
                  onClick={() => removePluginShareTarget(index)}
                >
                  remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={rawRpcBusy}
              onClick={addPluginShareTarget}
            >
              + add target
            </button>
          </div>
        </div>
        <div className="mb-1 flex w-full gap-2">
          <Input
            className="h-6 min-w-0 px-2 text-[10px]"
            placeholder="fuzzy session id"
            value={fuzzySessionId}
            onChange={(event) => setFuzzySessionId(event.target.value)}
          />
          <Input
            className="h-6 min-w-0 px-2 text-[10px]"
            placeholder="fuzzy query"
            value={fuzzyQuery}
            onChange={(event) => setFuzzyQuery(event.target.value)}
          />
          <Input
            className="h-6 w-20 px-2 text-[10px]"
            placeholder="limit"
            value={fuzzyLimit}
            onChange={(event) => setFuzzyLimit(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!fuzzySessionId.trim()}
          onClick={() =>
            syncPresetMethod(
              'fuzzyFileSearch/sessionStart',
              buildFuzzyParams()
            )
          }
        >
          preset: fuzzy session start
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!fuzzySessionId.trim()}
          onClick={() =>
            syncPresetMethod(
              'fuzzyFileSearch/sessionUpdate',
              buildFuzzyParams()
            )
          }
        >
          preset: fuzzy session update
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!fuzzySessionId.trim()}
          onClick={() =>
            syncPresetMethod('fuzzyFileSearch/sessionStop', {
              sessionId: fuzzySessionId.trim(),
            })
          }
        >
          preset: fuzzy session stop
        </button>
      </div>
      <Input
        className="mb-1 h-6 px-2 text-[10px]"
        placeholder="method, e.g. model/list"
        value={codexRawRpcMethod}
        list="codex-raw-rpc-methods"
        onChange={(event) => setMethodWithPreset(event.target.value)}
      />
      {codexRawRpcMethod.trim() && !isKnownRawRpcMethod ? (
        <div className="mb-1 text-[9px] text-amber-700 dark:text-amber-500">
          Unknown method for catalog coverage. Raw RPC will send this method as-is.
        </div>
      ) : null}
      {codexRawRpcMethod.trim() && !isKnownRawRpcMethod ? (
        <label className="mb-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <input
            type="checkbox"
            checked={allowUnknownRawRpcMethod}
            onChange={(event) =>
              setAllowUnknownRawRpcMethod(event.target.checked)
            }
          />
          Confirm intentionally calling unknown method
        </label>
      ) : null}
      <datalist id="codex-raw-rpc-methods">
        {catalogMethods.map((method) => (
          <option key={method} value={method} />
        ))}
      </datalist>
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={rawRpcBusy}
          onClick={() =>
            setShowAdvancedRawRpcJson((previous) => !previous)
          }
        >
          {showAdvancedRawRpcJson ? 'Use params form' : 'Advanced params JSON'}
        </button>
      </div>
      {showAdvancedRawRpcJson ? (
        <textarea
          className="mb-1 min-h-16 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="params JSON"
          value={codexRawRpcParams}
          onChange={(event) => setCodexRawRpcParams(event.target.value)}
        />
      ) : (
        <div className="mb-1 space-y-1">
          {rawRpcParamFields.map((field, index) => (
            <div
              key={`${field.key || 'param'}-${index}`}
              className="grid grid-cols-[1.2fr_1.8fr_auto] gap-1"
            >
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="param key"
                value={field.key}
                onChange={(event) =>
                  setRawRpcParamField(index, {
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
                  setRawRpcParamField(index, {
                    ...field,
                    value: event.target.value,
                  })
                }
              />
              <button
                type="button"
                className="text-[9px] underline disabled:opacity-50"
                disabled={rawRpcBusy}
                onClick={() => removeRawRpcParamField(index)}
              >
                remove
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-muted-foreground">
              Add top-level params for method payload.
            </span>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={rawRpcBusy}
              onClick={addRawRpcParamField}
            >
              + add param
            </button>
          </div>
        </div>
      )}
      {rawRpcParamsMessage ? (
        <div className="mb-1 text-destructive">{rawRpcParamsMessage}</div>
      ) : null}
      <pre className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {codexRawRpcSnapshot
          ? JSON.stringify(codexRawRpcSnapshot, null, 2)
          : '— (raw RPC result)'}
      </pre>
    </div>
  )
}
