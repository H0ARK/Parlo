import { useState } from 'react'

import { Input } from '@/components/ui/input'

import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

type RemoteControlPanelState = {
  remoteBusy: boolean
  currentThreadIdForCaps: string | null | undefined
  remotePairingCode: string
  remoteClientId: string
  remotePairingStartParamsJson: string
  remoteStatus: unknown
  remotePairing: unknown
}

type RemoteControlPanelActions = {
  onSetRemotePairingCode: (value: string) => void
  onSetRemoteClientId: (value: string) => void
  onSetRemotePairingStartParamsJson: (value: string) => void
  onRefreshRemoteControlStatus: () => Promise<void> | void
  onStartRemoteControlPairing: () => Promise<void> | void
  onReadRemoteControlPairing: (
    params?: {
      pairingCode?: string
      manualPairingCode?: string
    }
  ) => Promise<void> | void
  onRunRemoteControlAction: (
    action: () => Promise<unknown>,
    success: string
  ) => Promise<void> | void
  onEnableCodexRemoteControl: (janThreadId: string) => Promise<unknown>
  onDisableCodexRemoteControl: (janThreadId: string) => Promise<unknown>
  onListCodexRemoteControlClients: (
    janThreadId: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
  onRevokeCodexRemoteControlClient: (janThreadId: string, clientId: string) => Promise<unknown>
}

type RemoteControlPanelProps = {
  state: RemoteControlPanelState
  actions: RemoteControlPanelActions
}

export function RemoteControlPanel({
  state,
  actions,
}: RemoteControlPanelProps) {
  const {
    remoteBusy,
    currentThreadIdForCaps,
    remotePairingCode,
    remoteClientId,
    remotePairingStartParamsJson,
    remoteStatus,
    remotePairing,
  } = state
  const {
    onSetRemotePairingCode,
    onSetRemoteClientId,
    onSetRemotePairingStartParamsJson,
    onRefreshRemoteControlStatus,
    onStartRemoteControlPairing,
    onReadRemoteControlPairing,
    onRunRemoteControlAction,
    onEnableCodexRemoteControl,
    onDisableCodexRemoteControl,
    onListCodexRemoteControlClients,
    onRevokeCodexRemoteControlClient,
  } = actions

  const [showAdvancedPairingParams, setShowAdvancedPairingParams] =
    useState(false)
  const [statusPairingCode, setStatusPairingCode] = useState('')
  const [statusManualPairingCode, setStatusManualPairingCode] = useState('')

  const parsedPairingStartParams = parseCodexJson<Record<string, unknown>>(
    remotePairingStartParamsJson,
    {}
  )
  const startPairingCode = typeof parsedPairingStartParams.pairingCode === 'string'
    ? parsedPairingStartParams.pairingCode
    : ''
  const startManualPairingCode =
    typeof parsedPairingStartParams.manualPairingCode === 'string'
      ? parsedPairingStartParams.manualPairingCode
      : ''
  const startEnvironmentId =
    typeof parsedPairingStartParams.environmentId === 'string'
      ? parsedPairingStartParams.environmentId
      : ''

  const setPairingParam = (field: string, value: string) => {
    const nextParams = { ...parsedPairingStartParams }
    if (value.trim()) {
      nextParams[field] = value.trim()
    } else {
      delete nextParams[field]
    }

    onSetRemotePairingStartParamsJson(
      stringifyCodexJson(nextParams, remotePairingStartParamsJson)
    )
  }

  const readPairingStatus = () => {
    const pairingCode = statusPairingCode.trim() || remotePairingCode.trim()
    const manualPairingCode = statusManualPairingCode.trim()
    if (!pairingCode && !manualPairingCode) return
    void onReadRemoteControlPairing({
      pairingCode: pairingCode || undefined,
      manualPairingCode: manualPairingCode || undefined,
    })
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Remote Control</span>
        <div className="flex items-center gap-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() => void onRefreshRemoteControlStatus()}
        >
          Status
          </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() =>
            void onRunRemoteControlAction(
              () => onEnableCodexRemoteControl(currentThreadIdForCaps!),
                'Remote control enabled'
              )
            }
          >
            Enable
          </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() =>
            void onRunRemoteControlAction(
              () => onDisableCodexRemoteControl(currentThreadIdForCaps!),
                'Remote control disabled'
              )
            }
          >
            Disable
          </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() =>
            void onRunRemoteControlAction(
              () =>
                  onListCodexRemoteControlClients(currentThreadIdForCaps!, {}),
                'Remote clients loaded'
              )
            }
          >
            Clients
          </button>
        </div>
      </div>
      <div className="mb-1 flex gap-1">
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Pairing code"
          value={remotePairingCode}
          onChange={(event) => onSetRemotePairingCode(event.target.value)}
        />
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Client id"
          value={remoteClientId}
          onChange={(event) => onSetRemoteClientId(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() => setShowAdvancedPairingParams((previous) => !previous)}
        >
          {showAdvancedPairingParams
            ? 'Use pairing fields'
            : 'Advanced pair params JSON'}
        </button>
        {showAdvancedPairingParams ? (
          <Input
            className="h-6 min-w-0 flex-1 px-2 text-[10px] font-mono"
            placeholder="Pair params JSON"
            value={remotePairingStartParamsJson}
            onChange={(event) =>
              onSetRemotePairingStartParamsJson(event.target.value)
            }
          />
        ) : (
          <>
            <Input
              className="h-6 min-w-0 flex-1 px-2 text-[10px]"
              placeholder="Start pairing code"
              value={startPairingCode}
              onChange={(event) => {
                setPairingParam('pairingCode', event.target.value)
              }}
            />
            <Input
              className="h-6 min-w-0 flex-1 px-2 text-[10px]"
              placeholder="Manual pairing code"
              value={startManualPairingCode}
              onChange={(event) => {
                setPairingParam('manualPairingCode', event.target.value)
              }}
            />
            <Input
              className="h-6 min-w-0 flex-1 px-2 text-[10px]"
              placeholder="Environment id"
              value={startEnvironmentId}
              onChange={(event) => {
                setPairingParam('environmentId', event.target.value)
              }}
            />
          </>
        )}
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || remoteBusy}
          onClick={() => void onStartRemoteControlPairing()}
        >
          Start pairing
        </button>
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Check pairing code"
          value={statusPairingCode}
          onChange={(event) => setStatusPairingCode(event.target.value)}
        />
        <Input
          className="h-6 min-w-0 flex-1 px-2 text-[10px]"
          placeholder="Check manual pairing code"
          value={statusManualPairingCode}
          onChange={(event) => setStatusManualPairingCode(event.target.value)}
        />
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            remoteBusy ||
            (!statusPairingCode.trim() &&
              !statusManualPairingCode.trim() &&
              !remotePairingCode.trim())
          }
          onClick={() => readPairingStatus()}
        >
          Check status
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            remoteBusy ||
            !remoteClientId.trim()
          }
          onClick={() => {
            void onRunRemoteControlAction(
              () =>
                onRevokeCodexRemoteControlClient(
                  currentThreadIdForCaps!,
                  remoteClientId.trim()
                ),
              'Remote client revoked'
            )
          }}
        >
          Revoke
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words max-h-24 overflow-auto">
        {remoteStatus || remotePairing
          ? JSON.stringify(
              { status: remoteStatus, pairing: remotePairing },
              null,
              2
            )
          : '— (status/pairing not loaded)'}
      </pre>
    </div>
  )
}
