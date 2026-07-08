# Multi-provider Codex host smoke matrix

Companion to `DESKTOP_SMOKE_CHECKLIST.md` and `DESIGN_CODEX_HOST.md` (PR10).

## Automated gates (CI / local)

```bash
yarn codex:spike:multi-provider
yarn codex:smoke:multi-provider
```

`codex:smoke:multi-provider` runs the focused unit suite covering:

| Area | Coverage |
|------|----------|
| ModelRoute defaults | direct remotes, gateway bare codex, local engines |
| Multi-provider merge | two providers in one TOML + union env |
| ConfigLease | registry, last-writer vs union env, multi-provider flag |
| Runtime mutation chain | exclusive spawn/apply, fail-inflight on restart |
| Engine readiness | GET `/models` probe |
| Binary health | soft-warn default, hard-block flag |
| Capability barrels | product + advanced full facade |
| Chat backend | approvals, projection, local prep |

## Manual desktop matrix (optional)

- [ ] Chat with **OpenAI** remote (direct projection)
- [ ] Chat with **xAI / Grok** (responses wire)
- [ ] Chat with **Ollama** (chat wire)
- [ ] Chat with **llamacpp** local engine (prep + probe + gateway/local API)
- [ ] Two threads, two providers, concurrent sends (flags: `perProviderEnvKeys` + `multiProviderMerge` on)
- [ ] Interrupt / compact / rollback
- [ ] Approval approve / deny
- [ ] MCP tool via projected mcp_servers
- [ ] Binary missing soft-warn banner (no hard block)
- [ ] Review panel after Codex edit (detached; git panel authoritative)

## Product defaults (must hold)

- `preferGatewayForRemotes` = **false**
- `binaryHealthHardBlock` = **false**
- Full Codex RPC facade reachable (`codexAdvanced` barrel)
