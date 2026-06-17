import { useState } from 'react'

import { Input } from '@/components/ui/input'

import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

type ModelsProvidersFeaturesPanelState = {
  modelAdminBusy: boolean
  currentThreadIdForCaps: string | null | undefined
  codexFeatureEnablementJson: string
  codexEnvironmentId: string
  codexEnvironmentExecUrl: string
  codexModelSnapshot: unknown
  isCodexProtoTransport?: boolean
}

type ModelsProvidersFeaturesPanelActions = {
  onSetCodexFeatureEnablementJson: (value: string) => void
  onSetCodexEnvironmentId: (value: string) => void
  onSetCodexEnvironmentExecUrl: (value: string) => void
  onSetCapError: (message: string | null) => void
  onRefreshCodexModelSnapshot: () => Promise<void> | void
  onRunCodexModelAction: (
    method: string,
    params: Record<string, unknown>,
    success: string
  ) => Promise<unknown | null> | void
}

type ModelsProvidersFeaturesPanelProps = {
  state: ModelsProvidersFeaturesPanelState
  actions: ModelsProvidersFeaturesPanelActions
}

export function ModelsProvidersFeaturesPanel({
  state,
  actions,
}: ModelsProvidersFeaturesPanelProps) {
  const {
    modelAdminBusy,
    currentThreadIdForCaps,
    codexFeatureEnablementJson,
    codexEnvironmentId,
    codexEnvironmentExecUrl,
    codexModelSnapshot,
    isCodexProtoTransport,
  } = state
  const {
    onSetCodexFeatureEnablementJson,
    onSetCodexEnvironmentId,
    onSetCodexEnvironmentExecUrl,
    onSetCapError,
    onRefreshCodexModelSnapshot,
    onRunCodexModelAction,
  } = actions

  const [showAdvancedFeatureJson, setShowAdvancedFeatureJson] = useState(false)
  const [featureName, setFeatureName] = useState('remoteControl')
  const [featureEnabled, setFeatureEnabled] = useState(true)

  const parsedFeaturePayload = parseCodexJson<Record<string, unknown>>(
    codexFeatureEnablementJson,
    {}
  )
  const parsedFeatureBag = (() => {
    if (
      parsedFeaturePayload.features &&
      typeof parsedFeaturePayload.features === 'object' &&
      !Array.isArray(parsedFeaturePayload.features)
    ) {
      return parsedFeaturePayload.features as Record<string, unknown>
    }
    return {}
  })()
  const parsedFeatureEnabled =
    typeof parsedFeatureBag[featureName.trim()] === 'boolean'
      ? parsedFeatureBag[featureName.trim()]
      : false

  const onSetFeatureField = (nextEnabled: boolean) => {
    const nextName = featureName.trim()
    if (!nextName) return
    const nextPayload = {
      ...parsedFeaturePayload,
      features: {
        ...parsedFeatureBag,
        [nextName]: nextEnabled,
      },
    }
    onSetCodexFeatureEnablementJson(
      stringifyCodexJson(nextPayload, codexFeatureEnablementJson)
    )
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Models / Providers / Features</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || modelAdminBusy || !!isCodexProtoTransport}
          onClick={() => void onRefreshCodexModelSnapshot()}
        >
          {modelAdminBusy ? 'Loading' : 'Refresh'}
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Reads the running Codex app-server model catalog, provider
        capabilities, and experimental feature state. Also exposes feature
        enablement and environment registration.
      </div>
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={modelAdminBusy || !!isCodexProtoTransport}
          onClick={() =>
            setShowAdvancedFeatureJson((previous) => !previous)
          }
        >
          {showAdvancedFeatureJson ? 'Use feature form' : 'Advanced feature JSON'}
        </button>
      </div>
      {showAdvancedFeatureJson ? (
        <textarea
          className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="Experimental feature enablement JSON"
          value={codexFeatureEnablementJson}
          onChange={(event) =>
            onSetCodexFeatureEnablementJson(event.target.value)
          }
        />
      ) : (
        <div className="mb-1 grid grid-cols-2 gap-1">
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Feature name"
            value={featureName}
            onChange={(event) => setFeatureName(event.target.value)}
          />
          <select
            className="h-6 rounded border border-border bg-background px-2 text-[10px] text-foreground"
            value={String(featureEnabled)}
            onChange={(event) => {
              const enabled = event.target.value === 'true'
              setFeatureEnabled(enabled)
              onSetFeatureField(enabled)
            }}
          >
            <option value="true">enabled</option>
            <option value="false">disabled</option>
          </select>
          <span className="col-span-2 text-[9px] text-muted-foreground">
            Current selected feature value:{' '}
            {String(parsedFeatureEnabled)}
          </span>
        </div>
      )}
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Environment id"
          value={codexEnvironmentId}
          onChange={(event) => onSetCodexEnvironmentId(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Exec server URL"
          value={codexEnvironmentExecUrl}
          onChange={(event) =>
            onSetCodexEnvironmentExecUrl(event.target.value)
          }
        />
      </div>
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || modelAdminBusy || !!isCodexProtoTransport}
          onClick={() => {
            const features = parsedFeaturePayload.features
            const nextFeatures =
              features &&
              typeof features === 'object' &&
              !Array.isArray(features)
                ? (features as Record<string, unknown>)
                : {}
            if (!featureName.trim()) {
              onSetCapError('Feature name is required.')
              return
            }
            void onRunCodexModelAction(
              'experimentalFeature/enablement/set',
              { features: nextFeatures },
              'Codex experimental features updated'
            )
          }}
        >
          Set features
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            modelAdminBusy ||
            !codexEnvironmentId.trim() ||
            !codexEnvironmentExecUrl.trim() ||
            !!isCodexProtoTransport
          }
          onClick={() => {
            void onRunCodexModelAction(
              'environment/add',
              {
                environmentId: codexEnvironmentId.trim(),
                execServerUrl: codexEnvironmentExecUrl.trim(),
              },
              'Codex environment added'
            )
          }}
        >
          Add environment
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {codexModelSnapshot
          ? JSON.stringify(codexModelSnapshot, null, 2)
          : '— (refresh to load)'}
      </pre>
    </div>
  )
}
