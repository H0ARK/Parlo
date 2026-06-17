export const CODEX_APP_SERVER_METHOD_FALLBACKS: Record<string, string> = {
  'mcpServer/status/list': 'mcpServerStatus/list',
  'thread/compact': 'thread/compact/start',
  'thread/review': 'review/start',
}

export function resolveCodexAppServerMethod(method: string): string {
  return CODEX_APP_SERVER_METHOD_FALLBACKS[method] ?? method
}
