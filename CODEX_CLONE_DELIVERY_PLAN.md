# Codex Clone Delivery Plan

_Last audited: 2026-06-11_

## Goal

Turn Jan into a deliverable Codex-style desktop agent shell that uses Codex app-server / proto / CLI as the execution bridge, while Jan remains the product UI and model/provider manager. The point is not to reimplement Codex internals; it is to wrap Codex so Jan can drive any supported local or remote model through the Codex runtime path.

## Current state

### Solid / already wired

- **Codex runtime is the central chat path.** `CustomChatTransport` routes Codex and normal providers into `sendCodexAppServerChatMessage`, so Jan providers can be projected into Codex config instead of bypassing Codex.
- **Shared app-server runtime exists.** `CodexAppServerBootstrap`, `global-codex-runtime`, and Tauri process commands start and manage a global Codex app-server process.
- **Thread persistence exists.** Jan thread metadata can remember the mapped Codex thread id and resume through app-server.
- **Provider projection exists.** Local/remote Jan providers are converted into Codex model provider config, including Jan-managed provider ids such as `jan-ollama`.
- **Local Jan engines are prepared before Codex turns.** Jan-hosted local providers can start their model plus local OpenAI-compatible API before the Codex request.
- **UI activity mapping exists.** Assistant text, reasoning, plans, command/process output, file changes, warnings, thread status, account/MCP/runtime events map into visible UI chunks/cards.
- **Capability surface is broad.** Threads, account, remote control, config/admin, models/features, raw RPC, CLI login/logout/version/apply/completion/exec, plugins/marketplace/skills, runtime FS/process, and MCP controls exist in the workspace/review panel.
- **User-input dialog exists.** Codex can ask for structured user input through a mounted app dialog.
- **Smoke script exists.** `scripts/codex-smoke-test.mjs` starts a real Codex app-server and uses a mock Responses provider to verify one streaming turn.

### Rough / not deliverable-polished yet

- The Codex capability UI is still a giant admin/debug console. It works, but it is not yet a clean product workflow.
- Many stable actions still expose JSON/TOML textareas instead of schema-driven forms.
- Process/command terminal support is useful but still panel-level; it needs a proper full terminal/task dashboard for a Codex-clone feel.
- Thread management is chip/id/pre-block driven; it needs readable tables/timelines.
- MCP/plugin/marketplace browsing is still primitive.
- Proto fallback exists but most app-server-only controls are unsupported. The UI needs to either hide unsupported controls or clearly label them.
- Exact upstream app-server method/parameter names still need one pass against the current `@openai/codex` binary to reduce drift risk.
- Real desktop/manual smoke is still required: chat, approval/deny, command execution, review, MCP/account states, shutdown.

## Fresh validation evidence

Commands run from `/Users/conrad/Documents/GitHub/jan`:

```bash
yarn vitest run --project @janhq/web-app \
  web-app/src/lib/codex-app-server/__tests__/json-rpc.test.ts \
  web-app/src/lib/codex-app-server/__tests__/process-manager.test.ts \
  web-app/src/lib/codex-app-server/__tests__/client.test.ts \
  web-app/src/lib/codex-app-server/__tests__/api.test.ts \
  web-app/src/lib/codex-app-server/__tests__/tauri-process.test.ts \
  web-app/src/lib/codex-app-server/__tests__/ui-stream.test.ts \
  web-app/src/lib/codex-app-server/__tests__/chat-backend.test.ts \
  web-app/src/lib/codex-app-server/__tests__/mcp-config-bridge.test.ts \
  web-app/src/lib/codex-app-server/__tests__/proto-adapter.test.ts \
  web-app/src/lib/codex-app-server/__tests__/proto-session.test.ts \
  web-app/src/lib/codex-app-server/__tests__/live-app-server.test.ts \
  web-app/src/lib/__tests__/custom-chat-transport-class.test.ts \
  web-app/src/stores/__tests__/codex-provider-profile-store.test.ts
```

Result: **13 files / 101 tests passed**.

```bash
CODEX_BINARY=/Applications/Codex.app/Contents/Resources/codex yarn codex:parity:cli
CODEX_BINARY=/Applications/Codex.app/Contents/Resources/codex yarn codex:parity:cli:commands
```

Result: both passed for the installed Codex desktop binary after tightening the parity scripts so `help --help` and missing legacy `proto` on the desktop binary are treated as optional/advisory rather than release blockers.

```bash
yarn workspace @janhq/web-app preview --host 127.0.0.1 --port 4173
```

Result: browser-preview smoke confirmed the main Jan shell mounts and `/review` renders, but browser preview still shows `Cannot read properties of undefined (reading 'invoke')` for Tauri-only actions. This is useful evidence, but it does **not** replace the remaining real desktop smoke.

```bash
node scripts/codex-smoke-test.mjs
```

Result: passed against `/Applications/Codex.app/Contents/Resources/codex`; completed one mock-provider turn with assistant text `smoke-ok`.

```bash
yarn workspace @janhq/web-app build
```

Result: passed. Vite emitted existing chunk/dynamic-import warnings only.

```bash
cargo check --manifest-path src-tauri/Cargo.toml --lib
```

Result: passed. Rust emitted warnings only.

```bash
git diff --check -- . ':(exclude).jan/codex-home'
```

Result: passed.

## Fixes applied during this audit

- Replaced the missing `@/components/ui/select` dependency in `CodexUserInputDialog` with a native styled `<select>` so TypeScript build passes.
- Removed unused `shutdownGlobalCodexAppServer` import.
- Routed capability helper calls through `requireCodexSession(janThreadId)` instead of the global client directly, which also makes thread context explicit.
- Removed unused proto fallback runtime state.
- Cleared TypeScript no-unused blockers in `CustomChatTransport` and `ModelToolsPanel`.
- Added `cross-env` to `web-app` dev dependencies so `yarn workspace @janhq/web-app test ...` works in this workspace.
- Moved the work onto `feature/codex-runtime-preview`.
- Removed tracked `.jan/codex-home` runtime artifacts from git so repo-local Codex state stays ignored and local-only.
- Relaxed the new CLI parity scripts so the installed desktop Codex binary passes when legacy optional commands such as `proto` are absent and `help --help` exits non-zero.

## Deliverable definition

A shippable MVP should be honest: **"Jan Codex Runtime Preview"**, not "full Codex parity" yet.

It is deliverable when:

1. New/fresh chats default into the Codex runtime path.
2. A user can pick any configured Jan provider/model and the request goes through Codex app-server.
3. A real chat can stream assistant text, reasoning/activity, command/process output, and file-change events.
4. Approval/deny for command/file actions works in the desktop app.
5. CLI helpers for `login`, `logout`, `version`, `apply`, `completion`, `exec`, `help`, `app`, `mcp`, `mcp-server`, `app-server`, `cloud`, `remote-control`, `review`, `doctor`, `features`, `plugin`, and raw args work from the UI.
6. Runtime process/command sessions are visible and controllable enough to be useful.
7. Account/MCP/plugin/thread controls either work or show explicit unsupported/actionable errors.
8. Proto fallback does not pretend to support app-server-only capabilities.
9. Focused tests, web build, Rust check, and mock app-server smoke pass.
10. Manual desktop smoke is recorded in `CODEX_CLONE_PARITY.md`.

## Finish milestones

### Milestone 1 — stabilize the branch for preview

- Remove or gitignore repo-local `.jan/codex-home` runtime databases/sessions unless they are intentionally test fixtures.
- Commit/organize the current dirty source changes into one coherent Codex runtime branch, not `main` if this is meant to be reviewed.
- Keep the current passing gates green: focused Vitest suite, web build, Rust check, smoke script, diff check.
- Add a short README section or docs page explaining "Codex Runtime Preview" setup.

### Milestone 2 — productize the happy path

- Add a guided Codex provider/profile setup flow: binary path, CODEX_HOME, target provider, model, approval policy, sandbox, API key env.
- Make the chat composer clearly show when the active chat is Codex-backed.
- Add explicit first-run diagnostics: Codex binary found, app-server help available, provider reachable, model supports tools.
- Keep local Jan providers on the Codex path; avoid reintroducing direct AI SDK bypasses.

### Milestone 3 — approvals and command execution smoke

- Run a real desktop chat that forces a command/file approval.
- Verify approve, approve-for-session, and deny decision mapping against current Codex protocol strings.
- Verify app-server command/process output renders in chat and in the runtime terminal panel.
- Add or extend an automated smoke for approval request/response if upstream app-server can be mocked reliably.

### Milestone 4 — clean capability UX

- Split the huge capability block into task-focused sections or tabs:
  - Threads
  - Runtime terminal/processes
  - MCP
  - Plugins/skills/marketplace
  - Account/remote/control
  - Raw RPC/debug
- Replace JSON fields with typed forms where the method schema is stable.
- Leave Raw RPC available as an expert/debug escape hatch.

### Milestone 5 — thread/process polish

- Replace thread id chips/pre blocks with readable thread rows: id, title/name, status, last turn, actions.
- Turn process handles into terminal tabs with scrollback, copy, clear, kill, resize, stdin.
- Store enough runtime event history for useful debugging without polluting committed repo state.

### Milestone 6 — compatibility/drift hardening

- Compare every typed wrapper method against the currently installed Codex app-server method names.
- Validate against both `/Applications/Codex.app/.../codex` and current `npx -y @openai/codex` when practical.
- Decide proto fallback behavior: hide app-server-only controls or render disabled cards with unsupported messages.

### Milestone 7 — final release gate

Run and record:

- Focused Codex Vitest suite.
- Full `yarn test:web` if time allows.
- `yarn workspace @janhq/web-app build`.
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`.
- `node scripts/codex-smoke-test.mjs`.
- Manual desktop smoke:
  - app starts and app-server boots
  - Codex-backed chat streams
  - command approval approve/deny works
  - runtime process output visible
  - review flow does not overwrite git diff
  - MCP/account unsupported states are actionable
  - shutdown cleans up process/session state

## Top risks

1. **Shared global app-server config mutation.** Per-thread config writes on one global app-server can race if multiple chats/models run concurrently.
2. **Upstream method drift.** Many app-server calls are stringly typed and may break when Codex changes method names or params.
3. **Proto fallback mismatch.** Proto is basic chat; app-server control surfaces need explicit unsupported UI.
4. **Tool-capable model requirement.** Some local models reject Codex tool calls; setup diagnostics should detect this early.
5. **Dirty runtime artifacts.** `.jan/codex-home` state files should not be mixed with source changes unless intentionally versioned.

## Recommended next action

**Milestone 1 completed** (2026-06-11):

- Branch stabilized on `feature/codex-runtime-preview`
- Tracked `.jan/codex-home` runtime artifacts removed from git (kept local-only)
- Initial stabilization commit: `3d3427548 feat: stabilize codex runtime preview`
- Second commit + push: `7387b31ad chore: modularize codex capabilities panels (Account, MCP, Plugins, Runtime FS, Raw RPC); incremental fixes and aliases; prep for desktop smoke pass`
- Pushed to origin (https://github.com/H0ARK/jan.git)
- Fresh smoke + parity checks passed on the branch

## Next Pass — Desktop Smoke & Approval Verification (Milestone 3 focus + continuing UX modularization)

**Goal for this pass**: Execute and record a real interactive desktop smoke using the built Tauri desktop app on macOS. Verify end-to-end Codex runtime behavior that cannot be tested in browser preview or unit tests.

### Immediate next steps (do these on your desktop Mac)

1. Checkout and pull the branch:
   ```bash
   git checkout feature/codex-runtime-preview
   git pull origin feature/codex-runtime-preview
   ```
2. Build/run the desktop app (use the Makefile or `yarn tauri dev` after deps).
3. Follow the detailed checklist in `DESKTOP_SMOKE_CHECKLIST.md`.
4. Capture evidence:
   - Screenshots or screen recordings of key flows
   - Console/logs from the app
   - Note any bugs/blockers
5. Paste results back here so we can update `CODEX_CLONE_PARITY.md` and move to product polish.

See the new `DESKTOP_SMOKE_CHECKLIST.md` for the exact test matrix (chat streaming, approval flows, command execution, review panel, runtime panels, MCP/account states, clean shutdown).

Continue modularization work in parallel if desired (the new panel files are already in the tree).

Once this pass passes, we can close out the remaining polish milestones.
