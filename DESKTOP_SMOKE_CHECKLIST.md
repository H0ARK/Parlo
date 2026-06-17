# Jan Codex Runtime — Desktop Smoke Checklist

**Date anchor**: 2026-06-12  
**Source**: run from the current repo worktree; do not use the installed `/Applications/Jan.app` as evidence.  
**Purpose**: Verify real end-to-end Codex app-server behavior in the built Tauri desktop app (things browser preview and unit tests cannot cover).

## Prerequisites (run once)
- Ensure Codex desktop binary is at `/Applications/Codex.app/Contents/Resources/codex` (or update your profile)
- Run `yarn install` and any `download:bin` / `build:cli` / `build:mlx-server` if needed for the Tauri side
- Run `yarn codex:desktop:preflight`
- Start a structured report with `yarn codex:desktop:smoke:report`; fill the generated file in `reports/codex-desktop-smoke/` as this checklist is executed
- After filling the report, run `yarn codex:desktop:smoke:validate`; the goal is not v1-complete until this validator passes on the filled report. If multiple report templates exist, pass the specific report path directly to the validator.
- Final v1 readiness gate: run `yarn codex:desktop:ready`; this enforces preflight, a validated filled desktop-smoke report, and a live Jan debug bridge snapshot with `clientErrors=0`. To avoid validating the wrong latest template, run `yarn codex:desktop:ready reports/codex-desktop-smoke/<filled-report>.md`.
- Build or launch the desktop app:
  - Dev: `yarn dev:tauri`
  - Or full build: `yarn build:tauri:darwin` (universal) then run the .app
- After the repo-local desktop app is running, run `yarn jan:debug:mcp:smoke` and paste the fresh output into the report. This is the app-state source of truth for avoiding accidental validation against the installed `/Applications` Jan app or a stale window.
- For an enforced live bridge preflight during the interactive pass, run `REQUIRE_JAN_DEBUG_BRIDGE=1 yarn codex:desktop:preflight`; this must pass with `clientErrors=0` before the manual smoke result can count toward v1.
- In the app, make sure you have at least one Codex-capable model/profile configured (or let it default to the built-in codex path).
- Have a git repo open for review testing (the /review panel).

## Test Matrix (do in order, note results)

### 1. Basic Launch & Runtime Boot
- [ ] App launches cleanly
- [ ] New chat defaults to Codex runtime path (no direct AI SDK bypass)
- [ ] Codex app-server process starts (visible in logs or runtime panel)
- [ ] Model provider projection works (e.g. local Jan provider or remote appears in Codex config)

### 2. Streaming Chat (happy path)
- [ ] Send a simple prompt
- [ ] Assistant text streams live
- [ ] Reasoning / plan / activity events appear if model emits them
- [ ] Token usage updates
- [ ] Turn completes without crash

### 3. Command / File Action + Approval Flow (critical)
- Ask the model to do something that triggers a command (e.g. "list files in current dir", "write a test file", "run ls -la")
- [ ] Approval dialog or inline approval UI appears
- [ ] You can **Approve** — command executes, output streams back into chat + runtime panel
- [ ] You can **Approve for session** — subsequent similar actions auto-approve in this chat
- [ ] You can **Deny** — action is rejected cleanly, model is notified, chat continues
- [ ] Command output appears both in chat bubbles and in the Runtime FS/Process panel (terminal-style if implemented)
- [ ] File changes (if any) show in chat and do not corrupt the review diff panel

### 4. Review Panel Integration
- Make a change via Codex (e.g. ask it to edit a file)
- Open the Review panel (or /review route)
- [ ] Detached review does **not** overwrite the authoritative git diff
- [ ] You can commit / create PR from the panel after Codex changes
- [ ] Diffs look correct

### 5. Runtime / Process / FS Panel
- While running commands or file ops:
- [ ] Runtime FS/Process panel shows active handles
- [ ] You can interact (stdin, kill, resize if terminal UI is there)
- [ ] Events (spawn, outputDelta, exited) are visible and useful

### 6. MCP / Account / Unsupported States
- Open the MCP block
- [ ] Status loads or shows clear error
- Try a tool call if possible
- [ ] Account panel shows unauth/auth state without breaking chat
- [ ] Proto fallback (if any profile uses it) shows explicit "unsupported" messaging for app-server-only controls

### 7. Plugins / Skills / Marketplace (if modularized)
- Browse plugins/skills
- [ ] Install/uninstall or config actions work or give actionable feedback
- Marketplace cards load

### 8. Thread Persistence & Resume
- Start a chat, do some work
- Close/reopen the app or switch threads
- [ ] Can resume the Codex thread (mapped id is remembered)
- History replays correctly

### 9. Clean Shutdown
- Close the chat / app
- [ ] Codex app-server process is terminated cleanly (no zombie)
- [ ] No crashes or leaked state in logs
- [ ] Next launch is fresh

### 10. Regression / Edge
- Try a local model that may not support tools (should fail early with good message)
- Multiple rapid turns
- Interrupt a running turn
- Raw RPC panel (expert mode) — call a couple methods manually

## Evidence to Capture
- Screenshots of:
  - Approval dialog in action
  - Streaming chat with command output
  - Review panel after Codex edit
  - Runtime terminal/process panel
- Console / log excerpts for process start + events
- Fresh `yarn jan:debug:mcp:smoke` output showing the route and selected provider/model
- The same bridge output must show `clientErrors=0`
- Any error messages or unexpected behaviors
- The exact Codex binary version shown (`-V`)

## How to Record
When done, reply with:
- Pass / Fail per item above
- Key screenshots (or describe them)
- Any new bugs found
- Then we will:
  - Update `CODEX_CLONE_PARITY.md` with the real desktop evidence
  - Run `yarn codex:desktop:smoke:validate` against the filled report
  - Run `yarn codex:desktop:ready reports/codex-desktop-smoke/<filled-report>.md` as the final v1 gate
  - Advance to product polish (Milestone 2 + 4+)

## Notes for this pass
- Focus on **happy path + approval** first — that's the biggest delta from mock smoke.
- Browser preview (`yarn workspace @janhq/web-app preview`) is useful for UI layout but **will** show Tauri invoke errors — ignore those.
- Use the modular panels (AccountPanel, McpPanel, etc.) that were just added; test that the split didn't break anything.

Good luck — this is the pass that turns "preview" into something we can actually ship a demo of.
