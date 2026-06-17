import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'

type AccountPanelState = {
  accountBusy: boolean
  currentThreadIdForCaps: string | null | undefined
  accountCreditsNudgeType: string
  accountInfo: unknown
  accountRateLimits: unknown
  accountUsage: unknown
  accountLogin: unknown
  accountRequiresAuth: unknown
  accountType: unknown
  accountEmail: unknown
  accountPlan: unknown
  isCodexProtoTransport?: boolean
}

type AccountPanelActions = {
  onSetAccountCreditsNudgeType: (value: string) => void
  onSetCapError: (message: string | null) => void
  onSetAccountBusy: (busy: boolean) => void
  onRefreshCodexAccount: (refreshToken?: boolean) => Promise<void> | void
  onStartDeviceCodeLogin: (
    params?: Record<string, unknown>
  ) => Promise<void> | void
  onCancelDeviceCodeLogin: () => Promise<void> | void
  onLogoutCodex: () => Promise<void> | void
  onReadCodexAccountRateLimits: (janThreadId: string) => Promise<unknown>
  onReadCodexAccountUsage: (janThreadId: string, params?: Record<string, unknown>) => Promise<unknown>
  onSendCodexAddCreditsNudgeEmail: (janThreadId: string, creditType: 'credits' | 'usage_limit') => Promise<unknown>
  onSetAccountRateLimits: (value: unknown) => void
  onSetAccountUsage: (value: unknown) => void
}

type AccountPanelProps = {
  state: AccountPanelState
  actions: AccountPanelActions
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export function AccountPanel({
  state,
  actions,
}: AccountPanelProps) {
  const {
    accountBusy,
    currentThreadIdForCaps,
    accountCreditsNudgeType,
    accountInfo,
    accountRateLimits,
    accountUsage,
    accountLogin,
    accountRequiresAuth,
    isCodexProtoTransport,
  } = state
  const {
    onSetAccountCreditsNudgeType,
    onSetCapError,
    onSetAccountBusy,
    onRefreshCodexAccount,
    onStartDeviceCodeLogin,
    onCancelDeviceCodeLogin,
    onLogoutCodex,
    onReadCodexAccountRateLimits,
    onReadCodexAccountUsage,
    onSendCodexAddCreditsNudgeEmail,
    onSetAccountRateLimits,
    onSetAccountUsage,
  } = actions

  const [showAdvancedLoginParams, setShowAdvancedLoginParams] = useState(false)
  const [showAdvancedUsageParams, setShowAdvancedUsageParams] = useState(false)
  const [accountLoginParamsJson, setAccountLoginParamsJson] =
    useState('{"type":"chatgptDeviceCode"}')
  const [accountUsageParamsJson, setAccountUsageParamsJson] =
    useState('{}')

  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  const parsedLoginParams = parseCodexJson<Record<string, unknown>>(
    accountLoginParamsJson,
    {}
  )
  const parsedUsageParams = parseCodexJson<Record<string, unknown>>(
    accountUsageParamsJson,
    {}
  )
  const parsedLoginType =
    typeof parsedLoginParams.type === 'string'
      ? parsedLoginParams.type
      : 'chatgptDeviceCode'
  const parsedRangeDays =
    typeof parsedUsageParams.rangeDays === 'number'
      ? String(parsedUsageParams.rangeDays)
      : parsedUsageParams.rangeDays === 0
        ? '0'
        : ''

  const onSetLoginType = (nextType: string) => {
    const nextParams = {
      ...parsedLoginParams,
      type: nextType || 'chatgptDeviceCode',
    }
    setAccountLoginParamsJson(
      stringifyCodexJson(nextParams, accountLoginParamsJson)
    )
  }

  const onSetUsageRangeDays = (rawRangeDays: string) => {
    const nextParams = { ...parsedUsageParams }
    if (rawRangeDays.trim()) {
      const parsedRangeDays = Number.parseInt(rawRangeDays, 10)
      if (!Number.isNaN(parsedRangeDays)) {
        nextParams.rangeDays = parsedRangeDays
      } else {
        delete nextParams.rangeDays
      }
    } else {
      delete nextParams.rangeDays
    }
    setAccountUsageParamsJson(
      stringifyCodexJson(nextParams, accountUsageParamsJson)
    )
  }

  const accountInfoRecord = asRecord(accountInfo)
  const accountRecord = asRecord(accountInfoRecord?.account)
  const accountLoginRecord = asRecord(accountLogin)
  const resolvedAccountType =
    getString(accountRecord?.type) ??
    getString(accountInfoRecord?.authMode) ??
    'none'
  const resolvedAccountEmail =
    getString(accountRecord?.email) ?? getString(accountInfoRecord?.email)
  const resolvedAccountPlan =
    getString(accountRecord?.planType) ?? getString(accountInfoRecord?.planType)
  const resolvedRequiresAuth =
    accountInfoRecord && 'requiresOpenaiAuth' in accountInfoRecord
      ? accountInfoRecord.requiresOpenaiAuth
      : accountRequiresAuth
  const loginId = getString(accountLoginRecord?.loginId)
  const verificationUrl = getString(accountLoginRecord?.verificationUrl)
  const userCode = getString(accountLoginRecord?.userCode)

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Account</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={!currentThreadIdForCaps || accountBusy || !!isCodexProtoTransport}
            onClick={() => void onRefreshCodexAccount(true)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={!currentThreadIdForCaps || accountBusy || !!isCodexProtoTransport}
            onClick={() => void onStartDeviceCodeLogin(parsedLoginParams)}
          >
            Login
          </button>
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={!currentThreadIdForCaps || accountBusy || !loginId || !!isCodexProtoTransport}
            onClick={() => void onCancelDeviceCodeLogin()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-[9px] underline disabled:opacity-50"
            disabled={!currentThreadIdForCaps || accountBusy || !!isCodexProtoTransport}
            onClick={() => void onLogoutCodex()}
          >
            Logout
          </button>
        </div>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        {showAdvancedLoginParams ? (
          <textarea
            className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
            placeholder="Account login params JSON"
            value={accountLoginParamsJson}
            onChange={(event) =>
              setAccountLoginParamsJson(event.target.value)
            }
          />
        ) : (
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Account login type"
            value={parsedLoginType}
            onChange={(event) => onSetLoginType(event.target.value)}
          />
        )}
        {showAdvancedUsageParams ? (
          <textarea
            className="min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
            placeholder="Account usage params JSON"
            value={accountUsageParamsJson}
            onChange={(event) =>
              setAccountUsageParamsJson(event.target.value)
            }
          />
        ) : (
          <Input
            className="h-6 px-2 text-[10px]"
            placeholder="Usage range days"
            value={parsedRangeDays}
            onChange={(event) => onSetUsageRangeDays(event.target.value)}
          />
        )}
      </div>
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={accountBusy || !!isCodexProtoTransport}
          onClick={() =>
            setShowAdvancedLoginParams((previous) => !previous)
          }
        >
          {showAdvancedLoginParams ? 'Use structured login' : 'Advanced login JSON'}
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={accountBusy || !!isCodexProtoTransport}
          onClick={() =>
            setShowAdvancedUsageParams((previous) => !previous)
          }
        >
          {showAdvancedUsageParams ? 'Use structured usage' : 'Advanced usage JSON'}
        </button>
      </div>
      <select
        className="mb-1 h-6 rounded border border-border bg-background px-2 text-[10px] text-foreground"
        value={
          accountCreditsNudgeType === 'credits' ||
          accountCreditsNudgeType === 'usage_limit'
            ? accountCreditsNudgeType
            : 'usage_limit'
        }
        onChange={(event) => onSetAccountCreditsNudgeType(event.target.value)}
      >
        <option value="usage_limit">usage limit nudge</option>
        <option value="credits">credits nudge</option>
      </select>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
        <span className="text-muted-foreground">Required</span>
        <span>{String(resolvedRequiresAuth ?? 'unknown')}</span>
        <span className="text-muted-foreground">Mode</span>
        <span>{String(resolvedAccountType)}</span>
        <span className="text-muted-foreground">Email</span>
        <span className="truncate">{resolvedAccountEmail ?? '—'}</span>
        <span className="text-muted-foreground">Plan</span>
        <span>{resolvedAccountPlan ?? '—'}</span>
      </div>
      {verificationUrl || userCode ? (
        <div className="mt-1 rounded border border-border/60 p-1">
          <div className="truncate" title={verificationUrl}>
            {verificationUrl}
          </div>
          <div className="font-mono">{userCode ?? '—'}</div>
        </div>
      ) : null}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || accountBusy || !!isCodexProtoTransport}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            onSetAccountBusy(true)
            onSetCapError(null)
            try {
              const params = parseCodexJson<unknown>(
                accountUsageParamsJson,
                null
              )
              if (!isPlainObject(params)) {
                throw new Error('Account usage params must be a JSON object.')
              }
              const [rateLimitSnapshot, usageSnapshot] =
              await Promise.all([
                onReadCodexAccountRateLimits(currentThreadIdForCaps).catch(
                  (e) => ({ error: String(e) })
                ),
                onReadCodexAccountUsage(currentThreadIdForCaps, params).catch((e) => ({
                  error: String(e),
                })),
              ])
              onSetAccountRateLimits(rateLimitSnapshot)
              onSetAccountUsage(usageSnapshot)
            } catch (e) {
              onSetCapError('Read limits/usage failed: ' + String(e))
            } finally {
              onSetAccountBusy(false)
            }
          }}
        >
          Read limits/usage
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || accountBusy || !!isCodexProtoTransport}
          onClick={async () => {
            if (!currentThreadIdForCaps) return
            try {
              const normalizedCreditType: 'credits' | 'usage_limit' =
                accountCreditsNudgeType === 'credits'
                  ? 'credits'
                  : 'usage_limit'
              await onSendCodexAddCreditsNudgeEmail(
                currentThreadIdForCaps,
                normalizedCreditType
              )
              if (accountCreditsNudgeType.trim() && accountCreditsNudgeType.trim() !== normalizedCreditType) {
                onSetCapError(
                  `Invalid credits nudge type "${accountCreditsNudgeType}". Using "${normalizedCreditType}".`
                )
              }
              toast.success('Credits nudge sent')
            } catch (e) {
              onSetCapError('Credits nudge failed: ' + String(e))
            }
          }}
        >
          Credits nudge
        </button>
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words max-h-24 overflow-auto">
        {accountRateLimits || accountUsage
          ? JSON.stringify(
              { rateLimits: accountRateLimits, usage: accountUsage },
              null,
              2
            )
          : '— (refresh to load)'}
      </pre>
    </div>
  )
}
