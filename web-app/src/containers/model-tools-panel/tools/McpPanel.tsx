import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'
import {
  buildJsonTemplateFromSchema,
  parseCodexJson,
  type CodexMcpResourceDescriptor,
  type CodexMcpToolDescriptor,
} from '../shared/codex-helpers'

type McpPanelState = {
  codexMcpServerName: string
  codexMcpResourceUri: string
  codexMcpToolName: string
  codexMcpToolArguments: string
  codexMcpDescriptorFilter: string
  mcpBusy: boolean
  currentThreadIdForCaps: string | null | undefined
  mcpStatus: unknown
  codexMcpSnapshot: unknown
  selectableCodexMcpServerNames: string[]
  selectableCodexMcpResourceUris: string[]
  selectableCodexMcpToolNames: string[]
  codexMcpResourceDescriptors: CodexMcpResourceDescriptor[]
  codexMcpToolDescriptors: CodexMcpToolDescriptor[]
  filteredCodexMcpResourceDescriptors: CodexMcpResourceDescriptor[]
  filteredCodexMcpToolDescriptors: CodexMcpToolDescriptor[]
  selectedCodexMcpToolDescriptor?: CodexMcpToolDescriptor
  codexMcpToolArgumentValidation: string[]
  isCodexProtoTransport?: boolean
}

type McpPanelActions = {
  onSetCodexMcpServerName: (value: string) => void
  onSetCodexMcpResourceUri: (value: string) => void
  onSetCodexMcpToolName: (value: string) => void
  onSetCodexMcpToolArguments: (value: string) => void
  onSetCodexMcpDescriptorFilter: (value: string) => void
  onSetCapError: (message: string) => void
  onRunCodexMcpAction: (
    method: string,
    params: Record<string, unknown>,
    success?: string
  ) => Promise<unknown | null>
  onMcpOauthLogin: () => Promise<void>
}

type McpPanelProps = {
  state: McpPanelState
  actions: McpPanelActions
}

type McpArgumentField = {
  key: string
  keyPath: string[]
  label: string
  type: 'string' | 'number' | 'integer' | 'boolean'
  required: boolean
  description?: string
  enumValues?: string[]
}

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const normalizeSchemaType = (
  schema: Record<string, unknown>
): McpArgumentField['type'] | null => {
  if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'string')) {
    return 'string'
  }
  // Support complex unions/optionals for v1 by normalizing first variant (template + validation already handle full unions)
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const variants = schema[key]
    if (Array.isArray(variants) && variants.length > 0) {
      const first = getRecord(variants[0])
      if (first) {
        const t = normalizeSchemaType(first)
        if (t) return t
      }
    }
  }
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number') return 'number'
  if (schema.type === 'integer') return 'integer'
  if (schema.type === 'boolean') return 'boolean'
  return null
}

const getSimpleArgumentFields = (
  schema: unknown,
  keyPath: string[] = []
): McpArgumentField[] => {
  const record = getRecord(schema)

  for (const variantKey of ['oneOf', 'anyOf', 'allOf'] as const) {
    const variants = record?.[variantKey]
    if (Array.isArray(variants) && variants.length > 0) {
      const fields = variants.flatMap((variant) =>
        getSimpleArgumentFields(variant, keyPath)
      )
      const seen = new Set<string>()
      return fields.filter((field) => {
        if (seen.has(field.key)) return false
        seen.add(field.key)
        return true
      })
    }
  }

  const properties = getRecord(record?.properties)
  if (!properties) return []

  const required = Array.isArray(record?.required)
    ? new Set(record.required.map((item) => String(item)))
    : new Set<string>()

  return Object.entries(properties).flatMap(([key, value]) => {
    const property = getRecord(value)
    if (!property) return []
    const nextKeyPath = [...keyPath, key]
    const type = normalizeSchemaType(property)
    if (!type) return getSimpleArgumentFields(property, nextKeyPath)
    return [
      {
        key: nextKeyPath.join('.'),
        keyPath: nextKeyPath,
        label: nextKeyPath.join('.'),
        type,
        required: required.has(key),
        description:
          typeof property.description === 'string'
            ? property.description
            : undefined,
        enumValues:
          Array.isArray(property.enum) &&
          property.enum.every((item) => typeof item === 'string')
            ? property.enum
            : undefined,
      },
    ]
  })
}

const parseArgumentObject = (value: string): Record<string, unknown> => {
  const parsed = parseCodexJson<unknown>(value || '{}', {})
  return getRecord(parsed) ?? {}
}

const stringifyArgumentObject = (value: Record<string, unknown>) =>
  JSON.stringify(value, null, 2)

const getNestedArgumentValue = (
  value: Record<string, unknown>,
  keyPath: string[]
): unknown => {
  let current: unknown = value
  for (const key of keyPath) {
    const record = getRecord(current)
    if (!record) return undefined
    current = record[key]
  }
  return current
}

const setNestedArgumentValue = (
  value: Record<string, unknown>,
  keyPath: string[],
  nextValue: unknown,
  deleteValue = false
): Record<string, unknown> => {
  if (!keyPath.length) return value
  const [key, ...rest] = keyPath
  if (!rest.length) {
    const next = { ...value }
    if (deleteValue) {
      delete next[key]
    } else {
      next[key] = nextValue
    }
    return next
  }
  const child = getRecord(value[key]) ?? {}
  return {
    ...value,
    [key]: setNestedArgumentValue(child, rest, nextValue, deleteValue),
  }
}

export function McpPanel({
  state,
  actions,
}: McpPanelProps) {
  const {
    codexMcpServerName,
    codexMcpResourceUri,
    codexMcpToolName,
    codexMcpToolArguments,
    codexMcpDescriptorFilter,
    mcpBusy,
    currentThreadIdForCaps,
    mcpStatus,
    codexMcpSnapshot,
    selectableCodexMcpServerNames,
    selectableCodexMcpResourceUris,
    selectableCodexMcpToolNames,
    codexMcpResourceDescriptors,
    codexMcpToolDescriptors,
    filteredCodexMcpResourceDescriptors,
    filteredCodexMcpToolDescriptors,
    selectedCodexMcpToolDescriptor,
    codexMcpToolArgumentValidation,
    isCodexProtoTransport,
  } = state
  const {
    onSetCodexMcpServerName,
    onSetCodexMcpResourceUri,
    onSetCodexMcpToolName,
    onSetCodexMcpToolArguments,
    onSetCodexMcpDescriptorFilter,
    onSetCapError,
    onRunCodexMcpAction,
    onMcpOauthLogin,
  } = actions

  const [showAdvancedToolArguments, setShowAdvancedToolArguments] =
    useState(false)

  const simpleArgumentFields = useMemo(
    () => getSimpleArgumentFields(selectedCodexMcpToolDescriptor?.inputSchema),
    [selectedCodexMcpToolDescriptor?.inputSchema]
  )

  const hasSimpleArgumentFields = simpleArgumentFields.length > 0

  const currentArgumentObject = useMemo(
    () => parseArgumentObject(codexMcpToolArguments),
    [codexMcpToolArguments]
  )

  const updateArgumentField = (field: McpArgumentField, rawValue: string) => {
    let nextArguments = { ...currentArgumentObject }
    if (rawValue === '' && !field.required) {
      nextArguments = setNestedArgumentValue(
        nextArguments,
        field.keyPath,
        undefined,
        true
      )
    } else if (field.type === 'boolean') {
      nextArguments = setNestedArgumentValue(
        nextArguments,
        field.keyPath,
        rawValue === 'true'
      )
    } else if (field.type === 'number' || field.type === 'integer') {
      const parsedNumber = Number(rawValue)
      nextArguments = setNestedArgumentValue(
        nextArguments,
        field.keyPath,
        Number.isFinite(parsedNumber)
          ? field.type === 'integer'
            ? Math.trunc(parsedNumber)
            : parsedNumber
          : rawValue
      )
    } else {
      nextArguments = setNestedArgumentValue(
        nextArguments,
        field.keyPath,
        rawValue
      )
    }
    onSetCodexMcpToolArguments(stringifyArgumentObject(nextArguments))
  }

  const handleReadResource = () => {
    void onRunCodexMcpAction(
      'mcpServer/resource/read',
      {
        server: codexMcpServerName.trim(),
        uri: codexMcpResourceUri.trim(),
      },
      'Codex MCP resource read'
    )
  }

  const handleReloadConfig = () => {
    void onRunCodexMcpAction(
      'config/mcpServer/reload',
      {},
      'Codex MCP config reloaded'
    )
  }

  const handleCallTool = () => {
    const parsed = parseCodexJson<unknown>(codexMcpToolArguments || '{}', {})
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      onSetCapError('MCP tool arguments must be a JSON object.')
      return
    }
    void onRunCodexMcpAction(
      'mcpServer/tool/call',
      {
        server: codexMcpServerName.trim(),
        toolName: codexMcpToolName.trim(),
        arguments: parsed as Record<string, unknown>,
      },
      'Codex MCP tool called'
    )
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-0.5 flex items-center justify-between gap-2">
        <span>MCP server status</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps}
          onClick={() => {
            void onMcpOauthLogin()
          }}
        >
          MCP OAuth login
        </button>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-3">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="MCP server"
          value={codexMcpServerName}
          onChange={(event) => onSetCodexMcpServerName(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Resource URI"
          value={codexMcpResourceUri}
          onChange={(event) => onSetCodexMcpResourceUri(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Tool name"
          value={codexMcpToolName}
          onChange={(event) => onSetCodexMcpToolName(event.target.value)}
        />
      </div>
      <textarea
        className={cn(
          'mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]',
          hasSimpleArgumentFields && !showAdvancedToolArguments && 'hidden'
        )}
        placeholder="MCP tool arguments JSON"
        value={codexMcpToolArguments}
        onChange={(event) => onSetCodexMcpToolArguments(event.target.value)}
      />
      {hasSimpleArgumentFields ? (
        <div className="mb-1 rounded border bg-background/40 p-1">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
            <span>Tool arguments</span>
            <button
              type="button"
              className="underline"
              onClick={() =>
                setShowAdvancedToolArguments((current) => !current)
              }
            >
              {showAdvancedToolArguments ? 'Hide JSON' : 'Advanced JSON'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {simpleArgumentFields.map((field) => {
              const value = getNestedArgumentValue(
                currentArgumentObject,
                field.keyPath
              )
              const stringValue =
                typeof value === 'boolean'
                  ? String(value)
                  : value === undefined || value === null
                    ? ''
                    : String(value)
              return (
                <label
                  key={field.key}
                  className="grid gap-0.5 text-[9px] text-muted-foreground"
                  title={field.description}
                >
                  <span>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  {field.type === 'boolean' ? (
                    <select
                      className="h-6 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                      value={stringValue || 'false'}
                      onChange={(event) =>
                        updateArgumentField(field, event.target.value)
                      }
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : field.enumValues?.length ? (
                    <select
                      className="h-6 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                      value={stringValue}
                      onChange={(event) =>
                        updateArgumentField(field, event.target.value)
                      }
                    >
                      {!field.required ? <option value="">—</option> : null}
                      {field.enumValues.map((enumValue) => (
                        <option key={enumValue} value={enumValue}>
                          {enumValue}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="h-6 px-2 text-[10px] text-foreground"
                      type={
                        field.type === 'number' || field.type === 'integer'
                          ? 'number'
                          : 'text'
                      }
                      step={field.type === 'integer' ? 1 : undefined}
                      value={stringValue}
                      onChange={(event) =>
                        updateArgumentField(field, event.target.value)
                      }
                    />
                  )}
                </label>
              )
            })}
          </div>
          {showAdvancedToolArguments ? (
            <div className="mt-1 text-[9px] text-muted-foreground">
              Advanced JSON remains authoritative for nested or unsupported
              schema fields.
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedCodexMcpToolDescriptor?.inputSchema ? (
        <div
          className={cn(
            'mb-1 rounded border px-2 py-1 text-[9px]',
            codexMcpToolArgumentValidation.length
              ? 'border-destructive/40 bg-destructive/5 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          )}
        >
          {codexMcpToolArgumentValidation.length
            ? codexMcpToolArgumentValidation.slice(0, 4).join('; ')
            : 'Tool arguments match the selected tool schema.'}
        </div>
      ) : null}
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            mcpBusy ||
            !codexMcpServerName.trim() ||
            !codexMcpResourceUri.trim()
          }
          onClick={handleReadResource}
        >
          Read resource
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || mcpBusy || !!isCodexProtoTransport}
          onClick={handleReloadConfig}
        >
          Reload config
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            mcpBusy ||
            !codexMcpServerName.trim() ||
            !codexMcpToolName.trim() ||
            codexMcpToolArgumentValidation.length > 0
          }
          onClick={handleCallTool}
        >
          Call tool
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words max-h-20 overflow-auto">
        {mcpStatus ? JSON.stringify(mcpStatus, null, 2) : '— (refresh to load)'}
      </pre>
      {selectableCodexMcpServerNames.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexMcpServerNames.map((serverName) => (
            <button
              key={serverName}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexMcpServerName.trim() === serverName && 'bg-accent'
              )}
              title={serverName}
              onClick={() => onSetCodexMcpServerName(serverName)}
            >
              {serverName}
            </button>
          ))}
        </div>
      ) : null}
      {selectableCodexMcpResourceUris.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexMcpResourceUris.map((resourceUri) => (
            <button
              key={resourceUri}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexMcpResourceUri.trim() === resourceUri && 'bg-accent'
              )}
              title={resourceUri}
              onClick={() => onSetCodexMcpResourceUri(resourceUri)}
            >
              resource:{resourceUri}
            </button>
          ))}
        </div>
      ) : null}
      {selectableCodexMcpToolNames.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexMcpToolNames.map((toolName) => (
            <button
              key={toolName}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexMcpToolName.trim() === toolName && 'bg-accent'
              )}
              title={toolName}
              onClick={() => onSetCodexMcpToolName(toolName)}
            >
              tool:{toolName}
            </button>
          ))}
        </div>
      ) : null}
      {codexMcpResourceDescriptors.length || codexMcpToolDescriptors.length ? (
        <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              className="h-6 px-2 text-[10px]"
              placeholder="Search MCP resources / tools"
              value={codexMcpDescriptorFilter}
              onChange={(event) =>
                onSetCodexMcpDescriptorFilter(event.target.value)
              }
            />
          </div>
          <div className="rounded border bg-background/40 p-1">
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
              <span>MCP resources</span>
              <span className="text-muted-foreground">
                {filteredCodexMcpResourceDescriptors.length}/
                {codexMcpResourceDescriptors.length}
              </span>
            </div>
            {filteredCodexMcpResourceDescriptors.length ? (
              <div className="max-h-28 space-y-1 overflow-auto">
                {filteredCodexMcpResourceDescriptors.map((descriptor) => (
                  <button
                    key={descriptor.uri}
                    type="button"
                    className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
                    title={descriptor.description ?? descriptor.uri}
                    onClick={() => onSetCodexMcpResourceUri(descriptor.uri)}
                  >
                    <div className="truncate font-mono text-[9px]">
                      {descriptor.name ?? descriptor.uri}
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {descriptor.mimeType ? `${descriptor.mimeType} · ` : ''}
                      {descriptor.uri}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-muted-foreground">
                No matching resource descriptors.
              </div>
            )}
          </div>
          <div className="rounded border bg-background/40 p-1">
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
              <span>MCP tools</span>
              <span className="text-muted-foreground">
                {filteredCodexMcpToolDescriptors.length}/
                {codexMcpToolDescriptors.length}
              </span>
            </div>
            {filteredCodexMcpToolDescriptors.length ? (
              <div className="max-h-28 space-y-1 overflow-auto">
                {filteredCodexMcpToolDescriptors.map((descriptor) => (
                  <button
                    key={descriptor.name}
                    type="button"
                    className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
                    title={descriptor.description ?? descriptor.name}
                    onClick={() => {
                      onSetCodexMcpToolName(descriptor.name)
                      onSetCodexMcpToolArguments(
                        JSON.stringify(
                          buildJsonTemplateFromSchema(descriptor.inputSchema),
                          null,
                          2
                        )
                      )
                    }}
                  >
                    <div className="truncate font-mono text-[9px]">
                      {descriptor.name}
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {descriptor.description ??
                        (descriptor.inputSchema ? 'schema available' : 'no schema')}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-muted-foreground">
                No matching tool descriptors.
              </div>
            )}
          </div>
        </div>
      ) : null}
      <pre className="mt-1 whitespace-pre-wrap break-words max-h-24 overflow-auto">
        {codexMcpSnapshot
          ? JSON.stringify(codexMcpSnapshot, null, 2)
          : '— (MCP resource/tool results)'}
      </pre>
    </div>
  )
}
