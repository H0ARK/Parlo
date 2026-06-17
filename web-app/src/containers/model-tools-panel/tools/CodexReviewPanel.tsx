import { useState } from 'react'
import { toast } from 'sonner'

import { parseCodexJson } from '../shared/codex-helpers'
import type { CodexReviewTarget } from '@/lib/codex-app-server/api'

type CodexReviewPanelProps = {
  currentThreadIdForCaps: string | null | undefined
  reviewStarting: boolean
  setReviewStarting: (value: boolean) => void
  codexAdvancedReviewJson: string
  onSetCodexAdvancedReviewJson: (value: string) => void
  onStartReview: (
    threadId: string,
    target?: CodexReviewTarget,
    options?: { userFacingHint?: string }
  ) => Promise<unknown>
}

type ReviewTargetMode = CodexReviewTarget['type']

const reviewPrompt =
  'Review the current workspace changes. Use your review/start capability with delivery=detached (or default detached) and target uncommittedChanges (or the appropriate base). Provide structured analysis, issues, risks, and suggestions ONLY — do not output or author the raw diff content itself (the host Review panel / git diff is the authoritative source). Reference specific files/paths from the real diff. Summarize for the Review tab.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCodexReviewTarget = (value: unknown): value is CodexReviewTarget => {
  if (!isRecord(value)) return false
  if (value.type === 'uncommittedChanges') return true
  if (value.type === 'baseBranch') {
    return typeof value.branch === 'string' && value.branch.trim().length > 0
  }
  if (value.type === 'commit') {
    return typeof value.sha === 'string' && value.sha.trim().length > 0
  }
  if (value.type === 'custom') {
    return (
      typeof value.instructions === 'string' &&
      value.instructions.trim().length > 0
    )
  }
  return false
}

const defaultUserFacingHint =
  'Review workspace changes and return structured findings with severity, file references, and suggested fixes only.'

export function CodexReviewPanel({
  currentThreadIdForCaps,
  reviewStarting,
  setReviewStarting,
  codexAdvancedReviewJson,
  onSetCodexAdvancedReviewJson,
  onStartReview,
}: CodexReviewPanelProps) {
  const [reviewTargetMode, setReviewTargetMode] =
    useState<ReviewTargetMode>('uncommittedChanges')
  const [baseBranch, setBaseBranch] = useState('')
  const [commitSha, setCommitSha] = useState('')
  const [commitTitle, setCommitTitle] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [userFacingHint, setUserFacingHint] = useState('')

  const parseAdvancedReviewParams = () => {
    const parsed = parseCodexJson<Record<string, unknown>>(
      codexAdvancedReviewJson || '{}',
      {}
    )
    if (!isRecord(parsed)) {
      throw new Error('Advanced review params must be a JSON object.')
    }
    return parsed
  }

  const resolveAdvancedReviewInputs = () => {
    const parsed = parseAdvancedReviewParams()
    const userFacingHintValue =
      typeof parsed.userFacingHint === 'string' &&
      parsed.userFacingHint.trim().length > 0
        ? parsed.userFacingHint.trim()
        : undefined

    const targetCandidate = isRecord(parsed.target) ? parsed.target : undefined
    const target = isCodexReviewTarget(targetCandidate)
      ? targetCandidate
      : isCodexReviewTarget(parsed)
        ? parsed
        : undefined
    if (!target) {
      throw new Error(
        'Advanced review params must include a valid target or top-level target fields.'
      )
    }

    return {
      target,
      options: userFacingHintValue ? { userFacingHint: userFacingHintValue } : {},
    }
  }

  const runAdvancedReview = async () => {
    if (!currentThreadIdForCaps) return
    setReviewStarting(true)
    try {
      const { target, options } = resolveAdvancedReviewInputs()
      await onStartReview(currentThreadIdForCaps, target, options)
      toast.success('Advanced Codex review started')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to start advanced Codex review'
      )
    } finally {
      setReviewStarting(false)
    }
  }

  const resolveReviewTarget = (): CodexReviewTarget => {
    if (reviewTargetMode === 'baseBranch') {
      const branch = baseBranch.trim()
      if (!branch) throw new Error('Base branch is required.')
      return { type: 'baseBranch', branch }
    }

    if (reviewTargetMode === 'commit') {
      const sha = commitSha.trim()
      if (!sha) throw new Error('Commit SHA is required.')
      const title = commitTitle.trim()
      return {
        type: 'commit',
        sha,
        ...(title ? { title } : {}),
      }
    }

    if (reviewTargetMode === 'custom') {
      const instructions = customInstructions.trim()
      if (!instructions) throw new Error('Custom review instructions are required.')
      return { type: 'custom', instructions }
    }

    return { type: 'uncommittedChanges' }
  }

  const runConfiguredReview = async () => {
    if (!currentThreadIdForCaps) return

    setReviewStarting(true)
    try {
      const target = resolveReviewTarget()
      const normalizedHint = userFacingHint.trim()
      await onStartReview(
        currentThreadIdForCaps,
        target,
        normalizedHint ? { userFacingHint: normalizedHint } : undefined
      )
      toast.success(
        `Codex review started (detached) for ${reviewTargetMode === 'uncommittedChanges' ? 'uncommitted changes' : reviewTargetMode}.`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to start Codex review'
      )
    } finally {
      setReviewStarting(false)
    }
  }

  const copyPromptToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(reviewPrompt)
      toast.success('Review prompt copied')
    } catch {
      // best effort
    }
  }

  return (
    <div className="p-2 border-t text-xs bg-muted/5">
      <div className="font-medium mb-1 flex items-center justify-between gap-2">
        <span>Codex Agent Review Analysis / Findings</span>
        <div className="flex gap-1 shrink-0">
          {currentThreadIdForCaps ? (
            <>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-accent disabled:opacity-50"
                disabled={reviewStarting}
                onClick={runConfiguredReview}
                title="Start review/start with detached delivery for the selected target"
              >
                {reviewStarting ? 'Starting…' : 'Run review'}
              </button>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-accent disabled:opacity-50"
                disabled={reviewStarting}
                onClick={runAdvancedReview}
                title="Call review/start with custom JSON params"
              >
                Advanced review
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 border rounded hover:bg-accent"
            onClick={copyPromptToClipboard}
            title="Copy prompt to paste into Codex chat (drives review/start detached + analysis for this panel)"
          >
            Copy review prompt
          </button>
        </div>
      </div>
      {currentThreadIdForCaps ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Target</span>
            <select
              className="h-6 rounded border bg-background px-1.5 text-[10px]"
              value={reviewTargetMode}
              onChange={(event) =>
                setReviewTargetMode(event.target.value as ReviewTargetMode)
              }
              disabled={reviewStarting}
            >
              <option value="uncommittedChanges">Uncommitted changes</option>
              <option value="baseBranch">Base branch</option>
              <option value="commit">Commit</option>
              <option value="custom">Custom instructions</option>
            </select>
          </label>
          {reviewTargetMode === 'baseBranch' ? (
            <input
              className="h-6 rounded border bg-background px-1.5 text-[10px] min-w-52"
              placeholder="Base branch (for example, main)"
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              disabled={reviewStarting}
            />
          ) : null}
          {reviewTargetMode === 'commit' ? (
            <div className="flex items-center gap-1">
              <input
                className="h-6 rounded border bg-background px-1.5 text-[10px] min-w-52"
                placeholder="Commit SHA"
                value={commitSha}
                onChange={(event) => setCommitSha(event.target.value)}
                disabled={reviewStarting}
              />
              <input
                className="h-6 rounded border bg-background px-1.5 text-[10px] min-w-52"
                placeholder="Optional title"
                value={commitTitle}
                onChange={(event) => setCommitTitle(event.target.value)}
                disabled={reviewStarting}
              />
            </div>
          ) : null}
          {reviewTargetMode === 'custom' ? (
            <textarea
              className="mt-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
              placeholder="Custom review instructions"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              disabled={reviewStarting}
            />
          ) : null}
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Hint</span>
            <input
              className="h-6 rounded border bg-background px-1.5 text-[10px] min-w-72"
              placeholder={defaultUserFacingHint}
              value={userFacingHint}
              onChange={(event) => setUserFacingHint(event.target.value)}
              disabled={reviewStarting}
            />
          </label>
        </div>
      ) : null}
      <div className="text-muted-foreground text-[10px]">
        Additional analysis or findings from the Codex engine (via
        review/start with detached delivery + userFacingHint, reasoning, plan,
        or direct chat instruction) can be surfaced here on top of the git
        diff above. The base diff is always from real `git diff HEAD` (or
        equivalent for the target via the Rust git_review_* commands). No
        agent-generated diff content is used or "added to a spot".
        The agent owns planning/tool use/subagents/patching/reasoning; Jan (this
        panel) owns the authoritative git view + approvals + workspace.
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        Select the Review tab (or open /review) while a Codex provider profile is
        active for the workspace. Instruct the agent in chat or use the copied
        prompt above. Codex events (including from subagents) with threadId appear
        in main chat CodexActivity; analysis can be referenced or copied here.
        Review panel stays purely git for the diff.
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">
        Advanced-only JSON is for edge cases; common review flows now use typed
        controls.
      </div>
      <textarea
        className="mt-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
        placeholder='review/start params JSON (legacy/advanced only, must include a valid target)'
        value={codexAdvancedReviewJson}
        onChange={(event) => onSetCodexAdvancedReviewJson(event.target.value)}
        disabled={reviewStarting}
      />
    </div>
  )
}
