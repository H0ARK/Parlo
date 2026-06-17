type CodexCapabilitiesFooterProps = {
  message?: string
  isCodexProtoTransport?: boolean
}

export function CodexCapabilitiesFooter({
  message = 'Codex panels cover remote control, marketplace, config read/write, and collaboration modes. Studio runtime actions and git worktrees are routed through Jan Studio/workspace controls.',
}: CodexCapabilitiesFooterProps) {
  return <div className="mt-1 text-[9px] text-muted-foreground">{message}</div>
}
