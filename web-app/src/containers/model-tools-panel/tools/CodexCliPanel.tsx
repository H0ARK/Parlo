import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import {
  parseCodexArgTokens,
  parseCodexJson,
} from '@/containers/model-tools-panel/shared/codex-helpers'
import {
  runCodexApply,
  runCodexCompletion,
  runCodexCliDebug,
  runCodexCliArchive,
  runCodexCliMcp,
  runCodexCliMcpServer,
  runCodexCliFork,
  runCodexCliApp,
  runCodexCliDoctor,
  runCodexExec,
  runCodexCliExecServer,
  runCodexCliPlugin,
  runCodexCliHelp,
  runCodexCliAppServer,
  runCodexCliCloud,
  runCodexCliResume,
  runCodexCliSandbox,
  runCodexCliRemoteControl,
  runCodexCliReview,
  runCodexCliFeatures,
  runCodexCliUnarchive,
  runCodexCliUpdate,
  runCodexLogin,
  runCodexLogout,
  runCodexVersion,
  runCodexCliCommand,
} from '@/lib/codex-app-server'

type CodexCliPanelProps = {
  cwd: string
}

function describeCodexCliError(error: unknown) {
  return `Codex CLI command failed: ${String(error)}`
}

function parseCodexCliArgs(value: string, fallback: string[] | null) {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback ?? []
  }

  const parsed = parseCodexJson<unknown>(trimmed, null)
  if (Array.isArray(parsed)) {
    if (!parsed.every((arg) => typeof arg === 'string')) {
      return null
    }
    return parsed
  }

  if (parsed !== null) {
    return null
  }

  const tokenized = parseCodexArgTokens(trimmed)
  if (tokenized === null) {
    return null
  }
  return tokenized
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getCliExitCode(value: unknown): string {
  const record = asRecord(value)
  const exitCode = record?.exit_code ?? record?.exitCode ?? record?.status
  return typeof exitCode === 'number' || typeof exitCode === 'string'
    ? String(exitCode)
    : '—'
}

export function CodexCliPanel({ cwd }: CodexCliPanelProps) {
  type CliSnapshot = {
    label: string
    result: unknown
  }

  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<CliSnapshot | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [execPrompt, setExecPrompt] = useState('')
  const [execOutputLastMessage, setExecOutputLastMessage] = useState('')
  const [execSandbox, setExecSandbox] = useState<'read-only' | 'workspace-write' | 'danger-full-access'>('workspace-write')
  const [execJsonOutput, setExecJsonOutput] = useState(false)
  const [execAddDirs, setExecAddDirs] = useState('[]')
  const [execExtraArgs, setExecExtraArgs] = useState('[]')
  const [command, setCommand] = useState('')
  const [commandArgs, setCommandArgs] = useState('[]')
  const [reviewPrompt, setReviewPrompt] = useState('')
  const [reviewArgs, setReviewArgs] = useState('[]')
  const [doctorArgs, setDoctorArgs] = useState('[]')
  const [featuresArgs, setFeaturesArgs] = useState('[]')
  const [pluginArgs, setPluginArgs] = useState('[]')
  const [archiveArgs, setArchiveArgs] = useState('[]')
  const [unarchiveArgs, setUnarchiveArgs] = useState('[]')
  const [forkArgs, setForkArgs] = useState('[]')
  const [resumeArgs, setResumeArgs] = useState('[]')
  const [sandboxArgs, setSandboxArgs] = useState('[]')
  const [updateArgs, setUpdateArgs] = useState('[]')
  const [execServerArgs, setExecServerArgs] = useState('[]')
  const [cloudArgs, setCloudArgs] = useState('[]')
  const [remoteControlArgs, setRemoteControlArgs] = useState('[]')
  const [mcpServerArgs, setMcpServerArgs] = useState('[]')
  const [appArgs, setAppArgs] = useState('[]')
  const [applyTaskId, setApplyTaskId] = useState('')
  const [completionShell, setCompletionShell] = useState('bash')
  const [loginApiKey, setLoginApiKey] = useState('')
  const [rawArgs, setRawArgs] = useState('["--version"]')
  const [helpSubcommand, setHelpSubcommand] = useState('')
  const [helpArgs, setHelpArgs] = useState('[]')
  const cliResultRecord = asRecord(snapshot?.result)
  const cliStdout = getString(cliResultRecord?.stdout)
  const cliStderr = getString(cliResultRecord?.stderr)
  const cliExitCode = getCliExitCode(snapshot?.result)

  const runCodexCliAction = async (
    label: string,
    action: () => Promise<unknown>
  ) => {
    setBusy(true)
    setErrorMessage('')
    try {
      const result = await action()
      setSnapshot({ label, result })
      toast.success(`Codex CLI completed: ${label}`)
    } catch (e) {
      const message = describeCodexCliError(e)
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Codex CLI</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            void runCodexCliAction('help', () =>
              runCodexCliHelp({
                cwd,
              })
            )
          }
        >
          Help
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            void runCodexCliAction('version', () =>
              runCodexVersion({
                cwd,
              })
            )
          }
        >
          Version
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Runs Codex CLI subcommands through the desktop bridge against the
        active workspace. This complements app-server chat with CLI-native
        diagnostics, review/apply flows, and automation.
      </div>
      <div className="mb-1 grid gap-1 md:grid-cols-3">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="codex command (no leading codex)"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="apply task id for quick action"
          value={applyTaskId}
          onChange={(event) => setApplyTaskId(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="completion shell (bash, zsh, fish)"
          value={completionShell}
          onChange={(event) => setCompletionShell(event.target.value)}
        />
      </div>
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder="codex command args (JSON array or command tokens)"
        value={commandArgs}
        onChange={(event) => setCommandArgs(event.target.value)}
      />
      <div className="mb-1 grid gap-1 md:grid-cols-2">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="help subcommand (optional)"
          value={helpSubcommand}
          onChange={(event) => setHelpSubcommand(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px] font-mono"
          placeholder="help args (JSON array or command tokens)"
          value={helpArgs}
          onChange={(event) => setHelpArgs(event.target.value)}
        />
      </div>
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy || !command.trim()}
          onClick={() => {
            const args = parseCodexCliArgs(commandArgs, null)
            if (args === null) {
              setErrorMessage('Codex CLI args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction(`codex ${command.trim()}`, () =>
              runCodexCliCommand({
                command: 'codex',
                args: [command.trim(), ...args],
                cwd,
              })
            )
          }}
        >
          Run CLI command
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(helpArgs, [])
            if (args === null) {
              setErrorMessage('Help args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('help', () =>
              runCodexCliHelp({
                args: [
                  ...(helpSubcommand.trim() ? [helpSubcommand.trim()] : []),
                  ...args,
                ],
                cwd,
              })
            )
          }}
        >
          Help command
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy || !applyTaskId.trim()}
          onClick={() => {
            const taskId = applyTaskId.trim()
            if (!taskId) return
            void runCodexCliAction('codex apply', () =>
              runCodexApply({
                taskId,
                cwd,
              })
            )
          }}
        >
          Apply task diff
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            void runCodexCliAction('codex completion', () =>
              runCodexCompletion({
                shell: completionShell.trim() || 'bash',
                cwd,
              })
            )
          }}
        >
          Generate completion
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            void runCodexCliAction('login', () =>
              runCodexLogin({
                apiKey: loginApiKey.trim() || undefined,
                cwd,
              })
            )
          }}
        >
          Login
        </button>
      </div>
      <textarea
        className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
        placeholder="codex exec prompt"
        value={execPrompt}
        onChange={(event) => setExecPrompt(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='exec addDirs (JSON array or command tokens)'
        value={execAddDirs}
        onChange={(event) => setExecAddDirs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='exec extra args (JSON array or command tokens)'
        value={execExtraArgs}
        onChange={(event) => setExecExtraArgs(event.target.value)}
      />
      <div className="mb-1 flex items-center gap-2 text-[9px]">
        <label className="flex items-center gap-1">
          <span>Sandbox:</span>
          <select
            className="h-6 rounded border bg-background px-1"
            value={execSandbox}
            onChange={(event) =>
              setExecSandbox(
                event.target.value as 'read-only' | 'workspace-write' | 'danger-full-access'
              )
            }
          >
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={execJsonOutput}
            onChange={(event) => setExecJsonOutput(event.target.checked)}
          />
          <span>json output</span>
        </label>
      </div>
      <Input
        className="mb-1 h-6 px-2 text-[10px]"
        placeholder="exec outputLastMessage (optional)"
        value={execOutputLastMessage}
        onChange={(event) => setExecOutputLastMessage(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px]"
        placeholder="login API key (optional)"
        value={loginApiKey}
        onChange={(event) => setLoginApiKey(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='raw Codex CLI args (JSON array or tokens)'
        value={rawArgs}
        onChange={(event) => setRawArgs(event.target.value)}
      />
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy || !execPrompt.trim()}
          onClick={() => {
            const addDirs = parseCodexCliArgs(execAddDirs, null)
            const extraArgs = parseCodexCliArgs(execExtraArgs, null)
            if (addDirs === null) {
              setErrorMessage('exec addDirs must be a JSON array or command tokens.')
              return
            }
            if (extraArgs === null) {
              setErrorMessage('exec extra args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('exec', () =>
              runCodexExec({
                prompt: execPrompt.trim(),
                cwd,
                sandbox: execSandbox,
                jsonOutput: execJsonOutput,
                outputLastMessage: execOutputLastMessage.trim() || undefined,
                addDirs,
                extraArgs,
              })
            )
          }}
        >
          Exec
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            void runCodexCliAction('login status', () =>
              runCodexLogin({
                status: true,
                cwd,
              })
            )
          }}
        >
          Login status
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            void runCodexCliAction('logout', () =>
              runCodexLogout({
                cwd,
              })
            )
          }}
        >
          Logout
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(rawArgs, null)
            if (args === null) {
              setErrorMessage('Codex CLI args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('raw', () =>
              runCodexCliCommand({
                command: 'codex',
                args,
                cwd,
              })
            )
          }}
        >
          Raw CLI
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(rawArgs, null)
            if (args === null) {
              setErrorMessage('Codex CLI args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('app-server', () =>
              runCodexCliAppServer({
                args,
                cwd,
              })
            )
          }}
        >
          App-server
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(appArgs, null)
            if (args === null) {
              setErrorMessage('App args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('app', () =>
              runCodexCliApp({
                args,
                cwd,
              })
            )
          }}
        >
          App
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(rawArgs, null)
            if (args === null) {
              setErrorMessage('Codex CLI args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('mcp', () =>
              runCodexCliMcp({
                args,
                cwd,
              })
            )
          }}
        >
          MCP
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(mcpServerArgs, null)
            if (args === null) {
              setErrorMessage('MCP server args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('mcp-server', () =>
              runCodexCliMcpServer({
                args,
                cwd,
              })
            )
          }}
        >
          MCP-server
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(archiveArgs, null)
            if (args === null) {
              setErrorMessage('Archive args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('archive', () =>
              runCodexCliArchive({
                args,
                cwd,
              })
            )
          }}
        >
          Archive
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(unarchiveArgs, null)
            if (args === null) {
              setErrorMessage('Unarchive args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('unarchive', () =>
              runCodexCliUnarchive({
                args,
                cwd,
              })
            )
          }}
        >
          Unarchive
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(forkArgs, null)
            if (args === null) {
              setErrorMessage('Fork args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('fork', () =>
              runCodexCliFork({
                args,
                cwd,
              })
            )
          }}
        >
          Fork
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(resumeArgs, null)
            if (args === null) {
              setErrorMessage('Resume args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('resume', () =>
              runCodexCliResume({
                args,
                cwd,
              })
            )
          }}
        >
          Resume
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(sandboxArgs, null)
            if (args === null) {
              setErrorMessage('Sandbox args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('sandbox', () =>
              runCodexCliSandbox({
                args,
                cwd,
              })
            )
          }}
        >
          Sandbox
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(updateArgs, null)
            if (args === null) {
              setErrorMessage('Update args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('update', () =>
              runCodexCliUpdate({
                args,
                cwd,
              })
            )
          }}
        >
          Update
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(execServerArgs, null)
            if (args === null) {
              setErrorMessage('Exec-server args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('exec-server', () =>
              runCodexCliExecServer({
                args,
                cwd,
              })
            )
          }}
        >
          Exec-server
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(rawArgs, null)
            if (args === null) {
              setErrorMessage('Codex CLI args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('debug', () =>
              runCodexCliDebug({
                args,
                cwd,
              })
            )
          }}
        >
          Debug
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(reviewArgs, null)
            if (args === null) {
              setErrorMessage('Review args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('review', () =>
              runCodexCliReview({
                prompt: reviewPrompt.trim() || undefined,
                args,
                cwd,
              })
            )
          }}
        >
          Review
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(doctorArgs, null)
            if (args === null) {
              setErrorMessage('Doctor args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('doctor', () =>
              runCodexCliDoctor({
                args,
                cwd,
              })
            )
          }}
        >
          Doctor
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(featuresArgs, null)
            if (args === null) {
              setErrorMessage('Features args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('features', () =>
              runCodexCliFeatures({
                args,
                cwd,
              })
            )
          }}
        >
          Features
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(pluginArgs, null)
            if (args === null) {
              setErrorMessage('Plugin args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('plugin', () =>
              runCodexCliPlugin({
                args,
                cwd,
              })
            )
          }}
        >
          Plugin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(cloudArgs, null)
            if (args === null) {
              setErrorMessage('Cloud args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('cloud', () =>
              runCodexCliCloud({
                args,
                cwd,
              })
            )
          }}
        >
          Cloud
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const args = parseCodexCliArgs(remoteControlArgs, null)
            if (args === null) {
              setErrorMessage('Remote-control args must be a JSON array or command tokens.')
              return
            }
            void runCodexCliAction('remote-control', () =>
              runCodexCliRemoteControl({
                args,
                cwd,
              })
            )
          }}
        >
          Remote-control
        </button>
      </div>
      <Input
        className="mb-1 h-6 px-2 text-[10px]"
        placeholder="codex review prompt (optional)"
        value={reviewPrompt}
        onChange={(event) => setReviewPrompt(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='review args (JSON array or command tokens)'
        value={reviewArgs}
        onChange={(event) => setReviewArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='doctor args (JSON array or command tokens)'
        value={doctorArgs}
        onChange={(event) => setDoctorArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='features args (JSON array or command tokens)'
        value={featuresArgs}
        onChange={(event) => setFeaturesArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='plugin args (JSON array or command tokens)'
        value={pluginArgs}
        onChange={(event) => setPluginArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='archive args (JSON array or command tokens)'
        value={archiveArgs}
        onChange={(event) => setArchiveArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='unarchive args (JSON array or command tokens)'
        value={unarchiveArgs}
        onChange={(event) => setUnarchiveArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='fork args (JSON array or command tokens)'
        value={forkArgs}
        onChange={(event) => setForkArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='resume args (JSON array or command tokens)'
        value={resumeArgs}
        onChange={(event) => setResumeArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='sandbox args (JSON array or command tokens)'
        value={sandboxArgs}
        onChange={(event) => setSandboxArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='update args (JSON array or command tokens)'
        value={updateArgs}
        onChange={(event) => setUpdateArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='exec-server args (JSON array or command tokens)'
        value={execServerArgs}
        onChange={(event) => setExecServerArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='app args (JSON array or command tokens)'
        value={appArgs}
        onChange={(event) => setAppArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='mcp-server args (JSON array or command tokens)'
        value={mcpServerArgs}
        onChange={(event) => setMcpServerArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='cloud args (JSON array or command tokens)'
        value={cloudArgs}
        onChange={(event) => setCloudArgs(event.target.value)}
      />
      <Input
        className="mb-1 h-6 px-2 text-[10px] font-mono"
        placeholder='remote-control args (JSON array or command tokens)'
        value={remoteControlArgs}
        onChange={(event) => setRemoteControlArgs(event.target.value)}
      />
            {snapshot ? (
        <div className="mt-1 border rounded bg-background/60 p-1 text-[9px] font-mono">
          <div className="font-semibold mb-0.5">{snapshot.label} — exit: {cliExitCode}</div>
          {cliStdout ? (
            <div>
              <div className="text-green-600">stdout:</div>
              <pre className="whitespace-pre-wrap break-words max-h-28 overflow-auto bg-black/5 p-1">{cliStdout}</pre>
            </div>
          ) : null}
          {cliStderr ? (
            <div>
              <div className="text-red-600 mt-1">stderr:</div>
              <pre className="whitespace-pre-wrap break-words max-h-20 overflow-auto bg-black/5 p-1 text-red-500">{cliStderr}</pre>
            </div>
          ) : null}
          {!(cliStdout || cliStderr) && (
            <pre className="whitespace-pre-wrap break-words max-h-28 overflow-auto">{JSON.stringify(snapshot.result, null, 2)}</pre>
          )}
        </div>
      ) : (
        <div className="text-[9px] text-muted-foreground">— (no CLI result yet)</div>
      )}
      {errorMessage ? (
        <div className="mt-1 text-[9px] text-red-500">{errorMessage}</div>
      ) : null}
    </div>
  )
}
