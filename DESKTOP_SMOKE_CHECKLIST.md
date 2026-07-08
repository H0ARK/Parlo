# Parlo Codex Runtime — Desktop Smoke Checklist

**Purpose:** Verify real end-to-end Codex app-server behavior in the built Tauri desktop app (things browser preview and unit tests cannot cover).

## Automated prerequisites (run once)

- Ensure Codex desktop binary is at `/Applications/Codex.app/Contents/Resources/codex` (or set `CODEX_BINARY`)
- Run `yarn install` and any `download:bin` / `build:cli` / `build:mlx-server` needed for Tauri
- Run `yarn codex:desktop:preflight`
- Start a structured report with `yarn codex:desktop:smoke:report`; fill the generated file under `reports/codex-desktop-smoke/`
- After filling the report, run `yarn codex:desktop:smoke:validate` (or pass the report path)
- Final v1 readiness gate: `yarn codex:desktop:ready`
- Build or launch the desktop app:
  - Dev: `yarn dev:tauri`
  - Or full build: `yarn build:tauri:darwin` (universal) then run the .app
- After the repo-local desktop app is running, run `yarn parlo:debug:mcp:smoke` and paste the fresh output into the report. This is the app-state source of truth.
- For an enforced live bridge preflight during the interactive pass, run `REQUIRE_PARLO_DEBUG_BRIDGE=1 yarn codex:desktop:preflight` (or legacy `REQUIRE_JAN_DEBUG_BRIDGE=1`); this must pass with `clientErrors=0`.
- In the app, make sure you have at least one Codex-capable model/profile configured (or let it default to the built-in codex path).
- Have a git repo open for review testing (the /review panel).

## Test Matrix (do in order, note results)

### 1. Basic Launch & Runtime Boot
- [ ] App launches cleanly
- [ ] New chat defaults to Codex runtime path (no direct AI SDK bypass)
- [ ] Codex app-server process starts (visible in logs or runtime panel)
- [ ] Model provider projection works (e.g. local Parlo provider or remote appears in Codex config)

### 2. Streaming Chat (happy path)
- [ ] Send a simple prompt
- [ ] Assistant text streams live
- [ ] Reasoning / plan / activity events appear if model emits them
- [ ] Token usage updates
- [ ] Turn completes without crash

### 3. Command / File Action + Approval Flow (critical)
- Ask the model to do something that triggers a command (e.g. "list files in current dir", "write a test file", "run ls -la")
- [ ] Approval dialog or inline approval UI appears
- [ ] You can **Approve** → command executes, output streams back into chat + runtime panel
- [ ] You can **Approve for session** → subsequent similar actions auto-approve in this chat
- [ ] You can **Deny** → action is rejected cleanly, model is notified, chat continues
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

## Report workflow

1. `yarn codex:desktop:smoke:report`
2. Fill checkboxes and evidence in `reports/codex-desktop-smoke/`
3. `yarn codex:desktop:smoke:validate --latest`
4. `yarn codex:desktop:ready`
5. Paste `yarn parlo:debug:mcp:smoke` output (Parlo debug bridge / Jan debug bridge snapshot)

Also see `MULTI_PROVIDER_SMOKE.md` for multi-provider automated gates.
