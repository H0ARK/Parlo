#!/usr/bin/env node

import { runCodexCliParityCheckCli } from './codex/cli/parity-check.mjs'
export { runCodexCliParityCheckCli as run } from './codex/cli/parity-check.mjs'
export { runCodexCliParityCheck } from './codex/cli/parity-check.mjs'

process.exit(runCodexCliParityCheckCli())
