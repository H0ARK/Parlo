import type { RawRpcCatalogItem } from './RawRpcMethodCatalog'
import { CODEX_APP_SERVER_METHOD_FALLBACKS } from '@/lib/codex-app-server/method-aliases'

type RawRpcCatalogContext = {
  codexMcpResourceUri: string
  codexMcpServerName: string
  codexMcpToolName: string
}

export function resolveCodexRawRpcMethod(method: string): string {
  return CODEX_APP_SERVER_METHOD_FALLBACKS[method] ?? method
}

export function buildCodexRawRpcCatalog({
  codexMcpResourceUri,
  codexMcpServerName,
  codexMcpToolName,
}: RawRpcCatalogContext): RawRpcCatalogItem[] {
  const mcpServer = codexMcpServerName.trim() || '<server>'
  const mcpTool = codexMcpToolName.trim() || '<toolName>'

  return [
    {
      group: 'MCP',
      method: 'mcpServer/resource/read',
      params: { server: mcpServer, uri: codexMcpResourceUri || '<uri>' },
      description: 'Read an MCP resource through Codex.',
    },
    {
      group: 'MCP',
      method: 'mcpServer/tool/call',
      params: { server: mcpServer, toolName: mcpTool, arguments: {} },
      description: 'Call an MCP tool through Codex.',
    },
    {
      group: 'Plugin',
      method: 'plugin/share/list',
      params: { remotePluginId: '<remotePluginId>' },
      description: 'List shared plugin metadata for a remote plugin.',
    },
    {
      group: 'Plugin',
      method: 'plugin/share/checkout',
      params: {
        remotePluginId: '<remotePluginId>',
        pluginPath: '<pluginPath>',
      },
      description: 'Read a shared plugin checkout file by path.',
    },
    {
      group: 'Plugin',
      method: 'plugin/share/updateTargets',
      params: {
        remotePluginId: '<remotePluginId>',
        targets: [],
      },
      description: 'Update share targets for a remote plugin.',
    },
    {
      group: 'Plugin',
      method: 'plugin/share/save',
      params: {
        remotePluginId: '<remotePluginId>',
        pluginPath: '<pluginPath>',
        targets: [],
      },
      description: 'Save plugin share targets for a given plugin path.',
    },
    {
      group: 'Plugin',
      method: 'plugin/share/delete',
      params: { remotePluginId: '<remotePluginId>' },
      description: 'Delete a remote plugin share entry.',
    },
    {
      group: 'Runtime',
      method: 'fuzzyFileSearch/sessionStart',
      params: { sessionId: '<sessionId>', query: '<query>', limit: 50 },
      description: 'Start or resume a fuzzy file search session with a query.',
    },
    {
      group: 'Runtime',
      method: 'fuzzyFileSearch/sessionUpdate',
      params: { sessionId: '<sessionId>', query: '<query>', limit: 50 },
      description: 'Update a fuzzy file search session query.',
    },
    {
      group: 'Runtime',
      method: 'fuzzyFileSearch/sessionStop',
      params: { sessionId: '<sessionId>' },
      description: 'Stop a fuzzy file search session.',
    },
  ]
}
