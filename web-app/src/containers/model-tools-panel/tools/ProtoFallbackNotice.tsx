export function ProtoFallbackNotice() {
  return (
    <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-300">
      Active Codex profile is using proto transport. Chat streaming can continue
      through proto fallback, but app-server-only controls in this panel,
      including MCP/resource browsing, runtime FS/process, plugins, account,
      remote control, and raw app-server RPC, require app-server transport.
    </div>
  )
}
