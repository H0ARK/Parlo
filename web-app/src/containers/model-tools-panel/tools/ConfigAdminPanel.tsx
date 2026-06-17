import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

type ConfigAdminPanelState = {
  adminBusy: boolean
  currentThreadIdForCaps: string | null | undefined
  codexConfigKeyPath: string
  codexAdminSnapshot: unknown
  cwd: string
}

type ConfigAdminPanelActions = {
  onSetCodexConfigKeyPath: (value: string) => void
  onSetCapError: (message: string | null) => void
  onSetAdminBusy: (busy: boolean) => void
  onRefreshCodexAdminSnapshot: () => Promise<void> | void
  onWriteCodexConfigValue: (janThreadId: string, keyPath: string[], value: unknown) => Promise<unknown>
  onWriteCodexConfigBatch: (janThreadId: string, params: Record<string, unknown>) => Promise<unknown>
  onUploadCodexFeedback: (janThreadId: string, params: Record<string, unknown>) => Promise<unknown>
  onStartCodexWindowsSandbox: (janThreadId: string, params: Record<string, unknown>) => Promise<unknown>
  onImportCodexExternalAgentConfig: (janThreadId: string, params: Record<string, unknown>) => Promise<unknown>
  onSetCodexAdminSnapshot: (updater: (prev: unknown) => unknown) => void
}

type ConfigAdminPanelProps = {
  state: ConfigAdminPanelState
  actions: ConfigAdminPanelActions
}

export function ConfigAdminPanel({
  state,
  actions,
}: ConfigAdminPanelProps) {
  const {
    adminBusy,
    currentThreadIdForCaps,
    codexConfigKeyPath,
    codexAdminSnapshot,
    cwd,
  } = state

  const {
    onSetCodexConfigKeyPath,
    onSetCapError,
    onSetAdminBusy,
    onRefreshCodexAdminSnapshot,
    onWriteCodexConfigValue,
    onWriteCodexConfigBatch,
    onUploadCodexFeedback,
    onStartCodexWindowsSandbox,
    onImportCodexExternalAgentConfig,
    onSetCodexAdminSnapshot,
  } = actions

  const [showAdvancedConfigValueJson, setShowAdvancedConfigValueJson] =
    useState(false)
  const [showAdvancedConfigBatchJson, setShowAdvancedConfigBatchJson] =
    useState(false)
  const [showAdvancedWindowsJson, setShowAdvancedWindowsJson] = useState(false)
  const [showAdvancedExternalImportJson, setShowAdvancedExternalImportJson] =
    useState(false)
  const [codexConfigValueJson, setCodexConfigValueJson] = useState('"gpt-5"')
  const [codexConfigBatchJson, setCodexConfigBatchJson] =
    useState('{"edits":[]}')
  const [codexWindowsSandboxJson, setCodexWindowsSandboxJson] = useState('{}')
  const [codexExternalAgentImportJson, setCodexExternalAgentImportJson] =
    useState('{"cwd":""}')
  const [batchKeyPath, setBatchKeyPath] = useState('')
  const [batchValue, setBatchValue] = useState('')

  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  const parsedWindowsSandbox = parseCodexJson<Record<string, unknown>>(
    codexWindowsSandboxJson,
    {}
  )
  const parsedExternalAgentImport = parseCodexJson<Record<string, unknown>>(
    codexExternalAgentImportJson,
    {}
  )
  const parsedConfigValue = parseCodexJson<string | number | boolean>(codexConfigValueJson, '')
  const parsedConfigBatch = parseCodexJson<Record<string, unknown>>(
    codexConfigBatchJson,
    { edits: [] }
  )
  const windowsSandboxMode = typeof parsedWindowsSandbox.mode === 'string'
    ? parsedWindowsSandbox.mode
    : ''
  const windowsSandboxCwd = typeof parsedWindowsSandbox.cwd === 'string'
    ? parsedWindowsSandbox.cwd
    : ''
  const externalMigrationItems = Array.isArray(parsedExternalAgentImport.migrationItems)
    ? parsedExternalAgentImport.migrationItems
        .filter((item) => typeof item === 'string')
        .join('\n')
    : ''
  const externalImportSource = typeof parsedExternalAgentImport.source === 'string'
    ? parsedExternalAgentImport.source
    : ''
  const externalImportAgent = typeof parsedExternalAgentImport.agent === 'string'
    ? parsedExternalAgentImport.agent
    : ''
  const externalImportDryRun = parsedExternalAgentImport.dryRun === true
  const externalImportOverwrite = parsedExternalAgentImport.overwrite === true

  const onSetWindowsSandboxField = (next: {
    mode?: string
    cwd?: string
  }) => {
    const payload = {
      ...parsedWindowsSandbox,
      ...next,
    }
    setCodexWindowsSandboxJson(
      stringifyCodexJson(payload, codexWindowsSandboxJson)
    )
  }

  const onSetMigrationItems = (value: string) => {
    const migrationItems = value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    setCodexExternalAgentImportJson(
      stringifyCodexJson(
        {
          ...parsedExternalAgentImport,
          migrationItems,
        },
        codexExternalAgentImportJson
      )
    )
  }

  const onSetExternalAgentImportField = (
    key: 'source' | 'agent',
    value: string
  ) => {
    const trimmed = value.trim()
    const nextPayload = {
      ...parsedExternalAgentImport,
      [key]: trimmed || undefined,
    }
    if (!trimmed) delete nextPayload[key]
    setCodexExternalAgentImportJson(
      stringifyCodexJson(nextPayload, codexExternalAgentImportJson)
    )
  }

  const onSetExternalAgentImportFlag = (
    key: 'dryRun' | 'overwrite',
    checked: boolean
  ) => {
    const nextPayload = {
      ...parsedExternalAgentImport,
      [key]: checked || undefined,
    }
    if (!checked) delete nextPayload[key]
    setCodexExternalAgentImportJson(
      stringifyCodexJson(nextPayload, codexExternalAgentImportJson)
    )
  }

  const singleConfigValue = typeof parsedConfigValue === 'string'
    ? parsedConfigValue
    : parsedConfigValue === true
      ? 'true'
      : parsedConfigValue === false
        ? 'false'
        : typeof parsedConfigValue === 'number'
          ? String(parsedConfigValue)
          : parsedConfigValue === null
            ? 'null'
            : ''

  const onSetConfigValue = (value: string) => {
    setCodexConfigValueJson(stringifyCodexJson(value, codexConfigValueJson))
  }

  const parseSimpleValue = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return parseCodexJson<unknown>(trimmed, value)
  }

  const appendBatchEdit = (nextPath: string, nextValue: string) => {
    const keyPath = nextPath.trim()
    if (!keyPath) return
    const edits = Array.isArray(parsedConfigBatch.edits)
      ? parsedConfigBatch.edits
          .filter(
            (item) =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item)
          )
          .slice(0, 8)
      : []
    const nextPayload = {
      ...parsedConfigBatch,
      edits: [
        ...edits,
        {
          keyPath,
          value: parseSimpleValue(nextValue),
        },
      ],
    }
    setCodexConfigBatchJson(stringifyCodexJson(nextPayload, codexConfigBatchJson))
    setBatchKeyPath('')
    setBatchValue('')
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Config / Admin</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={() => void onRefreshCodexAdminSnapshot()}
        >
          {adminBusy ? 'Loading' : 'Refresh'}
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Reads live app-server config, config requirements, permission
        profiles, collaboration modes, and external-agent import candidates
        for the current workspace. High-use config paths use structured fields
        with advanced JSON escape; raw RPC escape hatch is in the Raw app-server
        RPC panel for uncommon methods.
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Config key path, dot-separated"
          value={codexConfigKeyPath}
          onChange={(event) => onSetCodexConfigKeyPath(event.target.value)}
        />
        {showAdvancedConfigValueJson ? (
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Config value JSON"
            value={codexConfigValueJson}
            onChange={(event) =>
              setCodexConfigValueJson(event.target.value)
            }
          />
        ) : (
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Config value"
            value={singleConfigValue}
            onChange={(event) => onSetConfigValue(event.target.value)}
          />
        )}
      </div>
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={adminBusy}
          onClick={() =>
            setShowAdvancedConfigValueJson((previous) => !previous)
          }
        >
          {showAdvancedConfigValueJson ? 'Use simple config value' : 'Advanced JSON'}
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={adminBusy}
          onClick={() =>
            setShowAdvancedConfigBatchJson((previous) => !previous)
          }
        >
          {showAdvancedConfigBatchJson ? 'Use simple batch' : 'Advanced batch JSON'}
        </button>
      </div>
      {showAdvancedConfigBatchJson ? (
        <textarea
          className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="Config batch write JSON"
          value={codexConfigBatchJson}
          onChange={(event) =>
            setCodexConfigBatchJson(event.target.value)
          }
        />
      ) : (
        <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-[1fr_1fr_auto_auto]">
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Batch key path"
            value={batchKeyPath}
            onChange={(event) => setBatchKeyPath(event.target.value)}
          />
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Batch value"
            value={batchValue}
            onChange={(event) => setBatchValue(event.target.value)}
          />
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={adminBusy || !batchKeyPath.trim()}
            onClick={() => appendBatchEdit(batchKeyPath, batchValue)}
          >
            add batch edit
          </button>
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={adminBusy || !codexConfigKeyPath.trim()}
            onClick={() => {
              setBatchKeyPath(codexConfigKeyPath)
              setBatchValue(singleConfigValue)
            }}
          >
            seed from config
          </button>
          <div className="text-[9px] text-muted-foreground md:col-span-4">
            Batch edits:{' '}
            {Array.isArray(parsedConfigBatch.edits)
              ? parsedConfigBatch.edits.length
              : 0}
          </div>
        </div>
      )}
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        <div>
          <div className="mb-1 flex gap-2">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={adminBusy}
              onClick={() =>
                setShowAdvancedWindowsJson((previous) => !previous)
              }
            >
              {showAdvancedWindowsJson
                ? 'Use simple sandbox fields'
                : 'Advanced sandbox JSON'}
            </button>
          </div>
          {showAdvancedWindowsJson ? (
            <textarea
              className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="Windows sandbox setup params JSON"
              value={codexWindowsSandboxJson}
              onChange={(event) =>
                setCodexWindowsSandboxJson(event.target.value)
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-1">
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="Windows mode"
                value={windowsSandboxMode}
                onChange={(event) =>
                  onSetWindowsSandboxField({
                    mode: event.target.value,
                  })
                }
              />
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="cwd"
                value={windowsSandboxCwd}
                onChange={(event) =>
                  onSetWindowsSandboxField({
                    cwd: event.target.value,
                  })
                }
              />
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 flex gap-2">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={adminBusy}
              onClick={() =>
                setShowAdvancedExternalImportJson((previous) => !previous)
              }
            >
              {showAdvancedExternalImportJson
                ? 'Use simple import fields'
                : 'Advanced import JSON'}
            </button>
          </div>
          {showAdvancedExternalImportJson ? (
            <textarea
              className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="External agent import params JSON"
              value={codexExternalAgentImportJson}
              onChange={(event) =>
                setCodexExternalAgentImportJson(event.target.value)
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-1">
              <div className="grid grid-cols-2 gap-1">
                <Input
                  className="h-6 px-2 text-[10px]"
                  placeholder="Import source"
                  value={externalImportSource}
                  onChange={(event) =>
                    onSetExternalAgentImportField('source', event.target.value)
                  }
                />
                <Input
                  className="h-6 px-2 text-[10px]"
                  placeholder="Agent/profile"
                  value={externalImportAgent}
                  onChange={(event) =>
                    onSetExternalAgentImportField('agent', event.target.value)
                  }
                />
              </div>
              <div className="flex flex-wrap gap-3 text-[9px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={externalImportDryRun}
                    onChange={(event) =>
                      onSetExternalAgentImportFlag('dryRun', event.target.checked)
                    }
                  />
                  dry run
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={externalImportOverwrite}
                    onChange={(event) =>
                      onSetExternalAgentImportFlag(
                        'overwrite',
                        event.target.checked
                      )
                    }
                  />
                  overwrite
                </label>
              </div>
              <textarea
                className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 text-[10px]"
                placeholder="External migration items (one per line)"
                value={externalMigrationItems}
                onChange={(event) => onSetMigrationItems(event.target.value)}
              />
            </div>
          )}
        </div>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            const keyPath = codexConfigKeyPath.trim()
            if (!keyPath) return
            onSetAdminBusy(true)
            onSetCapError(null)
            try {
              const valueText = codexConfigValueJson.trim()
              const value = parseCodexJson<unknown>(valueText, null)
              if (value === null && valueText !== 'null') {
                throw new Error('Config value must be valid JSON or a plain value.')
              }
              await onWriteCodexConfigValue(
                currentThreadIdForCaps,
                keyPath.split('.').map((part) => part.trim()).filter(Boolean),
                value
              )
              await onRefreshCodexAdminSnapshot()
              toast.success('Codex config value written')
            } catch (e) {
              onSetCapError('Config write failed: ' + String(e))
            } finally {
              onSetAdminBusy(false)
            }
          }}
        >
          Write config value
        </button>
        <button 
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            onSetAdminBusy(true)
            onSetCapError(null)
            try {
              const params = parseCodexJson<unknown>(codexConfigBatchJson, null)
              if (!isPlainObject(params)) {
                throw new Error('Config batch payload must be a JSON object.')
              }
              const result = await onWriteCodexConfigBatch(
                currentThreadIdForCaps,
                params
              )
              onSetCodexAdminSnapshot((previous: unknown) => ({
                ...(previous ?? {}),
                batchWrite: result,
              }))
              await onRefreshCodexAdminSnapshot()
              toast.success('Codex config batch written')
            } catch (e) {
              onSetCapError('Config batch write failed: ' + String(e))
            } finally {
              onSetAdminBusy(false)
            }
          }}
        >
          Batch config
        </button>
        <button 
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            onSetAdminBusy(true)
            onSetCapError(null)
            try {
              const result = await onUploadCodexFeedback(
                currentThreadIdForCaps,
                { cwd }
              )
              onSetCodexAdminSnapshot((previous: unknown) => ({
                ...(previous ?? {}),
                feedbackUpload: result,
              }))
              toast.success('Codex feedback upload requested')
            } catch (e) {
              onSetCapError('Feedback upload failed: ' + String(e))
            } finally {
              onSetAdminBusy(false)
            }
          }}
        >
          Upload feedback
        </button>
        <button 
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            onSetAdminBusy(true)
            onSetCapError(null)
            try {
              const params = parseCodexJson<unknown>(codexWindowsSandboxJson, null)
              if (!isPlainObject(params)) {
                throw new Error('Windows sandbox setup payload must be a JSON object.')
              }
              const result = await onStartCodexWindowsSandbox(currentThreadIdForCaps, params)
              onSetCodexAdminSnapshot((previous: unknown) => ({
                ...(previous ?? {}),
                windowsSandboxSetup: result,
              }))
              toast.success('Codex Windows sandbox setup started')
            } catch (e) {
              onSetCapError('Windows sandbox setup failed: ' + String(e))
            } finally {
              onSetAdminBusy(false)
            }
          }}
        >
          Windows sandbox
        </button>
        <button 
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || adminBusy}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            onSetAdminBusy(true)
            onSetCapError(null)
            try {
              const parsedParams = parseCodexJson<unknown>(
                codexExternalAgentImportJson,
                null
              )
              if (!isPlainObject(parsedParams)) {
                throw new Error('External agent import payload must be a JSON object.')
              }
              const result = await onImportCodexExternalAgentConfig(
                currentThreadIdForCaps,
                { cwd, ...parsedParams }
              )
              onSetCodexAdminSnapshot((previous: unknown) => ({
                ...(previous ?? {}),
                externalAgentImport: result,
              }))
              toast.success('External agent config imported into Codex')
            } catch (e) {
              onSetCapError('External agent import failed: ' + String(e))
            } finally {
              onSetAdminBusy(false)
            }
          }}
        >
          Import external agent
        </button>
      </div> 
      <pre className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {codexAdminSnapshot
          ? JSON.stringify(codexAdminSnapshot, null, 2)
          : '— (refresh to load)'}
      </pre>
    </div>
  )
}
