import { IconLayoutSidebar } from '@tabler/icons-react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import { useTheme } from '@/hooks/useTheme'
import Editor from '@monaco-editor/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  Copy,
  File,
  Folder,
  FolderOpen,
  Globe,
  Loader2,
  MessageCirclePlus,
  MoreHorizontal,
  Paperclip,
  PanelBottom,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import '@xterm/xterm/css/xterm.css'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

import {
  CHAT_SIDE_PANEL_MAX_WIDTH,
  CHAT_SIDE_PANEL_MIN_WIDTH,
  CHAT_SIDE_PANEL_DROPDOWN_SECTIONS,
  getChatSidePanelSection,
  type ChatSidePanelSectionItem,
} from '@/constants/chat-side-panel'
import { useEmbeddedBrowser } from '@/hooks/useEmbeddedBrowser'
import { useSidebarResize } from '@/hooks/use-sidebar-resize'
import { normalizeBrowserAddress } from '@/lib/browser-address'
import { isPlatformTauri, isPlatformMacOS } from '@/lib/platform/utils'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'
import { useServiceHub } from '@/hooks/useServiceHub'

import { useThreads } from '@/hooks/useThreads'
import { mergeButtonRefs } from '@/lib/merge-button-refs'
import type {
  CodexCommandExecParams,
  CodexFileSystemCopyParams,
  CodexFileSystemRemoveParams,
  CodexMcpToolCallParams,
  CodexProcessSpawnParams,
  CodexReviewTarget,
} from '@/lib/codex-app-server/api'
import { throttle } from '@/lib/throttle'
import { cn } from '@/lib/utils'
import {
  createBrowserSelectionAttachment,
  createContextBriefAttachment,
  createDocumentAttachment,
  createProcessListAttachment,
  createRuntimeLogAttachment,
  createTerminalOutputAttachment,
  type Attachment,
} from '@/types/attachment'
import { useBrowserRuntime } from '@/stores/browser-runtime-store'
import {
  useTerminalRuntime,
  type TerminalSessionInfo,
} from '@/stores/terminal-runtime-store'
import { useCodexAppServerRuntime } from '@/stores/codex-app-server-runtime-store'
import { ChatSessionContext } from '@/hooks/useChatSessionScope'
import {
  useChatSessionUi,
  useChatSessionUiActions,
  useChatSessionUiSelector,
  resolveOpenTabs,
} from '@/hooks/useChatSessionUi'
import {
  listCodexSkills,
  listCodexPlugins,
  listCodexHooks,
  listInstalledCodexPlugins,
  listCodexApps,
  installCodexPlugin,
  uninstallCodexPlugin,
  readCodexPlugin,
  readCodexPluginSkill,
  writeCodexSkillConfig,
  addCodexMarketplace,
  removeCodexMarketplace,
  upgradeCodexMarketplace,
  listCodexModels,
  readCodexModelProviderCapabilities,
  listCodexExperimentalFeatures,
  setCodexSkillExtraRoots,
  startCodexReview,
  listCodexMcpServerStatus,
  startCodexMcpOauthLogin,
  readCodexMcpResource,
  callCodexMcpTool,
  reloadCodexMcpConfig,
  readCodexAccount,
  startCodexAccountLogin,
  cancelCodexAccountLogin,
  logoutCodexAccount,
  readCodexAccountRateLimits,
  readCodexAccountUsage,
  sendCodexAddCreditsNudgeEmail,
  enableCodexRemoteControl,
  disableCodexRemoteControl,
  readCodexRemoteControlStatus,
  startCodexRemoteControlPairing,
  readCodexRemoteControlPairingStatus,
  listCodexRemoteControlClients,
  revokeCodexRemoteControlClient,
  listCodexThreads,
  searchCodexThreads,
  listLoadedCodexThreads,
  readCodexThread,
  listCodexThreadTurns,
  listCodexThreadTurnItems,
  startCodexTurn,
  startCodexThread,
  resumeCodexThread,
  listCodexThreadRealtimeVoices,
  approveCodexGuardianDeniedAction,
  incrementCodexThreadElicitation,
  decrementCodexThreadElicitation,
  readCodexConversationSummary,
  readCodexGitDiffToRemote,
  readCodexAuthStatus,
  updateCodexThreadMetadata,
  updateCodexThreadSettings,
  unsubscribeCodexThread,
  interruptCodexThreadTurn,
  compactCodexThreadById,
  reloadCodexThread,
  rollbackCodexThreadById,
  startCodexThreadReview,
  injectCodexThreadItems,
  cleanCodexBackgroundTerminals,
  startCodexThreadRealtime,
  appendCodexThreadRealtimeAudio,
  appendCodexThreadRealtimeText,
  stopCodexThreadRealtime,
  resetCodexMemory,
  readCodexConfig,
  readCodexConfigRequirements,
  detectCodexExternalAgentConfig,
  importCodexExternalAgentConfig,
  writeCodexConfigValue,
  writeCodexConfigBatch,
  startCodexWindowsSandbox,
  uploadCodexFeedback,
  setCodexExperimentalFeatureEnablement,
  addCodexEnvironment,
  execCodexCommand,
  writeCodexCommandInput,
  resizeCodexCommandTerminal,
  terminateCodexCommand,
  spawnCodexProcess,
  writeCodexProcessInput,
  resizeCodexProcessTerminal,
  killCodexProcess,
  readCodexDirectory,
  readCodexFile,
  getCodexMetadata,
  createCodexDirectory,
  writeCodexFile,
  removeCodexFileSystemPath,
  copyCodexFileSystemPath,
  watchCodexFileSystem,
  unwatchCodexFileSystem,
  forkCodexThread,
  archiveCodexThread,
  unarchiveCodexThread,
  setCodexThreadName,
  setCodexThreadGoal,
  getCodexThreadGoal,
  clearCodexThreadGoal,
  setCodexThreadMemoryMode,
  listCodexPermissionProfiles,
  listCodexCollaborationModes,
  callCodexAppServer,
  getCodexAppServerRuntimeLogs,
} from '@/lib/codex-app-server'

import { useChatSessionId } from '@/hooks/useChatSessionScope'
import {
  useWorkspaceDirectories,
  type WorkspaceDirectoryScope,
} from '@/stores/workspace-directory-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { toast } from 'sonner'

import {
  collectCodexItemIds,
  collectCodexMarketplaceDescriptors,
  collectCodexMcpResourceDescriptors,
  collectCodexMcpResourceUris,
  collectCodexMcpServerNames,
  collectCodexMcpToolDescriptors,
  collectCodexMcpToolNames,
  collectCodexPluginDescriptors,
  collectCodexPluginIds,
  collectCodexProcessHandles,
  collectCodexSkillDescriptors,
  collectCodexSkillIds,
  collectCodexThreadDescriptors,
  collectCodexThreadIds,
  collectCodexTurnIds,
  countCodexCollectionItems,
  decodeUtf8Base64,
  encodeUtf8Base64,
  parseCodexJson,
  summarizeCodexValue,
  validateJsonAgainstSchema,
} from './model-tools-panel/shared/codex-helpers'

import { CodexCliPanel } from './model-tools-panel/tools/CodexCliPanel'
import { McpPanel } from './model-tools-panel/tools/McpPanel'
import { PluginsMarketplaceTool } from './model-tools-panel/tools/PluginsMarketplaceTool'
import { RawRpcTool } from './model-tools-panel/tools/RawRpcTool'
import { RuntimeFsProcessPanel } from './model-tools-panel/tools/RuntimeFsProcessPanel'
import { ThreadsPanel } from './model-tools-panel/tools/ThreadsPanel'
import { AccountPanel } from './model-tools-panel/tools/AccountPanel'
import { RemoteControlPanel } from './model-tools-panel/tools/RemoteControlPanel'
import { ConfigAdminPanel } from './model-tools-panel/tools/ConfigAdminPanel'
import { ModelsProvidersFeaturesPanel } from './model-tools-panel/tools/ModelsProvidersFeaturesPanel'
import { CodexReviewPanel } from './model-tools-panel/tools/CodexReviewPanel'
import { CodexSummaryCards } from './model-tools-panel/tools/CodexSummaryCards'
import { AppServerRuntimeLogs } from './model-tools-panel/tools/AppServerRuntimeLogs'
import {
  buildCodexRawRpcCatalog,
  resolveCodexRawRpcMethod,
} from './model-tools-panel/tools/raw-rpc-utils'

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g'
)

const toReviewString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const normalizeLegacyCodexReviewParams = (
  params: Record<string, unknown>
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...params }

  if (next.target && typeof next.target === 'object' && !Array.isArray(next.target)) {
    const target = next.target as Record<string, unknown>
    const type = toReviewString(target.type)
    if (type === 'branch') {
      const branch = toReviewString(target.base) || toReviewString(target.branch) || 'main'
      next.target = { type: 'baseBranch', branch }
    }
  }

  if (!next.target) {
    const type = toReviewString(next.type)

    if (type === 'uncommittedChanges') {
      next.target = { type: 'uncommittedChanges' }
    }

    if (type === 'baseBranch' || type === 'branch') {
      const branch = toReviewString(next.base) || toReviewString(next.branch) || 'main'
      next.target = { type: 'baseBranch', branch }
    }

    if (type === 'commit') {
      const sha = toReviewString(next.sha)
      if (sha) {
        const title = toReviewString(next.title)
        next.target = title ? { type: 'commit', sha, title } : { type: 'commit', sha }
      }
    }

    if (type === 'custom') {
      const instructions = toReviewString(next.instructions)
      if (instructions) {
        next.target = { type: 'custom', instructions }
      }
    }

    delete next.branch
    delete next.base
    delete next.sha
    delete next.title
    delete next.instructions
    delete next.type
  }

  const delivery = toReviewString(next.delivery)
  next.delivery = delivery === 'inline' || delivery === 'detached' ? delivery : 'detached'

  return next
}

type DirectoryTreeEntry = {
  path: string
  name: string
  isDirectory: boolean
  size?: number
}

type ModelToolsPanelScope = WorkspaceDirectoryScope & {
  sessionId: string
  threadId?: string
}

const DEFAULT_PANEL_SCOPE: ModelToolsPanelScope = {
  id: 'default',
  type: 'workspace',
  label: 'Workspace',
  sessionId: 'default',
}

const BROWSER_PANEL_TARGET_ID = 'workspace-browser-panel'
const FILE_TREE_ROW_HEIGHT = 28
const FILE_TREE_OVERSCAN = 6

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
])

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

async function readDirectoryEntries(
  directoryPath: string
): Promise<DirectoryTreeEntry[]> {
  const { fs } = await import('@parlo-lab/core')
  const pathsResult = await fs.readdirSync(directoryPath)
  const paths: string[] = Array.isArray(pathsResult) ? pathsResult : []
  const entries = await Promise.all(
    paths.map(async (path) => {
      const name = getFileName(path)
      try {
        const stat = await fs.fileStat(path)
        return {
          path,
          name,
          isDirectory: !!stat?.isDirectory,
          size: stat?.size,
        }
      } catch {
        return {
          path,
          name,
          isDirectory: false,
        }
      }
    })
  )

  return entries
    .filter(
      (entry) => !entry.isDirectory || !IGNORED_DIRECTORY_NAMES.has(entry.name)
    )
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

const DirectoryTreeNode = memo(function DirectoryTreeNode({
  entry,
  depth = 0,
  expanded = false,
  loading = false,
  onToggleExpand,
  onFileClick,
  onRevealFile,
}: {
  entry: DirectoryTreeEntry
  depth?: number
  expanded?: boolean
  loading?: boolean
  onToggleExpand: (path: string) => void
  onFileClick?: (path: string) => void
  onRevealFile: (path: string) => void
}) {
  const handleItemClick = async () => {
    if (entry.isDirectory) {
      onToggleExpand(entry.path)
    } else {
      if (onFileClick) {
        onFileClick(entry.path)
      } else {
        try {
          if (isPlatformTauri()) {
            const { openUrl } = await import('@tauri-apps/plugin-opener')
            const url = entry.path.startsWith('file://') ? entry.path : `file://${entry.path}`
            await openUrl(url)
          } else {
            toast.info('File opening is available in the desktop app.')
          }
        } catch (err) {
          console.error('Failed to open file:', err)
          toast.error('Failed to open file: ' + String(err))
        }
      }
    }
  }

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation()
    onRevealFile(entry.path)
  }

  const Icon = entry.isDirectory ? (expanded ? FolderOpen : Folder) : File

  return (
    <div className="group relative w-full">
      <button
        type="button"
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs pr-8',
          'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.375}rem` }}
        title={entry.path}
        onClick={handleItemClick}
      >
        {entry.isDirectory ? (
          loading ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronRight
              className={cn(
                'size-3 shrink-0 transition-transform',
                expanded && 'rotate-90'
              )}
            />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>

      {!entry.isDirectory && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-0.5 size-6 opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
          title="Reveal in Finder/Explorer"
          onClick={handleReveal}
        >
          <FolderOpen className="size-3" />
        </Button>
      )}
    </div>
  )
})

function getLanguageFromFileName(fileName: string | null): string {
  if (!fileName) return 'plaintext'
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'json':
      return 'json'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'rs':
    case 'rust':
      return 'rust'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'xml':
      return 'xml'
    case 'sql':
      return 'sql'
    default:
      return 'plaintext'
  }
}

type FlatTreeNode = {
  entry:
    | DirectoryTreeEntry
    | { isEmptyPlaceholder: boolean; path: string; name: string }
    | { isLoadingPlaceholder: boolean; path: string; name: string }
    | { isErrorPlaceholder: boolean; path: string; name: string; error: string }
  depth: number
}

function buildFlatList(
  path: string,
  depth: number,
  childrenMap: Record<string, DirectoryTreeEntry[]>,
  expandedSet: Set<string>,
  loadingSet: Set<string>,
  errorMap: Record<string, string>
): FlatTreeNode[] {
  const list: FlatTreeNode[] = []
  const children = childrenMap[path]
  if (!children) return list

  for (const child of children) {
    list.push({ entry: child, depth })

    if (child.isDirectory && expandedSet.has(child.path)) {
      if (loadingSet.has(child.path)) {
        list.push({
          entry: {
            isLoadingPlaceholder: true,
            path: `${child.path}::loading`,
            name: 'Loading',
          },
          depth: depth + 1,
        })
      } else if (errorMap[child.path]) {
        list.push({
          entry: {
            isErrorPlaceholder: true,
            path: `${child.path}::error`,
            name: 'Error',
            error: errorMap[child.path],
          },
          depth: depth + 1,
        })
      } else {
        const subChildren = childrenMap[child.path]
        if (subChildren === undefined) {
          list.push({
            entry: {
              isLoadingPlaceholder: true,
              path: `${child.path}::loading`,
              name: 'Loading',
            },
            depth: depth + 1,
          })
        } else if (subChildren.length === 0) {
          list.push({
            entry: {
              isEmptyPlaceholder: true,
              path: `${child.path}::empty`,
              name: 'Empty',
            },
            depth: depth + 1,
          })
        } else {
          list.push(
            ...buildFlatList(
              child.path,
              depth + 1,
              childrenMap,
              expandedSet,
              loadingSet,
              errorMap
            )
          )
        }
      }
    }
  }

  return list
}

const FilesSection = memo(function FilesSection({
  scope,
}: {
  scope: ModelToolsPanelScope
}) {
  const serviceHub = useServiceHub()
  const path = useWorkspaceDirectories((state) => state.getDirectory(scope))
  const canBrowseDirectories = isPlatformTauri()
  const effectivePath =
    path ??
    (canBrowseDirectories && scope.type === 'workspace' ? './' : undefined)

  // Central state for tree virtualization
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [directoryChildren, setDirectoryChildren] = useState<Record<string, DirectoryTreeEntry[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [previousWidth, setPreviousWidth] = useState<string | null>(null)

  const isDark = useTheme((state) => state.isDark)
  const sidePanelWidth = useChatSessionUiSelector((session) => session.sidePanelWidth)
  const { setSidePanelWidth } = useChatSessionUiActions()

  // Clear states and load root on path change
  useEffect(() => {
    if (!effectivePath) {
      setDirectoryChildren({})
      setExpandedPaths(new Set())
      setLoadingPaths(new Set())
      setDirectoryErrors({})
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setDirectoryChildren({})
    setExpandedPaths(new Set())
    setLoadingPaths(new Set())
    setDirectoryErrors({})

    readDirectoryEntries(effectivePath)
      .then((nextEntries) => {
        if (!cancelled) {
          setDirectoryChildren({ [effectivePath]: nextEntries })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Unable to read directory'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [effectivePath])

  // Refs for tracking state asynchronously in callbacks without triggering re-creation
  const stateRef = useRef({ directoryChildren, loadingPaths, expandedPaths })
  useEffect(() => {
    stateRef.current = { directoryChildren, loadingPaths, expandedPaths }
  }, [directoryChildren, loadingPaths, expandedPaths])

  const handleToggleExpand = useCallback(async (dirPath: string) => {
    const { directoryChildren: currentChildren, loadingPaths: currentLoading, expandedPaths: currentExpanded } = stateRef.current
    const isExpanding = !currentExpanded.has(dirPath)

    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (isExpanding) {
        next.add(dirPath)
      } else {
        next.delete(dirPath)
      }
      return next
    })

    if (isExpanding && !currentChildren[dirPath] && !currentLoading.has(dirPath)) {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.add(dirPath)
        return next
      })
      setDirectoryErrors((prev) => {
        const next = { ...prev }
        delete next[dirPath]
        return next
      })

      try {
        const nextEntries = await readDirectoryEntries(dirPath)
        setDirectoryChildren((prev) => ({
          ...prev,
          [dirPath]: nextEntries,
        }))
      } catch (err) {
        setDirectoryErrors((prev) => ({
          ...prev,
          [dirPath]: err instanceof Error ? err.message : 'Unable to read directory',
        }))
        // Store empty entries to mark it loaded but empty/failed
        setDirectoryChildren((prev) => ({
          ...prev,
          [dirPath]: [],
        }))
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(dirPath)
          return next
        })
      }
    }
  }, [])

  // Restore panel width on unmount if we expanded it
  useEffect(() => {
    return () => {
      if (previousWidth) {
        setSidePanelWidth(previousWidth)
      }
    }
  }, [previousWidth, setSidePanelWidth])

  const handleFileClick = useCallback(async (filePath: string) => {
    setSelectedFilePath(filePath)
    setFileLoading(true)
    setFileError(null)
    setFileContent('')

    // Save previous width if we haven't already saved it
    if (!previousWidth && sidePanelWidth !== '48rem') {
      setPreviousWidth(sidePanelWidth)
    }
    setSidePanelWidth('48rem')

    try {
      const { fs } = await import('@parlo-lab/core')
      const content = await fs.readFileSync(filePath, 'utf8')
      setFileContent(content)
    } catch (err) {
      console.error('Failed to read file:', err)
      setFileError('Could not load file content preview. You can open it in the system editor instead.')
    } finally {
      setFileLoading(false)
    }
  }, [previousWidth, sidePanelWidth, setSidePanelWidth])

  // Stabilize file click callback
  const handleFileClickRef = useRef(handleFileClick)
  useEffect(() => {
    handleFileClickRef.current = handleFileClick
  }, [handleFileClick])

  const stableHandleFileClick = useCallback((filePath: string) => {
    handleFileClickRef.current(filePath)
  }, [])

  const handleRevealFile = useCallback(async (filePath: string) => {
    try {
      await serviceHub.opener().revealItemInDir(filePath)
    } catch (err) {
      toast.error('Failed to reveal file: ' + String(err))
    }
  }, [serviceHub])

  const handleClosePreview = useCallback(() => {
    setSelectedFilePath(null)
    setFileContent('')
    setFileError(null)
    if (previousWidth) {
      setSidePanelWidth(previousWidth)
      setPreviousWidth(null)
    } else {
      setSidePanelWidth('20rem')
    }
  }, [previousWidth, setSidePanelWidth])

  const handleOpenInSystemEditor = useCallback(async () => {
    if (!selectedFilePath) return
    try {
      if (isPlatformTauri()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        const url = selectedFilePath.startsWith('file://') ? selectedFilePath : `file://${selectedFilePath}`
        await openUrl(url)
      } else {
        toast.info('File opening is available in the desktop app.')
      }
    } catch (err) {
      console.error('Failed to open file:', err)
      toast.error('Failed to open file: ' + String(err))
    }
  }, [selectedFilePath])

  // Build the flat list of visible elements
  const flatList = useMemo(() => {
    if (!effectivePath) return []
    return buildFlatList(
      effectivePath,
      0,
      directoryChildren,
      expandedPaths,
      loadingPaths,
      directoryErrors
    )
  }, [effectivePath, directoryChildren, expandedPaths, loadingPaths, directoryErrors])

  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: flatList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => FILE_TREE_ROW_HEIGHT,
    getItemKey: (index) => flatList[index]?.entry.path ?? index,
    overscan: FILE_TREE_OVERSCAN,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()

  const fileTreeColumn = (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", selectedFilePath ? "w-[240px] shrink-0" : "flex-1")}>
      <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] text-muted-foreground flex justify-between items-center min-w-0">
        <div className="truncate flex-1 min-w-0">
          <span className="font-medium text-foreground">Files</span>
          {' · '}
          {effectivePath ? (
            <span className="font-mono" title={effectivePath}>
              {getFileName(effectivePath)}
            </span>
          ) : (
            <span>None</span>
          )}
        </div>
      </div>

      <div 
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 relative animate-none"
      >
        {!canBrowseDirectories ? (
          <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            File browsing is available in the desktop app.
          </div>
        ) : !effectivePath ? (
          <div className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-md px-4 text-center text-sm text-muted-foreground">
            <Folder className="size-8 text-muted-foreground/50" />
            <span>
              Select a folder from the workspace bar below the chat input.
            </span>
          </div>
        ) : loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-3 text-sm text-destructive">{error}</div>
        ) : flatList.length ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualRows.map((virtualRow) => {
              const item = flatList[virtualRow.index]
              if (!item) return null
              const entry = item.entry

              if ('isEmptyPlaceholder' in entry) {
                return (
                  <div
                    key={entry.path}
                    data-index={virtualRow.index}
                    className="px-1.5 py-1 text-xs text-muted-foreground absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingLeft: `${item.depth * 0.75 + 0.375}rem`,
                      height: '28px',
                    }}
                  >
                    Empty
                  </div>
                )
              }

              if ('isLoadingPlaceholder' in entry) {
                return (
                  <div
                    key={entry.path}
                    data-index={virtualRow.index}
                    className="flex h-7 items-center gap-2 px-1.5 text-xs text-muted-foreground absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingLeft: `${item.depth * 0.75 + 0.375}rem`,
                      height: '28px',
                    }}
                  >
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    <span>Loading</span>
                  </div>
                )
              }

              if ('isErrorPlaceholder' in entry) {
                return (
                  <div
                    key={entry.path}
                    data-index={virtualRow.index}
                    className="truncate px-1.5 py-1 text-xs text-destructive absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingLeft: `${item.depth * 0.75 + 0.375}rem`,
                      height: '28px',
                    }}
                    title={entry.error}
                  >
                    {entry.error}
                  </div>
                )
              }

              return (
                <div
                  key={entry.path}
                  data-index={virtualRow.index}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: '28px',
                  }}
                >
                  <DirectoryTreeNode
                    entry={entry}
                    depth={item.depth}
                    expanded={expandedPaths.has(entry.path)}
                    loading={loadingPaths.has(entry.path)}
                    onToggleExpand={handleToggleExpand}
                    onFileClick={stableHandleFileClick}
                    onRevealFile={handleRevealFile}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="p-3 text-sm text-muted-foreground">
            Empty directory.
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 w-full gap-4 items-stretch">
      {selectedFilePath && (
        <>
          <div className="flex-1 min-w-0 h-full flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 border border-border/60 bg-muted/20 px-3 py-1.5 rounded-lg text-xs shrink-0">
              <span className="font-medium truncate text-foreground/80" title={selectedFilePath}>
                {getFileName(selectedFilePath)}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground rounded-md"
                  title="Open in system editor"
                  onClick={handleOpenInSystemEditor}
                >
                  <FolderOpen className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground rounded-md"
                  title="Close preview"
                  onClick={handleClosePreview}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-border/60 bg-card">
              {fileLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : fileError ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center gap-3 text-sm">
                  <span className="text-destructive text-xs">{fileError}</span>
                  <Button variant="outline" size="sm" onClick={handleOpenInSystemEditor}>
                    Open in System Editor
                  </Button>
                </div>
              ) : (
                <Editor
                  height="100%"
                  language={getLanguageFromFileName(selectedFilePath)}
                  theme={isDark ? 'vs-dark' : 'light'}
                  value={fileContent}
                  loading={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 11,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    domReadOnly: true,
                  }}
                />
              )}
            </div>
          </div>

          <div className="w-[1px] bg-border/60 shrink-0 h-full self-stretch" />
        </>
      )}

      {fileTreeColumn}
    </div>
  )
})

function ChatWorkspaceSection({ scope }: { scope: ModelToolsPanelScope }) {
  const path = useWorkspaceDirectories((state) => state.getDirectory(scope))

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-3">
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2">
          <Folder className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Workspace</h3>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Project, work location, and branch/worktree are configured in the
          workspace bar attached below the chat input.
        </p>
        {path ? (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground truncate">
            {path}
          </p>
        ) : null}
      </section>
    </div>
  )
}

function PlaceholderSection({
  section,
}: {
  section: ChatSidePanelSectionItem
}) {
  return (
    <section className="h-full min-h-0 overflow-y-auto rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2">
        <section.icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">{section.label}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This panel slot is reserved for the local agent workspace (Codex
        engine). It can attach repo files, run side conversations, surface
        review findings (via the dedicated git-diff Review tab -- always real
        `git diff`, agent only provides analysis on top), or open a runtime
        terminal without leaving chat.
      </p>
    </section>
  )
}

type GitReviewFile = {
  path: string
  status: string
  additions: number
  deletions: number
}

type GitReviewStatus = {
  cwd: string
  branch?: string
  additions: number
  deletions: number
  files: GitReviewFile[]
}

type CodexProcessTerminalSession = {
  handle: string
  label: string
  kind: 'process' | 'command'
  status: 'running' | 'exited' | 'unknown'
  createdAt: number
  lines: string[]
}

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readStringField = (value: unknown, key: string): string | undefined => {
  const record = readRecord(value)
  const field = record?.[key]
  return typeof field === 'string' ? field : undefined
}

const readBooleanField = (
  params: Record<string, unknown>,
  key: string
): boolean | undefined => {
  return typeof params[key] === 'boolean' ? params[key] : undefined
}

const readNumberField = (
  params: Record<string, unknown>,
  key: string
): number | undefined => {
  return typeof params[key] === 'number' && Number.isFinite(params[key])
    ? params[key]
    : undefined
}

const readStringArrayField = (
  params: Record<string, unknown>,
  key: string
): string[] | undefined => {
  const value = params[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

const readStringRecordField = (
  params: Record<string, unknown>,
  key: string
): Record<string, string | null> | undefined => {
  const value = readRecord(params[key])
  if (!value) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | null] =>
      typeof entry[1] === 'string' || entry[1] === null
  )
  return Object.fromEntries(entries)
}

const OPENAI_PLUGINS_MARKETPLACE_SOURCE = 'openai/plugins'
const OPENAI_PLUGINS_MARKETPLACE_SPARSE_PATHS = [
  '.agents',
  '.claude-plugin',
  'plugins',
]

const isOpenAiPluginsMarketplaceSource = (source: string): boolean => {
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^api\.github\.com\/repos\//, 'github.com/')
    .replace(/^www\./, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/u, '')
  return (
    normalized === OPENAI_PLUGINS_MARKETPLACE_SOURCE ||
    normalized.endsWith(`/${OPENAI_PLUGINS_MARKETPLACE_SOURCE}`)
  )
}

const getOpenAiPluginsSparsePaths = (source: string) =>
  isOpenAiPluginsMarketplaceSource(source)
    ? OPENAI_PLUGINS_MARKETPLACE_SPARSE_PATHS
    : undefined

const isMissingMarketplaceManifestError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const normalized = message.toLowerCase()
  return (
    normalized.includes('marketplace root does not contain a supported manifest') ||
    normalized.includes('marketplace root does not contain')
  )
}

const readPtySizeField = (
  params: Record<string, unknown>
): { rows: number; cols: number } | undefined => {
  const size = readRecord(params.size)
  const rows = size?.rows
  const cols = size?.cols
  return typeof rows === 'number' &&
    Number.isFinite(rows) &&
    typeof cols === 'number' &&
    Number.isFinite(cols)
    ? { rows, cols }
    : undefined
}

const readRequiredStringParam = (
  params: Record<string, unknown>,
  key: string,
  method: string
): string => {
  const value = readStringField(params, key)
  if (!value) throw new Error(`${key} is required for ${method}.`)
  return value
}

const toCodexStdinParams = (
  params: Record<string, unknown>,
  method: string
): { deltaBase64?: string; closeStdin?: boolean } => {
  const deltaBase64 = readStringField(params, 'deltaBase64')
  const closeStdin = readBooleanField(params, 'closeStdin')
  if (deltaBase64 == null && closeStdin == null) {
    throw new Error(`deltaBase64 or closeStdin is required for ${method}.`)
  }
  return {
    ...(deltaBase64 != null ? { deltaBase64 } : {}),
    ...(closeStdin != null ? { closeStdin } : {}),
  }
}

const toRequiredCodexPtySize = (
  params: Record<string, unknown>,
  method: string
): { rows: number; cols: number } => {
  const size = readPtySizeField(params)
  if (!size) throw new Error(`size with rows and cols is required for ${method}.`)
  return size
}

const toCodexFileSystemRemoveParams = (
  params: Record<string, unknown>
): CodexFileSystemRemoveParams => {
  const path = typeof params.path === 'string' ? params.path : ''
  if (!path) throw new Error('path is required for fs/remove.')
  return {
    path,
    ...(typeof params.recursive === 'boolean' ? { recursive: params.recursive } : {}),
    ...(typeof params.force === 'boolean' ? { force: params.force } : {}),
  }
}

const toCodexFileSystemCopyParams = (
  params: Record<string, unknown>
): CodexFileSystemCopyParams => {
  const sourcePath =
    typeof params.sourcePath === 'string'
      ? params.sourcePath
      : typeof params.from === 'string'
        ? params.from
        : ''
  const destinationPath =
    typeof params.destinationPath === 'string'
      ? params.destinationPath
      : typeof params.to === 'string'
        ? params.to
        : ''
  if (!sourcePath) throw new Error('sourcePath is required for fs/copy.')
  if (!destinationPath) throw new Error('destinationPath is required for fs/copy.')
  return {
    sourcePath,
    destinationPath,
    ...(typeof params.recursive === 'boolean' ? { recursive: params.recursive } : {}),
  }
}

const toCodexCommandExecParams = (
  params: Record<string, unknown>
): CodexCommandExecParams => {
  const command = readStringArrayField(params, 'command')
  if (!command?.length) {
    throw new Error('command must be a non-empty string array for command/exec.')
  }
  return {
    command,
    ...(typeof params.processId === 'string' ? { processId: params.processId } : {}),
    ...(typeof params.cwd === 'string' ? { cwd: params.cwd } : {}),
    ...(readStringRecordField(params, 'env') ? { env: readStringRecordField(params, 'env') } : {}),
    ...(readPtySizeField(params) ? { size: readPtySizeField(params) } : {}),
    ...(typeof params.permissionProfile === 'string'
      ? { permissionProfile: params.permissionProfile }
      : {}),
    ...(readNumberField(params, 'outputBytesCap') != null
      ? { outputBytesCap: readNumberField(params, 'outputBytesCap') }
      : {}),
    ...(readNumberField(params, 'timeoutMs') != null
      ? { timeoutMs: readNumberField(params, 'timeoutMs') }
      : {}),
    ...(readBooleanField(params, 'disableOutputCap') != null
      ? { disableOutputCap: readBooleanField(params, 'disableOutputCap') }
      : {}),
    ...(readBooleanField(params, 'disableTimeout') != null
      ? { disableTimeout: readBooleanField(params, 'disableTimeout') }
      : {}),
    ...(readBooleanField(params, 'tty') != null ? { tty: readBooleanField(params, 'tty') } : {}),
    ...(readBooleanField(params, 'streamStdin') != null
      ? { streamStdin: readBooleanField(params, 'streamStdin') }
      : {}),
    ...(readBooleanField(params, 'streamStdoutStderr') != null
      ? { streamStdoutStderr: readBooleanField(params, 'streamStdoutStderr') }
      : {}),
  }
}

const toCodexProcessSpawnParams = (
  params: Record<string, unknown>
): CodexProcessSpawnParams => {
  const command = readStringArrayField(params, 'command')
  if (!command?.length) {
    throw new Error('command must be a non-empty string array for process/spawn.')
  }
  const env = readStringRecordField(params, 'env')
  const size = readPtySizeField(params)
  const outputBytesCap = readNumberField(params, 'outputBytesCap')
  const timeoutMs = readNumberField(params, 'timeoutMs')
  return {
    command,
    ...(typeof params.processHandle === 'string'
      ? { processHandle: params.processHandle }
      : {}),
    ...(typeof params.cwd === 'string' ? { cwd: params.cwd } : {}),
    ...(env ? { env } : {}),
    ...(size ? { size } : {}),
    ...(outputBytesCap != null ? { outputBytesCap } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...(readBooleanField(params, 'tty') != null ? { tty: readBooleanField(params, 'tty') } : {}),
    ...(readBooleanField(params, 'streamStdin') != null
      ? { streamStdin: readBooleanField(params, 'streamStdin') }
      : {}),
    ...(readBooleanField(params, 'streamStdoutStderr') != null
      ? { streamStdoutStderr: readBooleanField(params, 'streamStdoutStderr') }
      : {}),
  }
}

const toCodexMcpToolCallParams = (
  params: Record<string, unknown>
): CodexMcpToolCallParams => {
  const server = typeof params.server === 'string' ? params.server : ''
  const tool =
    typeof params.tool === 'string'
      ? params.tool
      : typeof params.toolName === 'string'
        ? params.toolName
        : ''
  const toolArguments =
    params.arguments &&
    typeof params.arguments === 'object' &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : undefined
  const meta =
    params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
      ? (params._meta as Record<string, unknown>)
      : undefined

  if (!server) {
    throw new Error('server is required for mcpServer/tool/call.')
  }
  if (!tool) {
    throw new Error('tool or toolName is required for mcpServer/tool/call.')
  }

  return {
    ...(typeof params.threadId === 'string' ? { threadId: params.threadId } : {}),
    server,
    tool,
    ...(toolArguments ? { arguments: toolArguments } : {}),
    ...(meta ? { _meta: meta } : {}),
  }
}

function ReviewSection({ scope }: { scope?: ModelToolsPanelScope } = {}) {
  const serviceHub = useServiceHub()
  // Use the provided scope (e.g. the current agent/chat workspace) for the git review in this panel slot.
  // Falls back to the dedicated review workspace scope (same as the /review full page).
  const reviewScope: WorkspaceDirectoryScope = {
    id: 'review',
    type: 'workspace',
    label: 'Review',
  }
  const effectiveScope = scope ?? reviewScope
  const workspacePath = useWorkspaceDirectories((state) =>
    state.getDirectory(effectiveScope)
  )
  const setWorkspacePath = useWorkspaceDirectories(
    (state) => state.setDirectory
  )
  const [status, setStatus] = useState<GitReviewStatus | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [hideWhitespace, setHideWhitespace] = useState(false)

  // Live Codex app-server capabilities (skills/plugins/hooks) for the agent workspace.
  // Only functional when the current chat uses a codex provider (session exists).
  const [capLoading, setCapLoading] = useState(false)
  const [skills, setSkills] = useState<any>(null)
  const [plugins, setPlugins] = useState<any>(null)
  const [hooks, setHooks] = useState<any>(null)
  const [mcpStatus, setMcpStatus] = useState<any>(null)
  const [accountInfo, setAccountInfo] = useState<any>(null)
  const [accountRateLimits, setAccountRateLimits] = useState<any>(null)
  const [accountUsage, setAccountUsage] = useState<any>(null)
  const [accountLogin, setAccountLogin] = useState<any>(null)
  const [accountCreditsNudgeType, setAccountCreditsNudgeType] =
    useState('credits')
  const [remoteStatus, setRemoteStatus] = useState<any>(null)
  const [remotePairing, setRemotePairing] = useState<any>(null)
  const [remotePairingCode, setRemotePairingCode] = useState('')
  const [remotePairingStartParamsJson, setRemotePairingStartParamsJson] =
    useState('{}')
  const [remoteClientId, setRemoteClientId] = useState('')
  const [codexAdminSnapshot, setCodexAdminSnapshot] = useState<any>(null)
  const [codexMarketplaceSnapshot, setCodexMarketplaceSnapshot] =
    useState<any>(null)
  const [codexRuntimeSnapshot, setCodexRuntimeSnapshot] = useState<any>(null)
  const [codexMcpSnapshot, setCodexMcpSnapshot] = useState<any>(null)
  const [codexModelSnapshot, setCodexModelSnapshot] = useState<any>(null)
  const [codexRawRpcSnapshot, setCodexRawRpcSnapshot] = useState<any>(null)
  const [codexRawRpcMethod, setCodexRawRpcMethod] = useState('')
  const [codexRawRpcParams, setCodexRawRpcParams] = useState('{}')
  const [codexRawRpcCatalogFilter, setCodexRawRpcCatalogFilter] = useState('')
  const [codexPluginId, setCodexPluginId] = useState('')
  const [codexPluginSkillId, setCodexPluginSkillId] = useState('')
  const [codexMarketplaceName, setCodexMarketplaceName] = useState('')
  const [codexMarketplaceSource, setCodexMarketplaceSource] = useState('')
  const [codexMarketplaceFilter, setCodexMarketplaceFilter] = useState('')
  const [codexMarketplaceInstalledOnly, setCodexMarketplaceInstalledOnly] =
    useState(false)
  const [codexSkillConfigJson, setCodexSkillConfigJson] =
    useState('{"enabled":true}')
  const [codexConfigKeyPath, setCodexConfigKeyPath] = useState('model')
  const [codexFeatureEnablementJson, setCodexFeatureEnablementJson] =
    useState('{"remoteControl":true}')
  const [codexEnvironmentId, setCodexEnvironmentId] = useState('')
  const [codexEnvironmentExecUrl, setCodexEnvironmentExecUrl] = useState('')
  const [codexAdvancedReviewJson, setCodexAdvancedReviewJson] = useState(
    '{"target":{"type":"uncommittedChanges"},"delivery":"detached"}'
  )
  const [codexThreadReviewType, setCodexThreadReviewType] = useState<
    CodexReviewTarget['type']
  >('uncommittedChanges')
  const [codexThreadReviewDelivery, setCodexThreadReviewDelivery] =
    useState<'detached' | 'inline'>('detached')
  const [codexThreadReviewBranch, setCodexThreadReviewBranch] =
    useState('main')
  const [codexThreadMetadataJson, setCodexThreadMetadataJson] =
    useState('{"source":"jan"}')
  const [codexThreadSettingsJson, setCodexThreadSettingsJson] = useState(
    '{"approvalPolicy":"on-request"}'
  )
  const [codexThreadName, setCodexThreadNameInput] = useState('')
  const [codexThreadGoalObjective, setCodexThreadGoalObjective] = useState('')
  const [codexTargetTurnId, setCodexTargetTurnId] = useState('')
  const [codexTargetItemId, setCodexTargetItemId] = useState('')
  const [codexThreadActionParamsJson, setCodexThreadActionParamsJson] =
    useState('{}')
  const [codexTurnItemsLimit, setCodexTurnItemsLimit] = useState('50')
  const [codexInjectItemsJson, setCodexInjectItemsJson] = useState('[]')
  const [codexRealtimeText, setCodexRealtimeText] = useState('')
  const [codexRealtimeAudioBase64, setCodexRealtimeAudioBase64] = useState('')
  const [codexMcpServerName, setCodexMcpServerName] = useState('')
  const [codexMcpResourceUri, setCodexMcpResourceUri] = useState('')
  const [codexMcpToolName, setCodexMcpToolName] = useState('')
  const [codexMcpToolArguments, setCodexMcpToolArguments] = useState('{}')
  const [codexMcpDescriptorFilter, setCodexMcpDescriptorFilter] = useState('')
  const [codexRuntimePath, setCodexRuntimePath] = useState('')
  const [codexRuntimeCopyDestination, setCodexRuntimeCopyDestination] =
    useState('')
  const [codexRuntimeWatchId, setCodexRuntimeWatchId] = useState('')
  const [codexRuntimeSpawnCommand, setCodexRuntimeSpawnCommand] =
    useState('["pwd"]')
  const [codexRuntimeFileText, setCodexRuntimeFileText] = useState('')
  const [codexCommandExecParams, setCodexCommandExecParams] = useState(
    '{"command":["pwd"],"cwd":""}'
  )
  const [codexRuntimeStdin, setCodexRuntimeStdin] = useState('')
  const [codexRuntimePtySize, setCodexRuntimePtySize] = useState(
    '{"rows":24,"cols":80}'
  )
  const [codexProcessHandle, setCodexProcessHandle] = useState('')
  const [codexProcessTerminals, setCodexProcessTerminals] = useState<
    CodexProcessTerminalSession[]
  >([])
  const [codexProcessTerminalFilter, setCodexProcessTerminalFilter] =
    useState('')
  const [codexProcessTerminalExpanded, setCodexProcessTerminalExpanded] =
    useState(false)
  const [codexProcessTerminalRows, setCodexProcessTerminalRows] =
    useState('24')
  const [codexProcessTerminalCols, setCodexProcessTerminalCols] =
    useState('80')
  const [codexThreadId, setCodexThreadId] = useState('')
  const [codexThreadFilter, setCodexThreadFilter] = useState('')
  const [codexThreadSourceFilter, setCodexThreadSourceFilter] = useState<
    'all' | 'loaded' | 'stored'
  >('all')
  const [codexThreadSort, setCodexThreadSort] = useState<
    'updated' | 'name' | 'source'
  >('updated')
  const [codexLoadedThreads, setCodexLoadedThreads] = useState<any>(null)
  const [codexStoredThreads, setCodexStoredThreads] = useState<any>(null)
  const [codexThreadSnapshot, setCodexThreadSnapshot] = useState<any>(null)
  const [codexConversationSummary, setCodexConversationSummary] = useState<any>(null)
  const [codexGitDiffToRemote, setCodexGitDiffToRemote] = useState<any>(null)
  const [codexAuthStatus, setCodexAuthStatus] = useState<any>(null)
  const [codexThreadTurns, setCodexThreadTurns] = useState<any>(null)
  const [codexThreadTurnItems, setCodexThreadTurnItems] = useState<any>(null)
  const [codexThreadGoal, setCodexThreadGoalState] = useState<any>(null)
  const [capError, setCapError] = useState<string | null>(null)
  const [reviewStarting, setReviewStarting] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [adminBusy, setAdminBusy] = useState(false)
  const [marketplaceBusy, setMarketplaceBusy] = useState(false)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [modelAdminBusy, setModelAdminBusy] = useState(false)
  const [rawRpcBusy, setRawRpcBusy] = useState(false)
  const [threadBusy, setThreadBusy] = useState(false)
  const codexRuntimeLogs = useCodexAppServerRuntime((s) => s.logs)
  const codexProcessEvents = useCodexAppServerRuntime((s) => s.processEvents)
  const clearCodexRuntimeLogs = useCodexAppServerRuntime((s) => s.clearLogs)
  const clearCodexProcessEvents = useCodexAppServerRuntime(
    (s) => s.clearProcessEvents
  )
  const lastCodexProcessEventTimestampRef = useRef(0)

  const cwd = workspacePath || '.'

  const selectedFile = useMemo(
    () => status?.files.find((file) => file.path === selectedPath),
    [selectedPath, status?.files]
  )
  const account = accountInfo?.account
  const accountType = account?.type ?? accountInfo?.authMode ?? 'none'
  const accountEmail = account?.email
  const accountPlan = account?.planType ?? accountInfo?.planType
  const accountRequiresAuth = accountInfo?.requiresOpenaiAuth
  const targetCodexThreadId = codexThreadId.trim()
  const selectableCodexThreadIds = useMemo(
    () =>
      [
        ...collectCodexThreadIds(codexLoadedThreads),
        ...collectCodexThreadIds(codexStoredThreads),
      ].filter((id, index, values) => values.indexOf(id) === index),
    [codexLoadedThreads, codexStoredThreads]
  )
  const codexThreadDescriptors = useMemo(
    () =>
      [
        ...collectCodexThreadDescriptors(codexLoadedThreads, 'loaded'),
        ...collectCodexThreadDescriptors(codexStoredThreads, 'stored'),
      ].filter(
        (descriptor, index, values) =>
          values.findIndex((item) => item.id === descriptor.id) === index
      ),
    [codexLoadedThreads, codexStoredThreads]
  )
  const filteredCodexThreadDescriptors = useMemo(() => {
    const filter = codexThreadFilter.trim().toLowerCase()
    return [...codexThreadDescriptors]
      .filter((thread) => {
        if (
          codexThreadSourceFilter !== 'all' &&
          thread.source !== codexThreadSourceFilter
        ) {
          return false
        }
        if (!filter) return true
        return [thread.id, thread.name, thread.status, thread.updatedAt]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(filter))
      })
      .sort((a, b) => {
        if (codexThreadSort === 'name') {
          return (a.name ?? a.id).localeCompare(b.name ?? b.id)
        }
        if (codexThreadSort === 'source') {
          return a.source.localeCompare(b.source) || a.id.localeCompare(b.id)
        }
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
      })
  }, [
    codexThreadDescriptors,
    codexThreadFilter,
    codexThreadSort,
    codexThreadSourceFilter,
  ])
  const selectedCodexThreadSummary = useMemo(() => {
    if (!targetCodexThreadId) return null
    const descriptor = codexThreadDescriptors.find(
      (thread) => thread.id === targetCodexThreadId
    )
    return {
      id: targetCodexThreadId,
      name: descriptor?.name,
      source: descriptor?.source,
      status: descriptor?.status,
      updatedAt: descriptor?.updatedAt,
      turns: countCodexCollectionItems(codexThreadTurns),
      turnItems: countCodexCollectionItems(codexThreadTurnItems),
      goal: summarizeCodexValue(codexThreadGoal),
    }
  }, [
    codexThreadDescriptors,
    codexThreadGoal,
    codexThreadTurnItems,
    codexThreadTurns,
    targetCodexThreadId,
  ])
  const selectableCodexTurnIds = useMemo(
    () =>
      [
        ...collectCodexTurnIds(codexThreadSnapshot),
        ...collectCodexTurnIds(codexThreadTurns),
        ...collectCodexTurnIds(codexThreadTurnItems),
      ].filter((id, index, values) => values.indexOf(id) === index),
    [codexThreadSnapshot, codexThreadTurnItems, codexThreadTurns]
  )
  const selectableCodexItemIds = useMemo(
    () =>
      [
        ...collectCodexItemIds(codexThreadSnapshot),
        ...collectCodexItemIds(codexThreadTurns),
        ...collectCodexItemIds(codexThreadTurnItems),
      ].filter((id, index, values) => values.indexOf(id) === index),
    [codexThreadSnapshot, codexThreadTurnItems, codexThreadTurns]
  )
  const selectableCodexProcessHandles = useMemo(
    () =>
      [
        ...collectCodexProcessHandles(codexRuntimeSnapshot),
        ...collectCodexProcessHandles(codexThreadSnapshot),
        ...collectCodexProcessHandles(codexThreadTurns),
        ...collectCodexProcessHandles(codexThreadTurnItems),
      ].filter((id, index, values) => values.indexOf(id) === index),
    [
      codexRuntimeSnapshot,
      codexThreadSnapshot,
      codexThreadTurnItems,
      codexThreadTurns,
    ]
  )
  const selectedCodexProcessTerminal = useMemo(
    () =>
      codexProcessTerminals.find(
        (session) => session.handle === codexProcessHandle.trim()
      ) ?? codexProcessTerminals[0],
    [codexProcessHandle, codexProcessTerminals]
  )
  const filteredCodexProcessTerminalLines = useMemo(() => {
    const lines = selectedCodexProcessTerminal?.lines ?? []
    const filter = codexProcessTerminalFilter.trim().toLowerCase()
    if (!filter) return lines
    return lines.filter((line) => line.toLowerCase().includes(filter))
  }, [codexProcessTerminalFilter, selectedCodexProcessTerminal])
  const selectableCodexMcpServerNames = useMemo(
    () => collectCodexMcpServerNames(mcpStatus),
    [mcpStatus]
  )
  const selectableCodexMcpResourceUris = useMemo(
    () =>
      [
        ...collectCodexMcpResourceUris(mcpStatus),
        ...collectCodexMcpResourceUris(codexMcpSnapshot),
      ].filter((uri, index, values) => values.indexOf(uri) === index),
    [codexMcpSnapshot, mcpStatus]
  )
  const selectableCodexMcpToolNames = useMemo(
    () =>
      [
        ...collectCodexMcpToolNames(mcpStatus),
        ...collectCodexMcpToolNames(codexMcpSnapshot),
      ].filter((toolName, index, values) => values.indexOf(toolName) === index),
    [codexMcpSnapshot, mcpStatus]
  )
  const codexMcpResourceDescriptors = useMemo(
    () =>
      [
        ...collectCodexMcpResourceDescriptors(mcpStatus),
        ...collectCodexMcpResourceDescriptors(codexMcpSnapshot),
      ].filter(
        (descriptor, index, values) =>
          values.findIndex((item) => item.uri === descriptor.uri) === index
      ),
    [codexMcpSnapshot, mcpStatus]
  )
  const codexMcpToolDescriptors = useMemo(
    () =>
      [
        ...collectCodexMcpToolDescriptors(mcpStatus),
        ...collectCodexMcpToolDescriptors(codexMcpSnapshot),
      ].filter(
        (descriptor, index, values) =>
          values.findIndex((item) => item.name === descriptor.name) === index
      ),
    [codexMcpSnapshot, mcpStatus]
  )
  const filteredCodexMcpResourceDescriptors = useMemo(() => {
    const filter = codexMcpDescriptorFilter.trim().toLowerCase()
    if (!filter) return codexMcpResourceDescriptors
    return codexMcpResourceDescriptors.filter((descriptor) =>
      [
        descriptor.uri,
        descriptor.name,
        descriptor.description,
        descriptor.mimeType,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter))
    )
  }, [codexMcpDescriptorFilter, codexMcpResourceDescriptors])
  const filteredCodexMcpToolDescriptors = useMemo(() => {
    const filter = codexMcpDescriptorFilter.trim().toLowerCase()
    if (!filter) return codexMcpToolDescriptors
    return codexMcpToolDescriptors.filter((descriptor) =>
      [descriptor.name, descriptor.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter))
    )
  }, [codexMcpDescriptorFilter, codexMcpToolDescriptors])
  const selectedCodexMcpToolDescriptor = useMemo(
    () =>
      codexMcpToolDescriptors.find(
        (descriptor) => descriptor.name === codexMcpToolName.trim()
      ),
    [codexMcpToolDescriptors, codexMcpToolName]
  )
  const codexMcpToolArgumentValidation = useMemo(() => {
    if (!selectedCodexMcpToolDescriptor?.inputSchema) return []
    const parsed = parseCodexJson<Record<string, unknown>>(
      codexMcpToolArguments || '{}',
      {}
    )
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return ['Tool arguments JSON must be an object.']
    }
    try {
      return validateJsonAgainstSchema(
        selectedCodexMcpToolDescriptor.inputSchema,
        parsed
      )
    } catch (e) {
      return ['Tool arguments JSON parse failed: ' + String(e)]
    }
  }, [codexMcpToolArguments, selectedCodexMcpToolDescriptor])
  const selectableCodexPluginIds = useMemo(
    () => collectCodexPluginIds(codexMarketplaceSnapshot),
    [codexMarketplaceSnapshot]
  )
  const selectableCodexSkillIds = useMemo(
    () =>
      [
        ...collectCodexSkillIds(skills),
        ...collectCodexSkillIds(codexMarketplaceSnapshot),
      ].filter((id, index, values) => values.indexOf(id) === index),
    [codexMarketplaceSnapshot, skills]
  )
  const codexPluginDescriptors = useMemo(
    () => collectCodexPluginDescriptors(codexMarketplaceSnapshot),
    [codexMarketplaceSnapshot]
  )
  const codexMarketplaceDescriptors = useMemo(
    () => collectCodexMarketplaceDescriptors(codexMarketplaceSnapshot),
    [codexMarketplaceSnapshot]
  )
  const codexSkillDescriptors = useMemo(
    () =>
      [
        ...collectCodexSkillDescriptors(skills),
        ...collectCodexSkillDescriptors(codexMarketplaceSnapshot),
      ].filter(
        (descriptor, index, values) =>
          values.findIndex((item) => item.id === descriptor.id) === index
      ),
    [codexMarketplaceSnapshot, skills]
  )
  const filteredCodexPluginDescriptors = useMemo(() => {
    const filter = codexMarketplaceFilter.trim().toLowerCase()
    return codexPluginDescriptors.filter((plugin) => {
      if (codexMarketplaceInstalledOnly && !plugin.installed) return false
      if (!filter) return true
      return [plugin.id, plugin.name, plugin.description, plugin.version]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter))
    })
  }, [
    codexMarketplaceFilter,
    codexMarketplaceInstalledOnly,
    codexPluginDescriptors,
  ])
  const filteredCodexSkillDescriptors = useMemo(() => {
    const filter = codexMarketplaceFilter.trim().toLowerCase()
    return codexSkillDescriptors.filter((skill) => {
      if (!filter) return true
      return [skill.id, skill.name, skill.description, skill.pluginId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter))
    })
  }, [codexMarketplaceFilter, codexSkillDescriptors])
  const selectedCodexPluginDescriptor = useMemo(
    () =>
      codexPluginDescriptors.find(
        (plugin) => plugin.id === codexPluginId.trim()
      ),
    [codexPluginDescriptors, codexPluginId]
  )
  const selectedCodexPluginMetadataKeys = useMemo(() => {
    const raw = selectedCodexPluginDescriptor?.raw
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    return Object.keys(raw as Record<string, unknown>).sort()
  }, [selectedCodexPluginDescriptor])
  const selectedCodexSkillDescriptor = useMemo(
    () =>
      codexSkillDescriptors.find(
        (skill) => skill.id === codexPluginSkillId.trim()
      ),
    [codexSkillDescriptors, codexPluginSkillId]
  )
  const codexRawRpcCatalog = useMemo(
    () =>
      buildCodexRawRpcCatalog({
        codexMcpResourceUri,
        codexMcpServerName,
        codexMcpToolName,
      }),
    [
      codexMcpResourceUri,
      codexMcpServerName,
      codexMcpToolName,
    ]
  )
  const filteredCodexRawRpcCatalog = useMemo(() => {
    const filter = codexRawRpcCatalogFilter.trim().toLowerCase()
    if (!filter) return codexRawRpcCatalog
    return codexRawRpcCatalog.filter((item) =>
      [item.group, item.method, item.description]
        .some((value) => value.toLowerCase().includes(filter))
    )
  }, [codexRawRpcCatalog, codexRawRpcCatalogFilter])

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await invoke<GitReviewStatus>('git_review_status', {
        cwd,
      })
      setStatus(nextStatus)
      setSelectedPath((previous) => {
        if (
          previous &&
          nextStatus.files.some((file) => file.path === previous)
        ) {
          return previous
        }
        return nextStatus.files[0]?.path ?? null
      })
    } catch (err) {
      setStatus(null)
      setSelectedPath(null)
      setDiff('')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    // eslint-disable-next-line react-hooks.exhaustive-deps
  }, [cwd])

  useEffect(() => {
    if (!selectedPath) {
      setDiff('')
      return
    }

    void invoke<string>('git_review_diff', {
      cwd,
      path: selectedPath,
    })
      .then(setDiff)
      .catch((err) => {
        setDiff('')
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [cwd, selectedPath])

  const chooseWorkspace = async () => {
    const selection = await serviceHub.dialog().open({
      directory: true,
      multiple: false,
    })
    if (typeof selection === 'string' && selection.trim()) {
      setWorkspacePath(effectiveScope, selection)
    }
  }

  const statusLabelLocal = (status: string) => {
    if (status.includes('?')) return 'Untracked'
    if (status.includes('A')) return 'Added'
    if (status.includes('D')) return 'Deleted'
    if (status.includes('R')) return 'Renamed'
    if (status.includes('M')) return 'Modified'
    return status || 'Changed'
  }

  const copyGitApplyCommand = async () => {
    const fileArg = selectedPath ? ` -- ${selectedPath}` : ''
    await navigator.clipboard.writeText(
      `git -C "${cwd}" diff HEAD${fileArg} | git apply`
    )
    // toast if available, but in panel keep simple
  }

  // Drive Codex app-server capability layer from the review/agent workspace panel.
  // Uses the current Jan thread (if it has an active codex session) to call the
  // bridged RPCs. This makes skills/plugins/hooks first-class inspectable/manageable
  // from Jan's UI while Codex remains the engine.
  const currentThreadIdForCaps = useThreads((s) => s.currentThreadId)
  const refreshCodexCapabilities = async () => {
    if (!currentThreadIdForCaps) {
      setCapError('No active thread. Open a chat with a Codex provider profile to inspect runtime capabilities.')
      return
    }
    setCapLoading(true)
    setCapError(null)
    try {
      const [s, p, h, ip, mcp] = await Promise.all([
        listCodexSkills(currentThreadIdForCaps).catch((e) => ({ error: String(e) })),
        listCodexPlugins(currentThreadIdForCaps).catch((e) => ({ error: String(e) })),
        listCodexHooks(currentThreadIdForCaps).catch((e) => ({ error: String(e) })),
        listInstalledCodexPlugins(currentThreadIdForCaps).catch((e) => ({ error: String(e) })),
        listCodexMcpServerStatus(currentThreadIdForCaps).catch((e) => ({ error: String(e) })),
      ])
      setSkills(s)
      setPlugins({ all: p, installed: ip })
      setHooks(h)
      setMcpStatus(mcp)
    } catch (e) {
      setCapError(String(e))
    } finally {
      setCapLoading(false)
    }
  }

  const handleSetSkillExtraRoots = async () => {
    if (!currentThreadIdForCaps) return
    // Example: grant the workspace + one extra (user can extend in real usage)
    const roots = [cwd, ...(workspacePath ? [workspacePath] : [])]
    try {
      await setCodexSkillExtraRoots(currentThreadIdForCaps, roots)
      await refreshCodexCapabilities()
    } catch (e) {
      setCapError('set extra roots failed: ' + String(e))
    }
  }

  const refreshCodexAccount = async (refreshToken = false) => {
    if (!currentThreadIdForCaps) return
    setAccountBusy(true)
    setCapError(null)
    try {
      const [accountSnapshot, rateLimitSnapshot, usageSnapshot] =
        await Promise.all([
          readCodexAccount(currentThreadIdForCaps, refreshToken),
          readCodexAccountRateLimits(currentThreadIdForCaps).catch((e) => ({
            error: String(e),
          })),
          readCodexAccountUsage(currentThreadIdForCaps).catch((e) => ({
            error: String(e),
          })),
        ])
      setAccountInfo(accountSnapshot)
      setAccountRateLimits(rateLimitSnapshot)
      setAccountUsage(usageSnapshot)
    } catch (e) {
      setCapError('Account refresh failed: ' + String(e))
    } finally {
      setAccountBusy(false)
    }
  }

  const startDeviceCodeLogin = async (params?: Record<string, unknown>) => {
    if (!currentThreadIdForCaps) return
    setAccountBusy(true)
    setCapError(null)
    try {
      const normalizedParams =
        typeof params === 'object' && params !== null && !Array.isArray(params)
          ? params
          : {}
      const result = await startCodexAccountLogin(
        currentThreadIdForCaps,
        normalizedParams
      )
      setAccountLogin(result)
      toast.success('Codex login started')
    } catch (e) {
      setCapError('Account login failed: ' + String(e))
    } finally {
      setAccountBusy(false)
    }
  }

  const cancelDeviceCodeLogin = async () => {
    const loginId = accountLogin?.loginId
    if (!currentThreadIdForCaps || typeof loginId !== 'string') return
    setAccountBusy(true)
    setCapError(null)
    try {
      await cancelCodexAccountLogin(currentThreadIdForCaps, loginId)
      setAccountLogin(null)
      toast.success('Codex login cancelled')
    } catch (e) {
      setCapError('Cancel login failed: ' + String(e))
    } finally {
      setAccountBusy(false)
    }
  }

  const logoutCodex = async () => {
    if (!currentThreadIdForCaps) return
    setAccountBusy(true)
    setCapError(null)
    try {
      await logoutCodexAccount(currentThreadIdForCaps)
      await refreshCodexAccount(false)
      toast.success('Codex account signed out')
    } catch (e) {
      setCapError('Logout failed: ' + String(e))
    } finally {
      setAccountBusy(false)
    }
  }

  const runRemoteControlAction = async (
    action: () => Promise<unknown>,
    success?: string
  ) => {
    if (!currentThreadIdForCaps) return
    setRemoteBusy(true)
    setCapError(null)
    try {
      const result = await action()
      setRemoteStatus(result)
      if (success) toast.success(success)
    } catch (e) {
      setCapError('Remote control failed: ' + String(e))
    } finally {
      setRemoteBusy(false)
    }
  }

  const refreshRemoteControlStatus = async () => {
    await runRemoteControlAction(
      () => readCodexRemoteControlStatus(currentThreadIdForCaps!),
      undefined
    )
  }

  const startRemoteControlPairing = async () => {
    if (!currentThreadIdForCaps) return
    setRemoteBusy(true)
    setCapError(null)
    try {
      const pairingParams = parseCodexJson<Record<string, unknown>>(
        remotePairingStartParamsJson || '{}',
        {}
      )
      if (
        typeof pairingParams !== 'object' ||
        pairingParams === null ||
        Array.isArray(pairingParams)
      ) {
        throw new Error('Remote pairing start params must be an object.')
      }
      const result = await startCodexRemoteControlPairing(
        currentThreadIdForCaps,
        pairingParams
      )
      setRemotePairing(result)
      const pairingCode =
        readStringField(result, 'pairingCode') ??
        readStringField(result, 'manualPairingCode') ??
        ''
      if (pairingCode) setRemotePairingCode(pairingCode)
      toast.success('Remote control pairing started')
    } catch (e) {
      setCapError('Remote pairing failed: ' + String(e))
    } finally {
      setRemoteBusy(false)
    }
  }

  const readRemoteControlPairing = async (params?: {
    pairingCode?: string
    manualPairingCode?: string
  }) => {
    const pairingCode =
      typeof params?.pairingCode === 'string'
        ? params.pairingCode.trim()
        : remotePairingCode.trim()
    const manualPairingCode =
      typeof params?.manualPairingCode === 'string'
        ? params.manualPairingCode.trim()
        : ''
    if (!currentThreadIdForCaps || (!pairingCode && !manualPairingCode)) return
    setRemoteBusy(true)
    setCapError(null)
    try {
      const result = await readCodexRemoteControlPairingStatus(
        currentThreadIdForCaps,
        {
          ...(pairingCode ? { pairingCode } : {}),
          ...(manualPairingCode ? { manualPairingCode } : {}),
        }
      )
      setRemotePairing(result)
    } catch (e) {
      setCapError('Remote pairing status failed: ' + String(e))
    } finally {
      setRemoteBusy(false)
    }
  }

  const refreshCodexAdminSnapshot = async () => {
    if (!currentThreadIdForCaps) return
    setAdminBusy(true)
    setCapError(null)
    try {
      const [
        config,
        requirements,
        permissionProfiles,
        collaborationModes,
        externalAgents,
      ] = await Promise.all([
        readCodexConfig(currentThreadIdForCaps).catch((e) => ({
          error: String(e),
        })),
        readCodexConfigRequirements(currentThreadIdForCaps).catch((e) => ({
          error: String(e),
        })),
        listCodexPermissionProfiles(currentThreadIdForCaps, { cwd }).catch(
          (e) => ({ error: String(e) })
        ),
        listCodexCollaborationModes(currentThreadIdForCaps).catch((e) => ({
          error: String(e),
        })),
        detectCodexExternalAgentConfig(currentThreadIdForCaps, {
          cwd,
        }).catch((e) => ({ error: String(e) })),
      ])
      setCodexAdminSnapshot({
        config,
        requirements,
        permissionProfiles,
        collaborationModes,
        externalAgents,
      })
    } catch (e) {
      setCapError('Config/admin refresh failed: ' + String(e))
    } finally {
      setAdminBusy(false)
    }
  }

  const refreshCodexMarketplaceSnapshot = async () => {
    if (!currentThreadIdForCaps) return
    setMarketplaceBusy(true)
    setCapError(null)
    try {
      const [pluginList, installedPlugins, skills, hooks, apps] =
        await Promise.all([
          listCodexPlugins(currentThreadIdForCaps, {
            includeDisabled: true,
          }).catch((e) => ({ error: String(e) })),
          listInstalledCodexPlugins(currentThreadIdForCaps, {
            suggestions: [],
          }).catch((e) => ({ error: String(e) })),
          listCodexSkills(currentThreadIdForCaps).catch((e) => ({
            error: String(e),
          })),
          listCodexHooks(currentThreadIdForCaps).catch((e) => ({
            error: String(e),
          })),
          listCodexApps(currentThreadIdForCaps).catch((e) => ({
            error: String(e),
          })),
        ])
      setCodexMarketplaceSnapshot({
        pluginList,
        installedPlugins,
        skills,
        hooks,
        apps,
      })
    } catch (e) {
      setCapError('Plugin/marketplace refresh failed: ' + String(e))
    } finally {
      setMarketplaceBusy(false)
    }
  }

  const addCodexMarketplaceWithRetry = async (
    params: Record<string, unknown>
  ): Promise<unknown> => {
    if (!currentThreadIdForCaps) {
      throw new Error('A current Codex-capable thread is required.')
    }
    try {
      return await addCodexMarketplace(currentThreadIdForCaps, params)
    } catch (error) {
      const source = typeof params.source === 'string' ? params.source : ''
      const sparsePaths = source ? (getOpenAiPluginsSparsePaths(source) ?? []) : []
      const supportsSparsePaths =
        Boolean(source) &&
        sparsePaths.length > 0
      const hasSparsePaths = Boolean(params.sparsePaths)
      if (!isMissingMarketplaceManifestError(error) || !supportsSparsePaths || !hasSparsePaths) {
        throw error
      }
      const { sparsePaths: _unusedSparsePaths, ...fullCloneParams } = params
      return await addCodexMarketplace(currentThreadIdForCaps, fullCloneParams)
    }
  }

  const runCodexMarketplaceAction = async (
    method: string,
    params: Record<string, unknown>,
    success: string
  ) => {
    if (!currentThreadIdForCaps) return
    setMarketplaceBusy(true)
    setCapError(null)
    try {
      let result: unknown
      if (method === 'plugin/install') {
        result = await installCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'plugin/uninstall') {
        result = await uninstallCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'plugin/read') {
        result = await readCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'plugin/skill/read') {
        result = await readCodexPluginSkill(currentThreadIdForCaps, params)
      } else if (method === 'marketplace/add') {
        result = await addCodexMarketplaceWithRetry(params)
      } else if (method === 'marketplace/remove') {
        const marketplaceName = typeof params.marketplaceName === 'string'
          ? params.marketplaceName
          : ''
        if (!marketplaceName) {
          throw new Error('marketplaceName is required.')
        }
        result = await removeCodexMarketplace(
          currentThreadIdForCaps,
          marketplaceName
        )
      } else if (method === 'marketplace/upgrade') {
        result = await upgradeCodexMarketplace(currentThreadIdForCaps, params)
      } else if (method === 'skills/config/write') {
        result = await writeCodexSkillConfig(currentThreadIdForCaps, params)
      } else {
        result = await callCodexAppServer(
          currentThreadIdForCaps,
          method,
          params
        )
      }
      if (method === 'marketplace/add') {
        const record = readRecord(result)
        const marketplaceName =
          (record &&
          typeof record.marketplaceName === 'string' &&
          record.marketplaceName.trim()) ||
          (typeof params.marketplaceName === 'string'
            ? params.marketplaceName.trim()
            : '')
        if (record?.alreadyAdded && marketplaceName) {
          await upgradeCodexMarketplace(
            currentThreadIdForCaps,
            { marketplaceName }
          ).catch((error) => {
            console.warn('Marketplace refresh upgrade step failed:', error)
          })
        }
      }
      setCodexMarketplaceSnapshot((previous: unknown) => ({
        ...(readRecord(previous) ?? {}),
        lastAction: { method, params, result },
      }))
      if (
        method === 'marketplace/add' ||
        method === 'marketplace/remove' ||
        method === 'marketplace/upgrade'
      ) {
        await refreshCodexMarketplaceSnapshot().catch((error) => {
          setCapError(`Marketplace refresh failed: ${String(error)}`)
        })
      }
      toast.success(success)
    } catch (e) {
      setCapError(`${method} failed: ${String(e)}`)
    } finally {
      setMarketplaceBusy(false)
    }
  }

  const runCodexRuntimeAction = async (
    method: string,
    params: Record<string, unknown>,
    success?: string
  ) => {
    if (!currentThreadIdForCaps) return null
    setRuntimeBusy(true)
    setCapError(null)
    try {
      let result: unknown
      if (method === 'fs/readDirectory') {
        const path = typeof params.path === 'string' ? params.path : ''
        if (!path) throw new Error('path is required.')
        result = await readCodexDirectory(currentThreadIdForCaps, path)
      } else if (method === 'fs/getMetadata') {
        const path = typeof params.path === 'string' ? params.path : ''
        if (!path) throw new Error('path is required.')
        result = await getCodexMetadata(currentThreadIdForCaps, path)
      } else if (method === 'fs/createDirectory') {
        const path = typeof params.path === 'string' ? params.path : ''
        if (!path) throw new Error('path is required.')
        const recursive =
          typeof params.recursive === 'boolean' ? params.recursive : undefined
        result = await createCodexDirectory(currentThreadIdForCaps, path, recursive)
      } else if (method === 'fs/remove') {
        result = await removeCodexFileSystemPath(
          currentThreadIdForCaps,
          toCodexFileSystemRemoveParams(params)
        )
      } else if (method === 'fs/copy') {
        result = await copyCodexFileSystemPath(
          currentThreadIdForCaps,
          toCodexFileSystemCopyParams(params)
        )
      } else if (method === 'fs/readFile') {
        const path = typeof params.path === 'string' ? params.path : ''
        if (!path) throw new Error('path is required.')
        result = await readCodexFile(currentThreadIdForCaps, path)
      } else if (method === 'fs/writeFile') {
        const path = typeof params.path === 'string' ? params.path : ''
        const dataBase64 =
          typeof params.dataBase64 === 'string' ? params.dataBase64 : undefined
        if (!path) throw new Error('path is required.')
        if (typeof dataBase64 !== 'string') throw new Error('dataBase64 is required.')
        result = await writeCodexFile(currentThreadIdForCaps, path, dataBase64)
      } else if (method === 'fs/watch') {
        const watchId = typeof params.watchId === 'string' ? params.watchId : ''
        const path = typeof params.path === 'string' ? params.path : ''
        if (!watchId || !path) throw new Error('watchId and path are required.')
        result = await watchCodexFileSystem(currentThreadIdForCaps, watchId, path)
      } else if (method === 'fs/unwatch') {
        const watchId = typeof params.watchId === 'string' ? params.watchId : ''
        if (!watchId) throw new Error('watchId is required.')
        result = await unwatchCodexFileSystem(currentThreadIdForCaps, watchId)
      } else if (method === 'command/exec') {
        result = await execCodexCommand(
          currentThreadIdForCaps,
          toCodexCommandExecParams(params)
        )
      } else if (method === 'process/spawn') {
        result = await spawnCodexProcess(
          currentThreadIdForCaps,
          toCodexProcessSpawnParams(params)
        )
      } else if (method === 'process/writeStdin') {
        const processHandle = readRequiredStringParam(
          params,
          'processHandle',
          method
        )
        result = await writeCodexProcessInput(
          currentThreadIdForCaps,
          processHandle,
          toCodexStdinParams(params, method)
        )
      } else if (method === 'command/stdin') {
        const processId = readRequiredStringParam(params, 'processId', method)
        result = await writeCodexCommandInput(
          currentThreadIdForCaps,
          processId,
          toCodexStdinParams(params, method)
        )
      } else if (method === 'process/resizePty') {
        const processHandle = readRequiredStringParam(
          params,
          'processHandle',
          method
        )
        const size = toRequiredCodexPtySize(params, method)
        result = await resizeCodexProcessTerminal(
          currentThreadIdForCaps,
          processHandle,
          size
        )
      } else if (method === 'command/resize') {
        const processId = readRequiredStringParam(params, 'processId', method)
        const size = toRequiredCodexPtySize(params, method)
        result = await resizeCodexCommandTerminal(
          currentThreadIdForCaps,
          processId,
          size
        )
      } else if (method === 'process/kill') {
        const processHandle = readRequiredStringParam(
          params,
          'processHandle',
          method
        )
        result = await killCodexProcess(currentThreadIdForCaps, processHandle)
      } else if (method === 'command/terminate') {
        const processId = readRequiredStringParam(params, 'processId', method)
        result = await terminateCodexCommand(currentThreadIdForCaps, processId)
      } else {
        result = await callCodexAppServer(
          currentThreadIdForCaps,
          method,
          params
        )
      }
      setCodexRuntimeSnapshot((previous: any) => ({
        ...(previous ?? {}),
        lastAction: { method, params, result },
      }))
      recordCodexRuntimeTerminalAction(method, params, result)
      if (success) toast.success(success)
      return result
    } catch (e) {
      setCapError(`${method} failed: ${String(e)}`)
      return null
    } finally {
      setRuntimeBusy(false)
    }
  }

  const appendCodexTerminalLines = useCallback((
    handle: string,
    lines: string[],
    patch: Partial<Omit<CodexProcessTerminalSession, 'handle' | 'lines'>> = {}
  ) => {
    if (!handle) return
    setCodexProcessTerminals((previous) => {
      const index = previous.findIndex((session) => session.handle === handle)
      if (index === -1) {
        return [
          {
            handle,
            label: patch.label ?? handle,
            kind: patch.kind ?? 'process',
            status: patch.status ?? 'unknown',
            createdAt: Date.now(),
            lines: lines.length ? lines : [`attached ${handle}`],
          },
          ...previous,
        ].slice(0, 8)
      }

      const next = [...previous]
      const existing = next[index]
      next[index] = {
        ...existing,
        ...patch,
        lines: [...existing.lines, ...lines].slice(-400),
      }
      return next
    })
  }, [])

  const extractCodexRuntimeHandle = (
    params: Record<string, unknown>,
    result: unknown
  ) => {
    const resultRecord =
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : {}
    const paramHandle =
      typeof params.processHandle === 'string'
        ? params.processHandle
        : typeof params.processId === 'string'
          ? params.processId
          : ''
    return (
      (typeof resultRecord.processHandle === 'string' &&
        resultRecord.processHandle) ||
      (typeof resultRecord.processId === 'string' && resultRecord.processId) ||
      (typeof resultRecord.handle === 'string' && resultRecord.handle) ||
      paramHandle ||
      ''
    )
  }

  const codexRuntimeResultLines = (result: unknown) => {
    const lines: string[] = []
    if (!result || typeof result !== 'object') return lines
    const record = result as Record<string, unknown>
    for (const [key, label] of [
      ['stdout', 'stdout'],
      ['stderr', 'stderr'],
      ['output', 'output'],
    ] as const) {
      const value = record[key]
      if (typeof value === 'string' && value) lines.push(`${label}: ${value}`)
    }
    for (const [key, label] of [
      ['stdoutBase64', 'stdout'],
      ['stderrBase64', 'stderr'],
      ['deltaBase64', 'output'],
      ['dataBase64', 'data'],
    ] as const) {
      const value = record[key]
      if (typeof value === 'string' && value) {
        const decoded = decodeUtf8Base64(value)
        if (decoded) lines.push(`${label}: ${decoded}`)
      }
    }
    const exitCode =
      typeof record.exitCode === 'number'
        ? record.exitCode
        : typeof record.code === 'number'
          ? record.code
          : null
    if (exitCode !== null) lines.push(`exit ${exitCode}`)
    return lines
  }

  const recordCodexRuntimeTerminalAction = (
    method: string,
    params: Record<string, unknown>,
    result: unknown
  ) => {
    const handle = extractCodexRuntimeHandle(params, result)
    if (!handle) return

    const commandLabel =
      typeof params.command === 'string'
        ? params.command
        : Array.isArray(params.command)
          ? params.command.join(' ')
          : handle
    const lines = codexRuntimeResultLines(result)
    const isCommandMethod = method.startsWith('command/')
    const status =
      method === 'process/kill' || method === 'command/terminate'
        ? 'exited'
        : method === 'process/spawn' || method === 'command/exec'
          ? 'running'
          : 'unknown'

    if (method === 'process/writeStdin' || method === 'command/stdin') {
      const delta =
        typeof params.deltaBase64 === 'string'
          ? decodeUtf8Base64(params.deltaBase64)
          : ''
      if (delta) lines.unshift(`stdin: ${delta}`)
    }

    if (method === 'process/resizePty' || method === 'command/resize') {
      lines.unshift(`resize: ${JSON.stringify(params.size ?? {})}`)
    }

    if (method === 'process/spawn' || method === 'command/exec') {
      lines.unshift(`started: ${commandLabel}`)
    } else if (method === 'process/kill' || method === 'command/terminate') {
      lines.unshift('terminated')
    }

    appendCodexTerminalLines(handle, lines, {
      label: commandLabel,
      kind: isCommandMethod ? 'command' : 'process',
      status,
    })
  }

  useEffect(() => {
    const newEvents = codexProcessEvents.filter(
      (event) => event.timestamp > lastCodexProcessEventTimestampRef.current
    )
    if (!newEvents.length) return

    lastCodexProcessEventTimestampRef.current =
      newEvents[newEvents.length - 1]?.timestamp ??
      lastCodexProcessEventTimestampRef.current

    for (const event of newEvents) {
      const lines: string[] = []
      if (event.text) {
        lines.push(`[${event.stream}] ${event.text}`)
      }
      if (event.stdout) lines.push(`[stdout] ${event.stdout}`)
      if (event.stderr) lines.push(`[stderr] ${event.stderr}`)
      appendCodexTerminalLines(event.processHandle, lines, {
        label: event.processHandle,
        kind: 'process',
        status: typeof event.exitCode === 'number' ? 'exited' : 'running',
      })
    }
  }, [appendCodexTerminalLines, codexProcessEvents])

  const readCodexRuntimeFile = async () => {
    const path = codexRuntimePath.trim()
    if (!path) return
    const result = await runCodexRuntimeAction(
      'fs/readFile',
      { path },
      'Codex file read'
    )
    const dataBase64 = readStringField(result, 'dataBase64') ?? ''
    if (dataBase64) setCodexRuntimeFileText(decodeUtf8Base64(dataBase64))
  }

  const writeCodexRuntimeFile = async () => {
    const path = codexRuntimePath.trim()
    if (!path) return
    await runCodexRuntimeAction(
      'fs/writeFile',
      { path, dataBase64: encodeUtf8Base64(codexRuntimeFileText) },
      'Codex file written'
    )
  }

  const spawnCodexRuntimeProcess = async (commandPayload?: string) => {
    const command = (commandPayload ?? codexRuntimeSpawnCommand).trim()
    if (!command) return
    const commandValue: unknown = parseCodexJson<unknown>(command, command)
    const result = await runCodexRuntimeAction(
      'process/spawn',
      {
        command: commandValue,
        cwd,
        pty: true,
      },
      'Codex process spawned'
    )
    const handle =
      readStringField(result, 'processHandle') ??
      readStringField(result, 'handle') ??
      ''
    if (handle) setCodexProcessHandle(handle)
  }

  const runCodexMcpAction = async (
    method: string,
    params: Record<string, unknown>,
    success?: string
  ) => {
    if (!currentThreadIdForCaps) return null
    setMcpBusy(true)
    setCapError(null)
    try {
      let result: unknown
      if (method === 'mcpServer/resource/read') {
        result = await readCodexMcpResource(currentThreadIdForCaps, params)
      } else if (method === 'mcpServer/tool/call') {
        result = await callCodexMcpTool(
          currentThreadIdForCaps,
          toCodexMcpToolCallParams(params)
        )
      } else if (method === 'config/mcpServer/reload') {
        result = await reloadCodexMcpConfig(currentThreadIdForCaps, params)
      } else {
        result = await callCodexAppServer(
          currentThreadIdForCaps,
          method,
          params
        )
      }
      setCodexMcpSnapshot((previous: any) => ({
        ...(previous ?? {}),
        lastAction: { method, params, result },
      }))
      if (success) toast.success(success)
      return result
    } catch (e) {
      setCapError(`${method} failed: ${String(e)}`)
      return null
    } finally {
      setMcpBusy(false)
    }
  }

  const runCodexMcpOauthLogin = async () => {
    if (!currentThreadIdForCaps) return
    const server = codexMcpServerName.trim()
    if (!server) return
    try {
      await startCodexMcpOauthLogin(currentThreadIdForCaps, server)
      toast.success(`MCP OAuth login started for ${server}`)
      await refreshCodexCapabilities()
    } catch (e) {
      setCapError('MCP OAuth login failed: ' + String(e))
    }
  }

  const refreshCodexModelSnapshot = async () => {
    if (!currentThreadIdForCaps) return
    setModelAdminBusy(true)
    setCapError(null)
    try {
      const [models, providerCapabilities, experimentalFeatures] =
        await Promise.all([
          listCodexModels(currentThreadIdForCaps, {
            includeHidden: true,
          }).catch((e) => ({ error: String(e) })),
          readCodexModelProviderCapabilities(currentThreadIdForCaps, {}).catch(
            (e) => ({ error: String(e) })
          ),
          listCodexExperimentalFeatures(currentThreadIdForCaps, {}).catch((e) => ({
            error: String(e),
          })),
        ])
      setCodexModelSnapshot({
        models,
        providerCapabilities,
        experimentalFeatures,
      })
    } catch (e) {
      setCapError('Model/provider refresh failed: ' + String(e))
    } finally {
      setModelAdminBusy(false)
    }
  }

  const runCodexModelAction = async (
    method: string,
    params: Record<string, unknown>,
    success: string
  ) => {
    if (!currentThreadIdForCaps) return
    setModelAdminBusy(true)
    setCapError(null)
    try {
      let result: unknown
      if (method === 'experimentalFeature/enablement/set') {
        result = await setCodexExperimentalFeatureEnablement(
          currentThreadIdForCaps,
          params
        )
      } else if (method === 'environment/add') {
        result = await addCodexEnvironment(currentThreadIdForCaps, params)
      } else {
        result = await callCodexAppServer(
          currentThreadIdForCaps,
          method,
          params
        )
      }
      setCodexModelSnapshot((previous: any) => ({
        ...(previous ?? {}),
        lastAction: { method, params, result },
      }))
      toast.success(success)
    } catch (e) {
      setCapError(`${method} failed: ${String(e)}`)
    } finally {
      setModelAdminBusy(false)
    }
  }

  const runCodexRawRpc = async () => {
    const entered = codexRawRpcMethod.trim()
    if (!currentThreadIdForCaps || !entered) return
    const method = resolveCodexRawRpcMethod(entered)
    setRawRpcBusy(true)
    setCapError(null)
    try {
      const params = parseCodexJson<Record<string, unknown>>(
        codexRawRpcParams || '{}',
        {}
      )
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new Error('Raw RPC params must be an object.')
      }
      const readThreadId = (from: unknown) => {
        if (
          from &&
          typeof from === 'object' &&
          'threadId' in from &&
          typeof (from as { threadId?: unknown }).threadId === 'string'
        ) {
          return (from as { threadId: string }).threadId
        }
        return targetCodexThreadId ?? ''
      }

      const readThreadParams = (
        from: unknown
      ): Record<string, unknown> => {
        if (!from || typeof from !== 'object') {
          return {}
        }
        const { threadId: _, ...rest } = from as Record<string, unknown>
        return rest as Record<string, unknown>
      }

      const readRemotePairingCode = (from: unknown) => {
        if (typeof from === 'object' && from !== null) {
          const record = from as { manualPairingCode?: unknown; pairingCode?: unknown }
          if (typeof record.manualPairingCode === 'string') {
            return record.manualPairingCode
          }
          if (typeof record.pairingCode === 'string') {
            return record.pairingCode
          }
        }
        return undefined
      }

      let result: unknown

      if (method === 'thread/list') {
        result = await listCodexThreads(currentThreadIdForCaps, params)
      } else if (method === 'thread/read') {
        const threadId = readThreadId(params)
        if (!threadId) throw new Error('threadId is required for thread/read.')
        result = await readCodexThread(currentThreadIdForCaps, threadId, params)
      } else if (method === 'thread/loaded/list') {
        result = await listLoadedCodexThreads(currentThreadIdForCaps)
      } else if (method === 'thread/turns/list') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/turns/list.')
        }
        result = await listCodexThreadTurns(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/turns/items/list') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error(
            'threadId is required for thread/turns/items/list.'
          )
        }
        result = await listCodexThreadTurnItems(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/metadata/update') {
        const threadId = readThreadId(params)
        const metadata =
          typeof params.metadata === 'object' && params.metadata !== null
            ? (params.metadata as Record<string, unknown>)
            : readThreadParams(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/metadata/update.')
        }
        result = await updateCodexThreadMetadata(
          currentThreadIdForCaps,
          threadId,
          metadata
        )
      } else if (method === 'thread/settings/update') {
        const threadId = readThreadId(params)
        const settings =
          typeof params.settings === 'object' && params.settings !== null
            ? (params.settings as Record<string, unknown>)
            : readThreadParams(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/settings/update.')
        }
        result = await updateCodexThreadSettings(
          currentThreadIdForCaps,
          threadId,
          settings
        )
      } else if (method === 'thread/name/set') {
        const threadId = readThreadId(params)
        const name =
          typeof params.name === 'string'
            ? params.name
            : typeof params.threadName === 'string'
              ? params.threadName
              : ''
        if (!threadId) {
          throw new Error('threadId is required for thread/name/set.')
        }
        if (!name) {
          throw new Error('name is required for thread/name/set.')
        }
        result = await setCodexThreadName(currentThreadIdForCaps, threadId, name)
      } else if (method === 'thread/memoryMode/set') {
        const threadId = readThreadId(params)
        const memoryMode = readThreadParams(params).memoryMode
        if (!threadId) {
          throw new Error('threadId is required for thread/memoryMode/set.')
        }
        if (memoryMode !== 'enabled' && memoryMode !== 'disabled') {
          throw new Error(
            'memoryMode must be "enabled" or "disabled" for thread/memoryMode/set.'
          )
        }
        result = await setCodexThreadMemoryMode(
          currentThreadIdForCaps,
          threadId,
          memoryMode
        )
      } else if (method === 'thread/goal/set') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/goal/set.')
        }
        result = await setCodexThreadGoal(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/goal/get') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/goal/get.')
        }
        result = await getCodexThreadGoal(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/goal/clear') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/goal/clear.')
        }
        result = await clearCodexThreadGoal(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/fork') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/fork.')
        }
        result = await forkCodexThread(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/archive') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/archive.')
        }
        result = await archiveCodexThread(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/unarchive') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/unarchive.')
        }
        result = await unarchiveCodexThread(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/unsubscribe') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/unsubscribe.')
        }
        result = await unsubscribeCodexThread(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/interrupt') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/interrupt.')
        }
        result = await interruptCodexThreadTurn(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/compact/start') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/compact.')
        }
        result = await compactCodexThreadById(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/reload') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/reload.')
        }
        result = await reloadCodexThread(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/rollback') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/rollback.')
        }
        result = await rollbackCodexThreadById(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'review/start') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for review/start.')
        }
        result = await startCodexThreadReview(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/inject_items') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/inject_items.')
        }
        const items = Array.isArray(params.items) ? params.items : []
        result = await injectCodexThreadItems(
          currentThreadIdForCaps,
          threadId,
          items
        )
      } else if (method === 'thread/backgroundTerminals/clean') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error(
            'threadId is required for thread/backgroundTerminals/clean.'
          )
        }
        result = await cleanCodexBackgroundTerminals(
          currentThreadIdForCaps,
          threadId
        )
      } else if (method === 'thread/realtime/start') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/realtime/start.')
        }
        result = await startCodexThreadRealtime(
          currentThreadIdForCaps,
          threadId,
          readThreadParams(params)
        )
      } else if (method === 'thread/realtime/appendAudio') {
        const threadId = readThreadId(params)
        const audioBase64 =
          typeof params.audioBase64 === 'string'
            ? params.audioBase64
            : typeof params.audio === 'string'
              ? params.audio
              : ''
        if (!threadId) {
          throw new Error(
            'threadId is required for thread/realtime/appendAudio.'
          )
        }
        if (!audioBase64) {
          throw new Error(
            'audioBase64 is required for thread/realtime/appendAudio.'
          )
        }
        result = await appendCodexThreadRealtimeAudio(
          currentThreadIdForCaps,
          threadId,
          audioBase64
        )
      } else if (method === 'thread/realtime/appendText') {
        const threadId = readThreadId(params)
        const text =
          typeof params.text === 'string'
            ? params.text
            : typeof params.message === 'string'
              ? params.message
              : ''
        if (!threadId) {
          throw new Error('threadId is required for thread/realtime/appendText.')
        }
        if (!text) {
          throw new Error('text is required for thread/realtime/appendText.')
        }
        result = await appendCodexThreadRealtimeText(
          currentThreadIdForCaps,
          threadId,
          text
        )
      } else if (method === 'thread/realtime/stop') {
        const threadId = readThreadId(params)
        if (!threadId) {
          throw new Error('threadId is required for thread/realtime/stop.')
        }
        result = await stopCodexThreadRealtime(currentThreadIdForCaps, threadId)
      } else if (method === 'thread/memory/reset') {
        result = await resetCodexMemory(currentThreadIdForCaps)
      } else if (method === 'model/list') {
        result = await listCodexModels(currentThreadIdForCaps, params)
      } else if (method === 'modelProvider/capabilities/read') {
        result = await readCodexModelProviderCapabilities(
          currentThreadIdForCaps,
          params
        )
      } else if (method === 'experimentalFeature/list') {
        result = await listCodexExperimentalFeatures(
          currentThreadIdForCaps,
          params
        )
      } else if (method === 'config/read') {
        result = await readCodexConfig(currentThreadIdForCaps)
      } else if (method === 'config/value/write') {
        const keyPath =
          typeof params.keyPath === 'string'
            ? params.keyPath
                .split('.')
                .map((pathPart: string) => pathPart.trim())
                .filter(Boolean)
            : Array.isArray(params.keyPath)
              ? params.keyPath
                  .map((pathPart: unknown) =>
                    typeof pathPart === 'string'
                      ? pathPart.trim()
                      : String(pathPart ?? '').trim()
                  )
                  .filter(Boolean)
              : []
        if (!keyPath.length) {
          throw new Error('keyPath is required for config/value/write.')
        }
        result = await writeCodexConfigValue(
          currentThreadIdForCaps,
          keyPath,
          params.value
        )
      } else if (method === 'configRequirements/read') {
        result = await readCodexConfigRequirements(currentThreadIdForCaps)
      } else if (method === 'externalAgentConfig/detect') {
        result = await detectCodexExternalAgentConfig(
          currentThreadIdForCaps,
          params
        )
      } else if (method === 'externalAgentConfig/import') {
        result = await importCodexExternalAgentConfig(
          currentThreadIdForCaps,
          { ...params, cwd }
        )
      } else if (method === 'feedback/upload') {
        result = await uploadCodexFeedback(currentThreadIdForCaps, {
          ...params,
          cwd,
        })
      } else if (method === 'windowsSandbox/setupStart') {
        result = await startCodexWindowsSandbox(currentThreadIdForCaps, params)
      } else if (method === 'mcpServer/resource/read') {
        result = await readCodexMcpResource(currentThreadIdForCaps, params)
      } else if (method === 'mcpServer/tool/call') {
        result = await callCodexMcpTool(
          currentThreadIdForCaps,
          toCodexMcpToolCallParams(params)
        )
      } else if (method === 'mcpServerStatus/list') {
        result = await listCodexMcpServerStatus(currentThreadIdForCaps, params)
      } else if (method === 'mcpServer/oauth/login') {
        const server =
          typeof params.server === 'string'
            ? params.server
            : typeof params.provider === 'string'
              ? params.provider
              : ''
        if (!server) {
          throw new Error('server is required for mcpServer/oauth/login.')
        }
        result = await startCodexMcpOauthLogin(currentThreadIdForCaps, server)
      } else if (method === 'config/mcpServer/reload') {
        result = await reloadCodexMcpConfig(currentThreadIdForCaps, readThreadParams(params))
      } else if (method === 'permissionProfile/list') {
        result = await listCodexPermissionProfiles(currentThreadIdForCaps, params)
      } else if (method === 'collaborationMode/list') {
        result = await listCodexCollaborationModes(currentThreadIdForCaps)
      } else if (method === 'skills/list') {
        result = await listCodexSkills(currentThreadIdForCaps, params)
      } else if (method === 'skills/config/write') {
        result = await writeCodexSkillConfig(currentThreadIdForCaps, params)
      } else if (method === 'hooks/list') {
        result = await listCodexHooks(currentThreadIdForCaps)
      } else if (method === 'plugin/list') {
        result = await listCodexPlugins(currentThreadIdForCaps, params)
      } else if (method === 'plugin/installed') {
        result = await listInstalledCodexPlugins(currentThreadIdForCaps, params)
      } else if (method === 'plugin/read') {
        result = await readCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'plugin/skill/read') {
        result = await readCodexPluginSkill(currentThreadIdForCaps, params)
      } else if (method === 'plugin/install') {
        result = await installCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'plugin/uninstall') {
        result = await uninstallCodexPlugin(currentThreadIdForCaps, params)
      } else if (method === 'marketplace/add') {
        result = await addCodexMarketplaceWithRetry(params)
      } else if (method === 'marketplace/remove') {
        const marketplaceName =
          typeof params.marketplaceName === 'string'
            ? params.marketplaceName
            : ''
        if (!marketplaceName) {
          throw new Error('marketplaceName is required for marketplace/remove.')
        }
        result = await removeCodexMarketplace(
          currentThreadIdForCaps,
          marketplaceName
        )
      } else if (method === 'marketplace/upgrade') {
        result = await upgradeCodexMarketplace(currentThreadIdForCaps, params)
      } else if (method === 'app/list') {
        result = await listCodexApps(currentThreadIdForCaps, params)
      } else if (method === 'account/read') {
        const refreshToken =
          typeof params.refreshToken === 'boolean' ? params.refreshToken : false
        result = await readCodexAccount(currentThreadIdForCaps, refreshToken)
      } else if (method === 'account/login/start') {
        result = await startCodexAccountLogin(currentThreadIdForCaps, params)
      } else if (method === 'account/login/cancel') {
        const loginId =
          typeof params.loginId === 'string'
            ? params.loginId
            : typeof params.verificationCode === 'string'
              ? params.verificationCode
              : ''
        if (!loginId) {
          throw new Error('loginId is required for account/login/cancel.')
        }
        result = await cancelCodexAccountLogin(currentThreadIdForCaps, loginId)
      } else if (method === 'account/logout') {
        result = await logoutCodexAccount(currentThreadIdForCaps)
      } else if (method === 'account/rateLimits/read') {
        result = await readCodexAccountRateLimits(currentThreadIdForCaps)
      } else if (method === 'account/usage/read') {
        result = await readCodexAccountUsage(
          currentThreadIdForCaps,
          readThreadParams(params)
        )
      } else if (method === 'account/sendAddCreditsNudgeEmail') {
        const creditType = readThreadParams(params).creditType
        if (creditType !== 'credits' && creditType !== 'usage_limit') {
          throw new Error(
            'creditType must be "credits" or "usage_limit" for account/sendAddCreditsNudgeEmail.'
          )
        }
        result = await sendCodexAddCreditsNudgeEmail(
          currentThreadIdForCaps,
          creditType
        )
      } else if (method === 'process/kill') {
        const processHandle = readRequiredStringParam(
          params,
          'processHandle',
          method
        )
        result = await killCodexProcess(currentThreadIdForCaps, processHandle)
      } else if (method === 'remoteControl/enable') {
        result = await enableCodexRemoteControl(currentThreadIdForCaps)
      } else if (method === 'remoteControl/disable') {
        result = await disableCodexRemoteControl(currentThreadIdForCaps)
      } else if (method === 'remoteControl/status/read') {
        result = await readCodexRemoteControlStatus(currentThreadIdForCaps)
      } else if (method === 'remoteControl/pairing/start') {
        result = await startCodexRemoteControlPairing(
          currentThreadIdForCaps,
          readThreadParams(params)
        )
      } else if (method === 'remoteControl/pairing/status') {
        const pairingCode = readRemotePairingCode(params)
        result = await readCodexRemoteControlPairingStatus(
          currentThreadIdForCaps,
          {
            manualPairingCode: pairingCode,
          }
        )
      } else if (method === 'remoteControl/client/list') {
        result = await listCodexRemoteControlClients(
          currentThreadIdForCaps,
          readThreadParams(params)
        )
      } else if (method === 'remoteControl/client/revoke') {
        const clientId =
          typeof params.clientId === 'string'
            ? params.clientId
            : typeof params.client_id === 'string'
              ? params.client_id
              : ''
        if (!clientId) {
          throw new Error('clientId is required for remoteControl/client/revoke.')
        }
        result = await revokeCodexRemoteControlClient(
          currentThreadIdForCaps,
          clientId
        )
      } else {
        result = await callCodexAppServer(
          currentThreadIdForCaps,
          method,
          params
        )
      }
      setCodexRawRpcSnapshot({ method, params, result })
      toast.success(`Codex RPC completed: ${method}`)
    } catch (e) {
      setCapError('Raw Codex RPC failed: ' + String(e))
    } finally {
      setRawRpcBusy(false)
    }
  }

  const parseCodexRawRpcPresetJson = (value: string, fallback: unknown) => {
    const parseFailed = { marker: 'raw-rpc-preset-parse-failed' }
    const parsed = parseCodexJson<unknown>(value, parseFailed)
    if (parsed === parseFailed) {
      setCapError('Raw RPC preset JSON parse failed, using fallback value.')
      return fallback
    }
    return parsed
  }

  const refreshCodexThreads = async () => {
    if (!currentThreadIdForCaps) return
    setThreadBusy(true)
    setCapError(null)
    try {
      const [loaded, stored] = await Promise.all([
        listLoadedCodexThreads(currentThreadIdForCaps),
        listCodexThreads(currentThreadIdForCaps, {
          limit: 20,
          archived: false,
        }),
      ])
      setCodexLoadedThreads(loaded)
      setCodexStoredThreads(stored)

      const loadedRecord = readRecord(loaded)
      const loadedIds = Array.isArray(loadedRecord?.data)
        ? loadedRecord.data
        : Array.isArray(loadedRecord?.threadIds)
          ? loadedRecord.threadIds
          : []
      const firstLoadedId = loadedIds.find(
        (value: unknown) => typeof value === 'string'
      )
      if (!targetCodexThreadId && firstLoadedId) {
        setCodexThreadId(firstLoadedId)
      }
    } catch (e) {
      setCapError('Thread refresh failed: ' + String(e))
    } finally {
      setThreadBusy(false)
    }
  }

  const withTargetCodexThread = async (
    action: (threadId: string) => Promise<unknown>,
    success: string
  ) => {
    if (!currentThreadIdForCaps) {
      setCapError('Set an active Jan thread first.')
      return
    }
    if (!targetCodexThreadId) {
      setCapError('Set a Codex thread id first.')
      return
    }
    setThreadBusy(true)
    setCapError(null)
    try {
      const result = await action(targetCodexThreadId)
      setCodexThreadSnapshot(result)
      toast.success(success)
    } catch (e) {
      setCapError(String(e))
    } finally {
      setThreadBusy(false)
    }
  }

  const parseCodexThreadActionParams = () => {
    const paramsText = codexThreadActionParamsJson.trim() || '{}'
    let parsed: unknown
    try {
      parsed = JSON.parse(paramsText)
    } catch {
      setCapError('Thread action params JSON parse failed: invalid JSON.')
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setCapError('Thread action params JSON parse failed: must be an object.')
      return null
    }
    return parsed as Record<string, unknown>
  }

  const parseCodexThreadObjectParams = (
    payloadText: string,
    fieldLabel: string
  ): Record<string, unknown> | null => {
    const normalized = payloadText.trim() || '{}'
    let parsed: unknown
    try {
      parsed = JSON.parse(normalized)
    } catch {
      setCapError(`${fieldLabel} JSON parse failed: invalid JSON.`)
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setCapError(`${fieldLabel} JSON parse failed: must be an object.`)
      return null
    }
    return parsed as Record<string, unknown>
  }

  const parseCodexThreadInjectItems = (): unknown[] | null => {
    const injectText = codexInjectItemsJson.trim() || '[]'
    let parsed: unknown
    try {
      parsed = JSON.parse(injectText)
    } catch {
      setCapError('Thread inject items JSON parse failed: invalid JSON.')
      return null
    }
    if (!Array.isArray(parsed)) {
      setCapError('Thread inject items JSON parse failed: must be an array.')
      return null
    }
    return parsed
  }

  const runCodexThreadAction = async (
    action: () => Promise<unknown>,
    successMessage: string,
    onResult?: (result: unknown) => void
  ) => {
    if (!currentThreadIdForCaps) {
      setCapError('Set an active thread first.')
      return
    }
    setThreadBusy(true)
    setCapError(null)
    try {
      const result = await action()
      setCodexThreadSnapshot(result)
      onResult?.(result)
      toast.success(successMessage)
    } catch (e) {
      setCapError(`Thread action failed: ${String(e)}`)
    } finally {
      setThreadBusy(false)
    }
  }

  const readTargetCodexThread = async () => {
    await withTargetCodexThread(async (threadId) => {
      const [thread, turns, goal] = await Promise.all([
        readCodexThread(currentThreadIdForCaps!, threadId, {
          includeTurns: true,
        }),
        listCodexThreadTurns(currentThreadIdForCaps!, threadId, {
          limit: 20,
        }).catch((e) => ({ error: String(e) })),
        getCodexThreadGoal(currentThreadIdForCaps!, threadId).catch((e) => ({
          error: String(e),
        })),
      ])
      setCodexThreadTurns(turns)
      setCodexThreadGoalState(goal)
      return thread
    }, 'Codex thread loaded')
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card text-sm">
      <div className="flex h-9 items-center gap-1 border-b px-2 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void loadStatus()}
          disabled={loading}
          title="Refresh git review"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={chooseWorkspace}
          title="Choose workspace for review (git diff)"
        >
          <FolderOpen />
        </Button>
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground px-1">
          {workspacePath || 'No workspace'} • Git diff based
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" title="Review options">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => void loadStatus()}>
              <RefreshCw className="size-3.5" /> Refresh
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={wrap}
              onCheckedChange={(checked) => setWrap(!!checked)}
            >
              Word wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={collapsed}
              onCheckedChange={(checked) => setCollapsed(!!checked)}
            >
              Collapse diffs
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={hideWhitespace}
              onCheckedChange={(checked) => setHideWhitespace(!!checked)}
            >
              Hide whitespace
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copyGitApplyCommand}>
              Copy git apply command
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1 border-t">
        <aside className="w-48 shrink-0 flex flex-col border-r overflow-y-auto p-1 text-xs">
          {error ? (
            <div className="m-1 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
              {error}
            </div>
          ) : status?.files.length ? (
            status.files.map((file) => (
              <button
                key={file.path}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent truncate',
                  selectedPath === file.path && 'bg-accent'
                )}
                onClick={() => setSelectedPath(file.path)}
              >
                <span className="truncate flex-1">{file.path}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {statusLabelLocal(file.status)}
                </span>
              </button>
            ))
          ) : (
            <div className="m-2 text-muted-foreground text-center">
              No git changes.
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="h-8 flex items-center px-2 border-b text-[11px] text-muted-foreground shrink-0">
            {selectedFile ? selectedFile.path : 'Select file'}
            {selectedFile &&
              ` +${selectedFile.additions} -${selectedFile.deletions}`}
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-[#0a0a0a] text-[11px] font-mono p-2 whitespace-pre leading-tight">
            {collapsed
              ? 'Diff collapsed (panel)'
              : diff
                ? hideWhitespace
                  ? diff.replace(/[ \t]+$/gm, '')
                  : diff
                : loading
                  ? 'Loading git diff...'
                  : 'No diff selected.'}
          </div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground px-2 py-1 border-t shrink-0">
        Based on `git diff HEAD` • Review panel for agent workspace
      </div>

      <CodexReviewPanel
        currentThreadIdForCaps={currentThreadIdForCaps}
        reviewStarting={reviewStarting}
        setReviewStarting={setReviewStarting}
        codexAdvancedReviewJson={codexAdvancedReviewJson}
        onSetCodexAdvancedReviewJson={setCodexAdvancedReviewJson}
        onStartReview={startCodexReview}
      />

      {/* Codex app-server capability layer (skills / plugins / hooks / runtime management)
          surfaced in the authoritative agent workspace review panel.
          Git diff remains the only source of truth for changes; these are live
          inspectable capabilities the Codex engine currently has for this workspace
          (populated from the active codex session for the chat thread). */}
      <div className="p-2 border-t text-xs bg-muted/5">
        <div className="font-medium mb-1 flex items-center justify-between">
          <span>Codex Agent Capabilities (Skills / Plugins / Hooks)</span>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 border rounded hover:bg-accent disabled:opacity-50"
            onClick={() => void refreshCodexCapabilities()}
            disabled={capLoading || !currentThreadIdForCaps}
          >
            {capLoading ? 'Loading...' : 'Refresh from Codex session'}
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground mb-1">
          Runtime view via app-server (listSkills, listPlugins, listHooks, setSkillExtraRoots, install/uninstall etc).
          Static declaration happens via the Advanced config snippet in the active profile.
          These extend what the agent can do without changing the git diff.
        </div>
        {capError && <div className="text-destructive text-[10px] mb-1">{capError}</div>}
        <fieldset
          className={cn('contents')}
        >
        <ThreadsPanel
          state={{
            codexInjectItemsJson,
            codexLoadedThreads,
            codexRealtimeAudioBase64,
            codexRealtimeText,
            codexStoredThreads,
            codexTargetItemId,
            codexTargetTurnId,
            codexThreadDescriptors,
            codexThreadFilter,
            codexThreadGoal,
            codexThreadGoalObjective,
            codexThreadId,
            codexThreadMetadataJson,
            codexThreadName,
            codexThreadSettingsJson,
            codexThreadSnapshot,
            codexConversationSummary,
            codexGitDiffToRemote,
            codexAuthStatus,
            codexThreadSort,
            codexThreadSourceFilter,
            codexThreadTurnItems,
            codexThreadTurns,
            codexThreadActionParamsJson,
            codexTurnItemsLimit,
            currentThreadIdForCaps,
            filteredCodexThreadDescriptors,
            codexThreadReviewBranch,
            codexThreadReviewDelivery,
            codexThreadReviewType,
            selectedCodexThreadSummary,
            selectableCodexItemIds,
            selectableCodexThreadIds,
            selectableCodexTurnIds,
            targetCodexThreadId,
            threadBusy,
          }}
          actions={{
            onArchive: () =>
              void withTargetCodexThread(
                (threadId) => archiveCodexThread(currentThreadIdForCaps!, threadId),
                'Codex thread archived'
              ),
            onClearGoal: () =>
              void withTargetCodexThread(
                (threadId) => clearCodexThreadGoal(currentThreadIdForCaps!, threadId),
                'Codex goal cleared'
              ),
            onCompact: () =>
              void withTargetCodexThread(
                (threadId) => compactCodexThreadById(currentThreadIdForCaps!, threadId),
                'Codex thread compact requested'
              ),
            onCleanTerminals: () =>
              void withTargetCodexThread(
                async (threadId) => {
                  const result = await cleanCodexBackgroundTerminals(
                    currentThreadIdForCaps!,
                    threadId
                  )
                  setCodexProcessTerminals([])
                  clearCodexProcessEvents()
                  lastCodexProcessEventTimestampRef.current = Date.now()
                  setCodexProcessHandle('')
                  setCodexProcessTerminalFilter('')
                  return result
                },
                'Codex background terminals cleaned'
              ),
            onFork: () =>
              void withTargetCodexThread(
                (threadId) => forkCodexThread(currentThreadIdForCaps!, threadId, { ephemeral: false }),
                'Codex thread forked'
              ),
            onGetGoal: () =>
              void withTargetCodexThread(
                (threadId) => getCodexThreadGoal(currentThreadIdForCaps!, threadId),
                'Codex goal loaded'
              ),
            onInjectItems: () => {
              const items = parseCodexThreadInjectItems()
              if (!items) return
              void withTargetCodexThread(
                (threadId) => injectCodexThreadItems(currentThreadIdForCaps!, threadId, items),
                'Codex thread items injected'
              )
            },
            onSearchThreads: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => searchCodexThreads(currentThreadIdForCaps!, params),
                'Codex thread search requested'
              )
            },
            onStartThread: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => startCodexThread(currentThreadIdForCaps!, params),
                'Codex thread started'
              )
            },
            onResumeThread: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => resumeCodexThread(currentThreadIdForCaps!, params),
                'Codex thread resume requested'
              )
            },
            onStartTurn: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              const nextParams = {
                ...params,
                ...(targetCodexThreadId ? { threadId: targetCodexThreadId } : {}),
              }
              if (!targetCodexThreadId && typeof params.threadId !== 'string') {
                setCapError('Set a Codex thread id first or include threadId in action params.')
                return
              }
              void runCodexThreadAction(
                () => startCodexTurn(currentThreadIdForCaps!, nextParams),
                'Codex turn started'
              )
            },
            onListRealtimeVoices: () => {
              if (!targetCodexThreadId) {
                setCapError('Set a Codex thread id first.')
                return
              }
              void runCodexThreadAction(
                () =>
                  listCodexThreadRealtimeVoices(
                    currentThreadIdForCaps!,
                    targetCodexThreadId
                  ),
                'Codex thread realtime voices loaded'
              )
            },
            onApproveGuardianDeniedAction: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => approveCodexGuardianDeniedAction(currentThreadIdForCaps!, params),
                'Guardian denied action approved'
              )
            },
            onIncrementElicitation: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => incrementCodexThreadElicitation(currentThreadIdForCaps!, params),
                'Thread elicitation incremented'
              )
            },
            onDecrementElicitation: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => decrementCodexThreadElicitation(currentThreadIdForCaps!, params),
                'Thread elicitation decremented'
              )
            },
            onReadConversationSummary: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => readCodexConversationSummary(currentThreadIdForCaps!, params),
                'Codex conversation summary loaded',
                setCodexConversationSummary
              )
            },
            onReadGitDiffToRemote: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => readCodexGitDiffToRemote(currentThreadIdForCaps!, params),
                'Codex git diff to remote loaded',
                setCodexGitDiffToRemote
              )
            },
            onReadAuthStatus: () => {
              const params = parseCodexThreadActionParams()
              if (!params) return
              void runCodexThreadAction(
                () => readCodexAuthStatus(currentThreadIdForCaps!, params),
                'Codex auth status loaded',
                setCodexAuthStatus
              )
            },
            onInterrupt: () =>
              void withTargetCodexThread(
                (threadId) => interruptCodexThreadTurn(currentThreadIdForCaps!, threadId),
                'Codex turn interrupt requested'
              ),
            onMemoryOff: () =>
              void withTargetCodexThread(
                (threadId) => setCodexThreadMemoryMode(currentThreadIdForCaps!, threadId, 'disabled'),
                'Codex memory disabled'
              ),
            onMemoryOn: () =>
              void withTargetCodexThread(
                (threadId) => setCodexThreadMemoryMode(currentThreadIdForCaps!, threadId, 'enabled'),
                'Codex memory enabled'
              ),
            onMetadata: () => {
              const metadata = parseCodexThreadObjectParams(
                codexThreadMetadataJson,
                'Thread metadata'
              )
              if (!metadata) return
              void withTargetCodexThread(
                (threadId) =>
                  updateCodexThreadMetadata(
                    currentThreadIdForCaps!,
                    threadId,
                    metadata
                  ),
                'Codex thread metadata updated'
              )
            },
            onName: () => {
              const name = codexThreadName.trim()
              void withTargetCodexThread(
                (threadId) => setCodexThreadName(currentThreadIdForCaps!, threadId, name),
                'Codex thread renamed'
              )
            },
            onRead: () => void readTargetCodexThread(),
            onReadTurnItems: () =>
              void withTargetCodexThread(async (threadId) => {
                const parsedLimit = Number.parseInt(codexTurnItemsLimit, 10)
                const params: Record<string, unknown> = { threadId }
                if (codexTargetTurnId.trim()) params.turnId = codexTargetTurnId.trim()
                if (Number.isFinite(parsedLimit) && parsedLimit > 0) params.limit = parsedLimit
                const result = await listCodexThreadTurnItems(currentThreadIdForCaps!, threadId, params)
                setCodexThreadTurnItems(result)
                return result
              }, 'Codex turn items loaded'),
            onRealtimeAudio: () => {
              const audioBase64 = codexRealtimeAudioBase64.trim()
              if (!audioBase64) return
              void withTargetCodexThread(
                (threadId) => appendCodexThreadRealtimeAudio(currentThreadIdForCaps!, threadId, audioBase64),
                'Codex realtime audio appended'
              )
            },
            onRealtimeStart: () =>
              void withTargetCodexThread(
                (threadId) => startCodexThreadRealtime(currentThreadIdForCaps!, threadId),
                'Codex realtime started'
              ),
            onRealtimeStop: () =>
              void withTargetCodexThread(
                (threadId) => stopCodexThreadRealtime(currentThreadIdForCaps!, threadId),
                'Codex realtime stopped'
              ),
            onRealtimeText: () =>
              void withTargetCodexThread(
                (threadId) => appendCodexThreadRealtimeText(currentThreadIdForCaps!, threadId, codexRealtimeText),
                'Codex realtime text appended'
              ),
            onRefresh: () => void refreshCodexThreads(),
            onReload: () =>
              void withTargetCodexThread(
                (threadId) => reloadCodexThread(currentThreadIdForCaps!, threadId),
                'Codex thread reload requested'
              ),
            onResetMemory: () =>
              void withTargetCodexThread(
                () => resetCodexMemory(currentThreadIdForCaps!),
                'Codex memory reset'
              ),
            onReview: (params: Record<string, unknown> | undefined) => {
              const mergedParams =
                params ??
                parseCodexThreadObjectParams(
                  codexAdvancedReviewJson,
                  'Review params'
                )
              if (!mergedParams) return

              const normalizedParams = normalizeLegacyCodexReviewParams(
                mergedParams
              )

              void withTargetCodexThread(
                (threadId) =>
                  startCodexThreadReview(currentThreadIdForCaps!, threadId, normalizedParams),
                'Codex review requested'
              )
            },
            onRollback: () => {
              const params: Record<string, unknown> = {}
              if (codexTargetTurnId.trim()) params.turnId = codexTargetTurnId.trim()
              if (codexTargetItemId.trim()) params.itemId = codexTargetItemId.trim()
              void withTargetCodexThread(
                (threadId) => rollbackCodexThreadById(currentThreadIdForCaps!, threadId, params),
                'Codex rollback requested'
              )
            },
            onSetCodexThreadReviewBranch: setCodexThreadReviewBranch,
            onSetCodexThreadReviewDelivery: setCodexThreadReviewDelivery,
            onSetCodexThreadReviewType: setCodexThreadReviewType,
            onSetCodexInjectItemsJson: setCodexInjectItemsJson,
            onSetCodexRealtimeAudioBase64: setCodexRealtimeAudioBase64,
            onSetCodexRealtimeText: setCodexRealtimeText,
            onSetCodexTargetItemId: setCodexTargetItemId,
            onSetCodexTargetTurnId: setCodexTargetTurnId,
            onSetCodexThreadFilter: setCodexThreadFilter,
            onSetCodexThreadGoalObjective: setCodexThreadGoalObjective,
            onSetCodexThreadId: setCodexThreadId,
            onSetCodexThreadMetadataJson: setCodexThreadMetadataJson,
            onSetCodexThreadName: setCodexThreadNameInput,
            onSetCodexThreadSettingsJson: setCodexThreadSettingsJson,
            onSetCodexThreadSort: setCodexThreadSort,
            onSetCodexThreadSourceFilter: setCodexThreadSourceFilter,
            onSetCodexTurnItemsLimit: setCodexTurnItemsLimit,
            onSetCodexThreadActionParamsJson: setCodexThreadActionParamsJson,
            onSettings: () => {
              const settings = parseCodexThreadObjectParams(
                codexThreadSettingsJson,
                'Thread settings'
              )
              if (!settings) return
              void withTargetCodexThread(
                (threadId) =>
                  updateCodexThreadSettings(
                    currentThreadIdForCaps!,
                    threadId,
                    settings
                  ),
                'Codex thread settings updated'
              )
            },
            onSetGoal: () => {
              const objective = codexThreadGoalObjective.trim()
              if (!objective) return
              void withTargetCodexThread(
                (threadId) => setCodexThreadGoal(currentThreadIdForCaps!, threadId, { objective }),
                'Codex goal set'
              )
            },
            onTemplateInjectText: () =>
              setCodexInjectItemsJson(
                JSON.stringify(
                  [{ type: 'message', role: 'user', content: [{ type: 'text', text: codexRealtimeText }] }],
                  null,
                  2
                )
              ),
            onTemplateMetadata: () =>
              setCodexThreadMetadataJson(
                JSON.stringify(
                  { source: 'jan', workspace: cwd, updatedAt: new Date().toISOString() },
                  null,
                  2
                )
              ),
            onTemplateReviewBranch: () =>
              setCodexAdvancedReviewJson(
                JSON.stringify(
                  {
                    target: { type: 'baseBranch', branch: 'main' },
                    delivery: 'detached',
                  },
                  null,
                  2
                )
              ),
            onTemplateReviewUncommitted: () =>
              setCodexAdvancedReviewJson(
                JSON.stringify(
                  {
                    target: { type: 'uncommittedChanges' },
                    delivery: 'detached',
                  },
                  null,
                  2
                )
              ),
            onTemplateSettings: () =>
              setCodexThreadSettingsJson(
                JSON.stringify(
                  { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
                  null,
                  2
                )
              ),
            onUnarchive: () =>
              void withTargetCodexThread(
                (threadId) => unarchiveCodexThread(currentThreadIdForCaps!, threadId),
                'Codex thread unarchived'
              ),
            onUnsubscribe: () =>
              void withTargetCodexThread(
                (threadId) => unsubscribeCodexThread(currentThreadIdForCaps!, threadId),
                'Codex thread unsubscribed'
              ),
          }}
        />
        <AccountPanel
          state={{
            accountBusy,
            currentThreadIdForCaps,
            accountCreditsNudgeType,
            accountInfo,
            accountRateLimits,
            accountUsage,
            accountLogin,
            accountRequiresAuth,
            accountType,
            accountEmail,
            accountPlan,
          }}
          actions={{
            onSetAccountCreditsNudgeType: setAccountCreditsNudgeType,
            onSetCapError: setCapError,
            onSetAccountBusy: setAccountBusy,
            onRefreshCodexAccount: refreshCodexAccount,
            onStartDeviceCodeLogin: startDeviceCodeLogin,
            onCancelDeviceCodeLogin: cancelDeviceCodeLogin,
            onLogoutCodex: logoutCodex,
            onReadCodexAccountRateLimits: readCodexAccountRateLimits,
            onReadCodexAccountUsage: readCodexAccountUsage,
            onSendCodexAddCreditsNudgeEmail: sendCodexAddCreditsNudgeEmail,
            onSetAccountRateLimits: setAccountRateLimits,
            onSetAccountUsage: setAccountUsage,
          }}
        />
        <RemoteControlPanel
          state={{
            remoteBusy,
            currentThreadIdForCaps,
            remotePairingCode,
            remoteClientId,
            remotePairingStartParamsJson,
            remoteStatus,
            remotePairing,
          }}
          actions={{
            onSetRemotePairingCode: setRemotePairingCode,
            onSetRemoteClientId: setRemoteClientId,
            onSetRemotePairingStartParamsJson: setRemotePairingStartParamsJson,
            onRefreshRemoteControlStatus: refreshRemoteControlStatus,
            onRunRemoteControlAction: runRemoteControlAction,
            onStartRemoteControlPairing: startRemoteControlPairing,
            onReadRemoteControlPairing: readRemoteControlPairing,
            onEnableCodexRemoteControl: enableCodexRemoteControl,
            onDisableCodexRemoteControl: disableCodexRemoteControl,
            onListCodexRemoteControlClients: listCodexRemoteControlClients,
            onRevokeCodexRemoteControlClient: revokeCodexRemoteControlClient,
          }}
        />
        <ConfigAdminPanel
          state={{
            adminBusy,
            currentThreadIdForCaps,
            codexConfigKeyPath,
            codexAdminSnapshot,
            cwd,
          }}
          actions={{
            onSetCodexConfigKeyPath: setCodexConfigKeyPath,
            onSetCapError: setCapError,
            onSetAdminBusy: setAdminBusy,
            onRefreshCodexAdminSnapshot: refreshCodexAdminSnapshot,
            onWriteCodexConfigValue: writeCodexConfigValue,
            onWriteCodexConfigBatch: writeCodexConfigBatch,
            onUploadCodexFeedback: uploadCodexFeedback,
            onStartCodexWindowsSandbox: startCodexWindowsSandbox,
            onImportCodexExternalAgentConfig: importCodexExternalAgentConfig,
            onSetCodexAdminSnapshot: setCodexAdminSnapshot,
          }}
        />
        <ModelsProvidersFeaturesPanel
          state={{
            modelAdminBusy,
            currentThreadIdForCaps,
            codexFeatureEnablementJson,
            codexEnvironmentId,
            codexEnvironmentExecUrl,
            codexModelSnapshot,
          }}
          actions={{
            onSetCodexFeatureEnablementJson: setCodexFeatureEnablementJson,
            onSetCodexEnvironmentId: setCodexEnvironmentId,
            onSetCodexEnvironmentExecUrl: setCodexEnvironmentExecUrl,
            onSetCapError: setCapError,
            onRefreshCodexModelSnapshot: refreshCodexModelSnapshot,
            onRunCodexModelAction: runCodexModelAction,
          }}
        />
        <RawRpcTool
          state={{
            codexMcpServerName,
            codexMcpToolArguments,
            codexMcpToolName,
            codexRawRpcCatalog,
            codexRawRpcCatalogFilter,
            codexRawRpcMethod,
            codexRawRpcParams,
            codexRawRpcSnapshot,
            filteredCodexRawRpcCatalog,
            rawRpcBusy,
          }}
          actions={{
            parseCodexRawRpcPresetJson,
            runCodexRawRpc,
            setCodexRawRpcCatalogFilter,
            setCodexRawRpcMethod,
            setCodexRawRpcParams,
          }}
        />
        <CodexCliPanel cwd={cwd} />
        <PluginsMarketplaceTool
      state={{
        codexMarketplaceDescriptors,
        codexMarketplaceFilter,
        codexMarketplaceInstalledOnly,
        codexMarketplaceName,
        codexMarketplaceSnapshot,
        codexMarketplaceSource,
        codexPluginDescriptors,
        codexPluginId,
        codexPluginSkillId,
        codexSkillConfigJson,
        codexSkillDescriptors,
        currentThreadIdForCaps,
        filteredCodexPluginDescriptors,
        filteredCodexSkillDescriptors,
        marketplaceBusy,
        selectableCodexPluginIds,
        selectableCodexSkillIds,
        selectedCodexPluginDescriptor,
        selectedCodexPluginMetadataKeys,
        selectedCodexSkillDescriptor,
      }}
      actions={{
        onAddMarketplace: () => {
          const marketplaceSource = codexMarketplaceSource.trim()
          const sparsePaths =
            getOpenAiPluginsSparsePaths(marketplaceSource)
          void runCodexMarketplaceAction(
            'marketplace/add',
            {
              marketplaceName: codexMarketplaceName.trim(),
              source: marketplaceSource,
              ...(sparsePaths ? { sparsePaths } : {}),
            },
            'Codex marketplace added'
          )
        },
        onCopyPluginMetadata: async () => {
          if (!selectedCodexPluginDescriptor?.raw) return
          await navigator.clipboard.writeText(
            JSON.stringify(selectedCodexPluginDescriptor.raw, null, 2)
          )
          toast.success('Codex plugin metadata copied')
        },
        onInstallPlugin: () => {
          void runCodexMarketplaceAction(
            'plugin/install',
            {
              plugin: codexPluginId.trim(),
              pluginId: codexPluginId.trim(),
            },
            'Codex plugin install requested'
          )
        },
        onInstallSelectedPlugin: () => {
          if (!selectedCodexPluginDescriptor) return
          void runCodexMarketplaceAction(
            'plugin/install',
            {
              plugin: selectedCodexPluginDescriptor.id,
              pluginId: selectedCodexPluginDescriptor.id,
            },
            'Codex plugin install requested'
          )
        },
        onReadPlugin: () => {
          void runCodexMarketplaceAction(
            'plugin/read',
            {
              plugin: codexPluginId.trim(),
              pluginId: codexPluginId.trim(),
            },
            'Codex plugin metadata loaded'
          )
        },
        onReadPluginSkill: () => {
          void runCodexMarketplaceAction(
            'plugin/skill/read',
            {
              plugin: codexPluginId.trim(),
              pluginId: codexPluginId.trim(),
              skill: codexPluginSkillId.trim(),
              skillId: codexPluginSkillId.trim(),
            },
            'Codex plugin skill loaded'
          )
        },
        onReadSelectedPlugin: () => {
          if (!selectedCodexPluginDescriptor) return
          void runCodexMarketplaceAction(
            'plugin/read',
            {
              plugin: selectedCodexPluginDescriptor.id,
              pluginId: selectedCodexPluginDescriptor.id,
            },
            'Codex plugin metadata loaded'
          )
        },
        onReadSelectedSkill: () => {
          const skillId = selectedCodexSkillDescriptor?.id
          const pluginId =
            selectedCodexSkillDescriptor?.pluginId ||
            selectedCodexPluginDescriptor?.id
          if (!pluginId || !skillId) return
          void runCodexMarketplaceAction(
            'plugin/skill/read',
            {
              plugin: pluginId,
              pluginId,
              skill: skillId,
              skillId,
            },
            'Codex plugin skill loaded'
          )
        },
        onRefresh: () => {
          void refreshCodexMarketplaceSnapshot()
        },
        onRemoveMarketplace: () => {
          void runCodexMarketplaceAction(
            'marketplace/remove',
            { marketplaceName: codexMarketplaceName.trim() },
            'Codex marketplace removed'
          )
        },
        onSelectInstalledOnly: setCodexMarketplaceInstalledOnly,
        onSelectMarketplaceFilter: setCodexMarketplaceFilter,
        onSelectMarketplaceName: setCodexMarketplaceName,
        onSelectMarketplaceSource: setCodexMarketplaceSource,
        onSelectPluginId: setCodexPluginId,
        onSelectPluginSkillId: setCodexPluginSkillId,
        onSetSkillConfigJson: setCodexSkillConfigJson,
        onUninstallPlugin: () => {
          void runCodexMarketplaceAction(
            'plugin/uninstall',
            {
              plugin: codexPluginId.trim(),
              pluginId: codexPluginId.trim(),
            },
            'Codex plugin uninstall requested'
          )
        },
        onUninstallSelectedPlugin: () => {
          if (!selectedCodexPluginDescriptor) return
          void runCodexMarketplaceAction(
            'plugin/uninstall',
            {
              plugin: selectedCodexPluginDescriptor.id,
              pluginId: selectedCodexPluginDescriptor.id,
            },
            'Codex plugin uninstall requested'
          )
        },
        onUpgradeMarketplace: () => {
          void runCodexMarketplaceAction(
            'marketplace/upgrade',
            { marketplaceName: codexMarketplaceName.trim() },
            'Codex marketplace upgrade requested'
          )
        },
        onWriteSelectedSkillConfig: () => {
          const skillId = selectedCodexSkillDescriptor?.id
          if (!skillId) return
          try {
            void runCodexMarketplaceAction(
              'skills/config/write',
              {
                skill: skillId,
                skillId,
                config: parseCodexJson<Record<string, unknown>>(
                  codexSkillConfigJson || '{}',
                  {}
                ),
              },
              'Codex skill config written'
            )
          } catch (e) {
            setCapError('Skill config JSON parse failed: ' + String(e))
          }
        },
        onWriteSkillConfig: () => {
          try {
            void runCodexMarketplaceAction(
              'skills/config/write',
              {
                skill: codexPluginSkillId.trim(),
                skillId: codexPluginSkillId.trim(),
                config: parseCodexJson<Record<string, unknown>>(
                  codexSkillConfigJson || '{}',
                  {}
                ),
              },
              'Codex skill config written'
            )
          } catch (e) {
            setCapError('Skill config JSON parse failed: ' + String(e))
          }
        },
      }}
    />
        <RuntimeFsProcessPanel
          state={{
            codexCommandExecParams,
            codexProcessHandle,
            codexProcessTerminalCols,
            codexProcessTerminalExpanded,
            codexProcessTerminalFilter,
            codexProcessTerminalRows,
            codexProcessTerminals,
            codexRuntimeCopyDestination,
            codexRuntimeFileText,
            codexRuntimePath,
            codexRuntimePtySize,
            codexRuntimeSnapshot,
            codexRuntimeSpawnCommand,
            codexRuntimeStdin,
            codexRuntimeWatchId,
            currentThreadIdForCaps,
            cwd,
            filteredCodexProcessTerminalLines,
            runtimeBusy,
            selectableCodexProcessHandles,
            selectedCodexProcessTerminal,
          }}
          actions={{
            onAppendCodexTerminalLines: appendCodexTerminalLines,
            onClearCodexProcessEvents: () => {
              clearCodexProcessEvents()
              lastCodexProcessEventTimestampRef.current = Date.now()
            },
            onClearCodexProcessTerminals: () => setCodexProcessTerminals([]),
            onReadCodexRuntimeFile: readCodexRuntimeFile,
            onRunCodexRuntimeAction: runCodexRuntimeAction,
            onSetCapError: setCapError,
            onSetCodexCommandExecParams: setCodexCommandExecParams,
            onSetCodexProcessHandle: setCodexProcessHandle,
            onSetCodexProcessTerminalCols: setCodexProcessTerminalCols,
            onSetCodexProcessTerminalExpanded: setCodexProcessTerminalExpanded,
            onSetCodexProcessTerminalFilter: setCodexProcessTerminalFilter,
            onSetCodexProcessTerminalRows: setCodexProcessTerminalRows,
            onSetCodexRuntimeCopyDestination: setCodexRuntimeCopyDestination,
            onSetCodexRuntimeFileText: setCodexRuntimeFileText,
            onSetCodexRuntimePath: setCodexRuntimePath,
            onSetCodexRuntimePtySize: setCodexRuntimePtySize,
            onSetCodexRuntimeSnapshot: setCodexRuntimeSnapshot,
            onSetCodexRuntimeSpawnCommand: setCodexRuntimeSpawnCommand,
            onSetCodexRuntimeStdin: setCodexRuntimeStdin,
            onSetCodexRuntimeWatchId: setCodexRuntimeWatchId,
            onSpawnCodexRuntimeProcess: spawnCodexRuntimeProcess,
            onWriteCodexRuntimeFile: writeCodexRuntimeFile,
          }}
        />
        <McpPanel
          state={{
            codexMcpServerName,
            codexMcpResourceUri,
            codexMcpToolName,
            codexMcpToolArguments,
            codexMcpDescriptorFilter,
            mcpBusy,
            currentThreadIdForCaps,
            mcpStatus,
            codexMcpSnapshot,
            selectableCodexMcpServerNames,
            selectableCodexMcpResourceUris,
            selectableCodexMcpToolNames,
            codexMcpResourceDescriptors,
            codexMcpToolDescriptors,
            filteredCodexMcpResourceDescriptors,
            filteredCodexMcpToolDescriptors,
            selectedCodexMcpToolDescriptor,
            codexMcpToolArgumentValidation,
          }}
          actions={{
            onSetCodexMcpServerName: setCodexMcpServerName,
            onSetCodexMcpResourceUri: setCodexMcpResourceUri,
            onSetCodexMcpToolName: setCodexMcpToolName,
            onSetCodexMcpToolArguments: setCodexMcpToolArguments,
            onSetCodexMcpDescriptorFilter: setCodexMcpDescriptorFilter,
            onSetCapError: setCapError,
            onRunCodexMcpAction: runCodexMcpAction,
            onMcpOauthLogin: runCodexMcpOauthLogin,
          }}
        />
        <CodexSummaryCards
          skills={skills}
          plugins={plugins}
          hooks={hooks}
          currentThreadIdForCaps={currentThreadIdForCaps}
          onSetSkillExtraRoots={handleSetSkillExtraRoots}
          onSelectPluginId={setCodexPluginId}
          onSelectSkillId={setCodexPluginSkillId}
        />
        <AppServerRuntimeLogs
          codexRuntimeLogsLength={codexRuntimeLogs.length}
          runtimeLogsText={getCodexAppServerRuntimeLogs()}
          onClearCodexRuntimeLogs={clearCodexRuntimeLogs}
        />
        </fieldset>
      </div>
    </section>
  )
}

function BrowserSection({ isActive = true }: { isActive?: boolean }) {
  const previewRef = useRef<HTMLDivElement>(null)
  const sessionUi = useChatSessionUi()
  const sessionActions = useChatSessionUiActions()
  const addressInput = sessionUi.browserAddressInput
  const activeUrl = sessionUi.browserActiveUrl
  const setAddressInput = sessionActions.setBrowserAddressInput
  const setActiveUrl = sessionActions.setBrowserActiveUrl
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const registerTarget = useBrowserRuntime((state) => state.registerTarget)
  const updateTarget = useBrowserRuntime((state) => state.updateTarget)
  const target = useBrowserRuntime(
    (state) => state.targets[BROWSER_PANEL_TARGET_ID]
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const useNativePreview = isPlatformTauri()

  useEmbeddedBrowser(previewRef, activeUrl, isActive && useNativePreview)

  useEffect(() => {
    registerTarget({
      id: BROWSER_PANEL_TARGET_ID,
      label: 'Workspace browser',
      backend: 'in-app-preview',
      url: activeUrl ?? '',
      updatedAt: Date.now(),
      capabilities: {
        canNavigate: true,
        canInspectDom: false,
        canScreenshot: false,
        canAct: false,
      },
    })
  }, [activeUrl, registerTarget])

  useEffect(() => {
    updateTarget(BROWSER_PANEL_TARGET_ID, {
      url: activeUrl ?? '',
      title: activeUrl ?? undefined,
    })
  }, [activeUrl, updateTarget])

  const navigateToAddress = useCallback(() => {
    const normalized = normalizeBrowserAddress(addressInput)
    if (!normalized) {
      setActiveUrl(null)
      return
    }

    setActiveUrl(normalized)
    setAddressInput(normalized)
  }, [addressInput])

  const attachCurrentPage = async () => {
    if (!target?.url) return

    const allowed = await requestRuntimePermission({
      actionId: 'browser.attach-context',
      actionLabel: 'attach browser context to chat',
      category: 'browser',
      resourceLabel: target.title ?? target.url,
      risk: 'medium',
      details: {
        targetId: target.id,
        url: target.url,
        title: target.title,
        selectionKind: target.selection?.kind ?? 'page',
      },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (attachments) => [
      ...attachments,
      createBrowserSelectionAttachment({
        targetId: target.id,
        targetLabel: target.label,
        url: target.url,
        title: target.title,
        capturedAt: Date.now(),
        selection: target.selection ?? { kind: 'page' },
      }),
    ])

    toast.success('Browser context attached')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={addressInput}
          onChange={(event) => setAddressInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              navigateToAddress()
            }
          }}
          placeholder="Search or enter URL"
          className="h-8 text-sm"
        />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Go"
          title="Go"
          onClick={navigateToAddress}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!target?.url}
          aria-label="Attach browser context"
          title="Attach browser context"
          onClick={() => void attachCurrentPage()}
        >
          <Paperclip className="size-4" />
        </Button>
      </div>
      <div
        ref={previewRef}
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card"
      >
        {activeUrl ? (
          useNativePreview ? (
            <div className="h-full min-h-[320px] w-full bg-background" />
          ) : (
            <iframe
              title="Browser view"
              src={activeUrl}
              className="h-full min-h-[320px] w-full bg-background"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          )
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Search the web or enter a URL, then press Enter. Enable Jan
              Browser MCP from chat to browse with your signed-in sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextPickerSection({
  onOpenSection,
}: {
  onOpenSection: (section: string) => void
}) {
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const rememberedPermissions = useRuntimePermission(
    (state) => state.remembered
  )
  const permissionAudit = useRuntimePermission((state) => state.audit)
  const clearRememberedPermissions = useRuntimePermission(
    (state) => state.clearRemembered
  )
  const clearPermissionAudit = useRuntimePermission((state) => state.clearAudit)
  const revokeRememberedPermission = useRuntimePermission(
    (state) => state.revokeRemembered
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const browserTarget = useBrowserRuntime(
    (state) => state.targets[BROWSER_PANEL_TARGET_ID]
  )
  const activeSessionId = useTerminalRuntime((state) => state.activeSessionId)
  const activeSession = useTerminalRuntime((state) =>
    state.activeSessionId ? state.sessions[state.activeSessionId] : undefined
  )
  const sessionNames = useTerminalRuntime((state) => state.sessionNames)
  const codexAppServerLogCount = useCodexAppServerRuntime(
    (state) => state.logs.length
  )

  const normalizeContextContent = (content: string, maxChars = 12000) => {
    const trimmed = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    return trimmed.length > maxChars
      ? trimmed.slice(trimmed.length - maxChars)
      : trimmed
  }

  const getContextAttachmentLabel = (attachment: Attachment) => {
    if (attachment.type === 'document') return attachment.name
    if (attachment.type === 'browser-selection') {
      return (
        attachment.browserSelection?.title ||
        attachment.browserSelection?.url ||
        attachment.name
      )
    }
    if (attachment.type === 'terminal-output') {
      return attachment.terminalOutput
        ? `${attachment.terminalOutput.shell} · ${attachment.terminalOutput.captureMode}`
        : attachment.name
    }
    if (attachment.type === 'runtime-log') {
      return attachment.runtimeLog?.sourceLabel || attachment.name
    }
    if (attachment.type === 'process-list') {
      const count = attachment.processList?.processes.length ?? 0
      return `${attachment.processList?.sourceLabel || 'Processes'} · ${count}`
    }
    return attachment.name
  }

  const getContextAttachmentKind = (attachment: Attachment) => {
    if (attachment.type === 'document') return 'file'
    if (attachment.type === 'browser-selection') return 'browser'
    if (attachment.type === 'terminal-output') return 'terminal'
    if (attachment.type === 'runtime-log') return 'log'
    if (attachment.type === 'process-list') return 'processes'
    if (attachment.type === 'context-brief') return 'brief'
    return attachment.type
  }

  const buildContextBriefItem = useCallback((attachment: Attachment) => {
    const label = getContextAttachmentLabel(attachment)
    if (attachment.type === 'document') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          path: attachment.path,
          fileType: attachment.fileType,
          size: attachment.size,
        },
      }
    }
    if (attachment.type === 'browser-selection') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          url: attachment.browserSelection?.url,
          title: attachment.browserSelection?.title,
          selectionKind: attachment.browserSelection?.selection?.kind,
        },
      }
    }
    if (attachment.type === 'terminal-output') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          shell: attachment.terminalOutput?.shell,
          cwd: attachment.terminalOutput?.cwd,
          captureMode: attachment.terminalOutput?.captureMode,
          characters: attachment.terminalOutput?.content.length,
        },
      }
    }
    if (attachment.type === 'runtime-log') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          source: attachment.runtimeLog?.source,
          sourceLabel: attachment.runtimeLog?.sourceLabel,
          runtimeId: attachment.runtimeLog?.runtimeId,
          characters: attachment.runtimeLog?.content.length,
        },
      }
    }
    if (attachment.type === 'process-list') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          source: attachment.processList?.source,
          sourceLabel: attachment.processList?.sourceLabel,
          count: attachment.processList?.processes.length,
        },
      }
    }
    return {
      type: attachment.type,
      name: attachment.name,
      label,
    }
  }, [])

  const removeContextAttachment = (indexToRemove: number) => {
    setAttachmentsForThread(attachmentsKey, (current) =>
      current.filter((_, index) => index !== indexToRemove)
    )
  }

  const attachContextBrief = useCallback(async () => {
    const sourceItems = attachments.filter(
      (attachment) => attachment.type !== 'context-brief'
    )
    if (sourceItems.length === 0) {
      toast.info('Attach context before creating a brief')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'context.attach-brief',
      actionLabel: 'attach context inventory brief',
      category: 'app',
      resourceLabel: `${sourceItems.length} context item${sourceItems.length === 1 ? '' : 's'}`,
      risk: 'low',
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current.filter((attachment) => attachment.type !== 'context-brief'),
      createContextBriefAttachment({
        capturedAt: Date.now(),
        items: sourceItems.map(buildContextBriefItem),
      }),
    ])
    toast.success('Context brief attached')
  }, [
    attachments,
    attachmentsKey,
    buildContextBriefItem,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const attachFilesFromContext = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.attach-context',
      actionLabel: 'attach local files to chat',
      category: 'file',
      resourceLabel: 'file picker',
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      multiple: true,
      filters: [
        {
          name: 'Context files',
          extensions: ['*'],
        },
      ],
    })
    if (!selection) return

    const paths = Array.isArray(selection) ? selection : [selection]
    if (paths.length === 0) return

    const { fs } = await import('@parlo-lab/core')
    const prepared = await Promise.all(
      paths.map(async (path) => {
        const name = path.split(/[\\/]/).filter(Boolean).pop() || path
        const fileType = name.includes('.')
          ? name.split('.').pop()?.toLowerCase()
          : undefined
        let size: number | undefined
        try {
          const stat = await fs.fileStat(path)
          size = stat?.size ? Number(stat.size) : undefined
        } catch (error) {
          console.warn('Failed to read file size for context attachment', error)
        }
        return createDocumentAttachment({
          name,
          path,
          fileType,
          size,
          parseMode: 'auto',
        })
      })
    )

    let added = 0
    setAttachmentsForThread(attachmentsKey, (current) => {
      const existingPaths = new Set(
        current
          .filter((attachment) => attachment.type === 'document')
          .map((attachment) => attachment.path)
          .filter(Boolean)
      )
      const nextFiles = prepared.filter((attachment) => {
        if (!attachment.path || existingPaths.has(attachment.path)) return false
        existingPaths.add(attachment.path)
        return true
      })
      added = nextFiles.length
      return nextFiles.length > 0 ? [...current, ...nextFiles] : current
    })

    if (added > 0) {
      toast.success(`${added} file${added === 1 ? '' : 's'} attached`)
    } else {
      toast.info('Selected files are already attached')
    }
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachBrowserContext = useCallback(async () => {
    if (!browserTarget?.url) {
      onOpenSection('browser')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'browser.attach-context',
      actionLabel: 'attach browser context to chat',
      category: 'browser',
      resourceLabel: browserTarget.title ?? browserTarget.url,
      risk: 'medium',
      details: {
        targetId: browserTarget.id,
        url: browserTarget.url,
        title: browserTarget.title,
        selectionKind: browserTarget.selection?.kind ?? 'page',
      },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createBrowserSelectionAttachment({
        targetId: browserTarget.id,
        targetLabel: browserTarget.label,
        url: browserTarget.url,
        title: browserTarget.title,
        capturedAt: Date.now(),
        selection: browserTarget.selection ?? { kind: 'page' },
      }),
    ])
    toast.success('Browser context attached')
  }, [
    attachmentsKey,
    browserTarget,
    onOpenSection,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const attachTerminalScrollback = useCallback(async () => {
    if (!activeSession || !activeSessionId) {
      onOpenSection('terminal')
      return
    }

    const content = await invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal scrollback to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.attach-output',
      actionLabel: 'attach terminal output to chat',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        captureMode: 'scrollback',
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    const maxChars = 12000
    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createTerminalOutputAttachment({
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        cwd: activeSession.cwd,
        status: activeSession.status,
        exitCode: activeSession.exitCode,
        capturedAt: Date.now(),
        captureMode: 'scrollback',
        content:
          trimmedContent.length > maxChars
            ? trimmedContent.slice(trimmedContent.length - maxChars)
            : trimmedContent,
      }),
    ])
    toast.success('Terminal scrollback attached')
  }, [
    activeSession,
    activeSessionId,
    attachmentsKey,
    onOpenSection,
    requestRuntimePermission,
    sessionNames,
    setAttachmentsForThread,
  ])

  const attachAppLogs = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'logs.attach-app',
      actionLabel: 'attach app logs to chat',
      category: 'app',
      resourceLabel: 'app.log',
      risk: 'medium',
    })
    if (!allowed) return

    let content = ''
    try {
      content = await invoke<string>('read_logs')
    } catch (error) {
      toast.error('Failed to read app logs', {
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const normalized = normalizeContextContent(content)
    if (!normalized) {
      toast.info('No app logs to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createRuntimeLogAttachment({
        source: 'app',
        sourceLabel: 'App',
        capturedAt: Date.now(),
        content: normalized,
      }),
    ])
    toast.success('App logs attached')
  }, [attachmentsKey, requestRuntimePermission, setAttachmentsForThread])

  const attachStudioRuntimeLogs = useCallback(async () => {
    const processes = await serviceHub.studio().listRuntimeProcesses()
    if (processes.length === 0) {
      toast.info('No managed runtime logs to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'logs.attach-studio-runtime',
      actionLabel: 'attach managed runtime logs to chat',
      category: 'app',
      resourceLabel: `${processes.length} managed runtime${processes.length === 1 ? '' : 's'}`,
      risk: 'medium',
      details: {
        runtimes: processes.map((process) => ({
          runtimeId: process.runtimeId,
          pid: process.pid,
          model: process.model,
          baseUrl: process.baseUrl,
        })),
      },
    })
    if (!allowed) return

    const logBlocks: string[] = []
    for (const process of processes) {
      const raw = await serviceHub.studio().readRuntimeLogs(process.runtimeId)
      const normalized = normalizeContextContent(raw, 6000)
      if (!normalized) continue
      logBlocks.push(
        [
          `# ${process.runtimeId}`,
          `pid: ${process.pid}`,
          `model: ${process.model ?? 'unknown'}`,
          `base_url: ${process.baseUrl}`,
          normalized,
        ].join('\n')
      )
    }

    const content = normalizeContextContent(logBlocks.join('\n\n'), 16000)
    if (!content) {
      toast.info('No managed runtime logs to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createRuntimeLogAttachment({
        source: 'studio-runtime',
        sourceLabel: 'Managed runtime',
        runtimeId: 'all-managed-runtimes',
        capturedAt: Date.now(),
        content,
      }),
    ])
    toast.success('Managed runtime logs attached')
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachCodexAppServerLogs = useCallback(async () => {
    const logText = useCodexAppServerRuntime.getState().getLogText()
    if (!logText) {
      toast.info('No Codex app-server logs to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'logs.attach-codex-app-server',
      actionLabel: 'attach Codex app-server logs to chat',
      category: 'app',
      resourceLabel: `${codexAppServerLogCount} app-server log line${codexAppServerLogCount === 1 ? '' : 's'}`,
      risk: 'medium',
      details: {
        lines: codexAppServerLogCount,
      },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createRuntimeLogAttachment({
        source: 'codex-app-server',
        sourceLabel: 'Codex app-server',
        runtimeId: 'codex-app-server',
        capturedAt: Date.now(),
        content: normalizeContextContent(logText, 16000),
      }),
    ])
    toast.success('Codex app-server logs attached')
  }, [
    attachmentsKey,
    codexAppServerLogCount,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const attachRuntimeProcesses = useCallback(async () => {
    const studioProcesses = await serviceHub.studio().listRuntimeProcesses()
    const codexProcesses = await invoke<
      Array<{ sessionId: string; pid: number }>
    >('list_codex_app_server_processes')

    const processes = [
      ...studioProcesses.map((process) => ({
        kind: 'studio-runtime',
        runtimeId: process.runtimeId,
        pid: process.pid,
        model: process.model,
        baseUrl: process.baseUrl,
        logPath: process.logPath,
      })),
      ...codexProcesses.map((process) => ({
        kind: 'codex-app-server',
        sessionId: process.sessionId,
        pid: process.pid,
      })),
    ]

    if (processes.length === 0) {
      toast.info('No managed runtime processes to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'process.attach-managed',
      actionLabel: 'attach managed runtime process list to chat',
      category: 'app',
      resourceLabel: `${processes.length} managed process${processes.length === 1 ? '' : 'es'}`,
      risk: 'low',
      details: { count: processes.length },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createProcessListAttachment({
        source: 'studio-runtime',
        sourceLabel: 'Managed runtimes',
        capturedAt: Date.now(),
        processes,
      }),
    ])
    toast.success('Managed runtime processes attached')
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachSystemProcesses = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'process.attach-system',
      actionLabel: 'attach running process snapshot to chat',
      category: 'app',
      resourceLabel: 'system process list',
      risk: 'medium',
      details: {
        limit: 80,
      },
    })
    if (!allowed) return

    const processes = await invoke<
      Array<{ pid: number; name: string; command?: string | null }>
    >('list_running_processes', { limit: 80 })

    if (processes.length === 0) {
      toast.info('No running processes to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createProcessListAttachment({
        source: 'system-process',
        sourceLabel: 'System processes',
        capturedAt: Date.now(),
        processes,
      }),
    ])
    toast.success('Running process snapshot attached')
  }, [attachmentsKey, requestRuntimePermission, setAttachmentsForThread])

  const contextCounts = {
    files: attachments.filter((attachment) => attachment.type === 'document')
      .length,
    browser: attachments.filter(
      (attachment) => attachment.type === 'browser-selection'
    ).length,
    terminal: attachments.filter(
      (attachment) => attachment.type === 'terminal-output'
    ).length,
    logs: attachments.filter((attachment) => attachment.type === 'runtime-log')
      .length,
    processes: attachments.filter(
      (attachment) => attachment.type === 'process-list'
    ).length,
    briefs: attachments.filter(
      (attachment) => attachment.type === 'context-brief'
    ).length,
  }
  const rememberedPermissionKeys = Object.keys(rememberedPermissions)

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Workspace context
          </h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Attach the local evidence the agent should see. Attached items appear
          as chips in the composer and are injected into the next message.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>Files: {contextCounts.files}</span>
          <span>Browser: {contextCounts.browser}</span>
          <span>Terminal: {contextCounts.terminal}</span>
          <span>Logs: {contextCounts.logs}</span>
          <span>Processes: {contextCounts.processes}</span>
          <span>Briefs: {contextCounts.briefs}</span>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Runtime permissions
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {rememberedPermissionKeys.length === 0
                ? 'No local runtime actions are remembered.'
                : `${rememberedPermissionKeys.length} local action${rememberedPermissionKeys.length === 1 ? '' : 's'} remembered.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={rememberedPermissionKeys.length === 0}
            onClick={clearRememberedPermissions}
          >
            Reset
          </Button>
        </div>
        {rememberedPermissionKeys.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rememberedPermissionKeys.map((key) => (
              <button
                type="button"
                key={key}
                className="group flex max-w-full items-center gap-1 truncate rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={`Revoke ${key}`}
                onClick={() => revokeRememberedPermission(key)}
              >
                <span className="truncate">{key}</span>
                <X className="size-2.5 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Permission audit
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {permissionAudit.length === 0
                ? 'No local runtime permission decisions recorded.'
                : `${permissionAudit.length} recent decision${permissionAudit.length === 1 ? '' : 's'} recorded.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={permissionAudit.length === 0}
            onClick={clearPermissionAudit}
          >
            Clear
          </Button>
        </div>
        {permissionAudit.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {permissionAudit.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-foreground/5 px-2 py-1.5 text-xs"
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    entry.decision === 'deny'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  )}
                >
                  {entry.decision}
                </span>
                <span
                  className="min-w-0 truncate text-muted-foreground"
                  title={`${entry.actionLabel}${entry.resourceLabel ? ` · ${entry.resourceLabel}` : ''}`}
                >
                  {entry.actionLabel}
                  {entry.resourceLabel ? ` · ${entry.resourceLabel}` : ''}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(entry.decidedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Attached context
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {attachments.length === 0
                ? 'No context is attached to the next message.'
                : `${attachments.length} item${attachments.length === 1 ? '' : 's'} attached to the next message.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={attachments.length === 0}
            onClick={() => clearAttachmentsForThread(attachmentsKey)}
          >
            Clear
          </Button>
        </div>
        {attachments.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.type}-${index}-${attachment.name}`}
                className="flex items-center gap-2 rounded-md bg-foreground/5 px-2 py-1.5 text-xs"
              >
                <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {getContextAttachmentKind(attachment)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-muted-foreground"
                  title={getContextAttachmentLabel(attachment)}
                >
                  {getContextAttachmentLabel(attachment)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Remove context"
                  onClick={() => removeContextAttachment(index)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-2">
        <ContextSourceCard
          icon={Folder}
          title="Files"
          description="Attach local workspace files directly to the next message."
          actionLabel="Attach files"
          onAction={() => void attachFilesFromContext()}
        />
        <ContextSourceCard
          icon={Globe}
          title="Browser"
          description={
            browserTarget?.url
              ? browserTarget.url
              : 'Open a page first, then attach its page context.'
          }
          actionLabel={browserTarget?.url ? 'Attach page' : 'Open browser'}
          onAction={() => void attachBrowserContext()}
        />
        <ContextSourceCard
          icon={Terminal}
          title="Terminal"
          description={
            activeSession
              ? (sessionNames[activeSession.sessionId] ?? activeSession.shell)
              : 'Start or select a terminal session first.'
          }
          actionLabel={activeSession ? 'Attach scrollback' : 'Open terminal'}
          onAction={() => void attachTerminalScrollback()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="App logs"
          description="Attach the desktop app log tail for crashes, plugin errors, and local runtime diagnostics."
          actionLabel="Attach logs"
          onAction={() => void attachAppLogs()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Runtime logs"
          description="Attach logs from managed local model runtimes such as Ollama or vLLM."
          actionLabel="Attach runtime logs"
          onAction={() => void attachStudioRuntimeLogs()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Codex app-server logs"
          description={
            codexAppServerLogCount > 0
              ? `${codexAppServerLogCount} retained app-server log line${codexAppServerLogCount === 1 ? '' : 's'}`
              : 'Run a Codex-backed chat first, then attach app-server logs.'
          }
          actionLabel="Attach Codex logs"
          onAction={() => void attachCodexAppServerLogs()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Running runtimes"
          description="Attach the managed runtime and Codex app-server process snapshot."
          actionLabel="Attach processes"
          onAction={() => void attachRuntimeProcesses()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Running apps"
          description="Attach a bounded local process snapshot for debugging what is running on the desktop."
          actionLabel="Attach process list"
          onAction={() => void attachSystemProcesses()}
        />
        <ContextSourceCard
          icon={Paperclip}
          title="Context brief"
          description="Attach a structured inventory of the current files, browser, terminal, logs, and process context."
          actionLabel="Attach brief"
          onAction={() => void attachContextBrief()}
        />
      </div>
    </div>
  )
}

function ContextSourceCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: typeof Folder
  title: string
  description: string
  actionLabel: string
  onAction?: () => void
  disabled?: boolean
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 rounded-md"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </section>
  )
}

const PanelTabContent = memo(function PanelTabContent({
  type,
  scope,
  onOpenSection,
  panelActive = true,
}: {
  type: string
  scope: ModelToolsPanelScope
  onOpenSection: (section: string) => void
  panelActive?: boolean
}) {
  if (type.startsWith('terminal:')) {
    const sessionId = type.replace('terminal:', '')
    return <TerminalSection key={type} sessionId={sessionId} />
  }

  const section = getChatSidePanelSection(type as any)

  if (type === 'files') {
    return <FilesSection scope={scope} />
  }

  if (type === 'side-chat') {
    return <ChatWorkspaceSection scope={scope} />
  }

  if (type === 'context') {
    return <ContextPickerSection onOpenSection={onOpenSection} />
  }

  if (type === 'browser') {
    return <BrowserSection isActive={panelActive} />
  }

  if (type === 'terminal') {
    return <TerminalSection />
  }

  if (type === 'review') {
    return <ReviewSection scope={scope} />
  }

  return <PlaceholderSection section={section} />
})

const SidePanelTabBody = memo(function SidePanelTabBody({
  scope,
  activeSection,
  open,
  onOpenSection,
}: {
  scope: ModelToolsPanelScope
  activeSection: string
  open: boolean
  onOpenSection: (section: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 flex flex-col px-3 pb-5 pt-3 overflow-hidden">
      <PanelTabContent
        type={activeSection}
        scope={scope}
        onOpenSection={onOpenSection}
        panelActive={open && activeSection === 'browser'}
      />
    </div>
  )
})

export function ChatSidePanelAddMenuItems({
  onSelect,
  showSeparator = true,
  sectionItems = CHAT_SIDE_PANEL_DROPDOWN_SECTIONS,
}: {
  onSelect?: () => void
  showSeparator?: boolean
  sectionItems?: ChatSidePanelSectionItem[]
}) {
  const { setSidePanelActiveSection } = useChatSessionUiActions()

  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      {sectionItems.map((section) => {
        const Icon = section.icon
        return (
          <DropdownMenuItem
            key={section.id}
            onClick={() => {
              setSidePanelActiveSection(section.id)
              onSelect?.()
            }}
          >
            <Icon className="size-4 text-muted-foreground" />
            <span>{section.label}</span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

export function ModelToolsToggle() {
  const open = useChatSessionUiSelector((session) => session.sidePanelOpen)
  const { toggleSidePanelOpen } = useChatSessionUiActions()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      aria-label={open ? 'Close side panel' : 'Open side panel'}
      title={open ? 'Close side panel' : 'Open side panel'}
      onClick={toggleSidePanelOpen}
    >
      <IconLayoutSidebar className="size-4 scale-x-[-1] text-muted-foreground" />
    </Button>
  )
}

function BottomPanelToggle() {
  const open = useChatSessionUiSelector((session) => session.bottomPanelOpen)
  const { toggleBottomPanelOpen } = useChatSessionUiActions()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('rounded-full', open && 'bg-foreground/10 text-foreground')}
      aria-label={open ? 'Close bottom panel' : 'Open bottom panel'}
      aria-pressed={open}
      title={open ? 'Close bottom panel' : 'Open bottom panel'}
      onClick={toggleBottomPanelOpen}
    >
      <PanelBottom
        className={cn(
          'size-4',
          open ? 'text-foreground' : 'text-muted-foreground'
        )}
      />
    </Button>
  )
}

export function ModelToolsDock({
  scope = DEFAULT_PANEL_SCOPE,
}: {
  scope?: ModelToolsPanelScope
}) {
  return (
    <ChatSessionContext.Provider value={scope.sessionId}>
      <WorkspacePanelTitlebarControls />
      <ModelToolsPanel scope={scope} />
      <BottomWorkspacePanel />
    </ChatSessionContext.Provider>
  )
}

type SidePanelResizeContextValue = {
  effectiveWidth: string
  onResizeLive: (width: string) => void
  onResizeEnd: (width: string) => void
}

const SidePanelResizeContext =
  createContext<SidePanelResizeContextValue | null>(null)

export function WorkspacePanelsLayout({
  children,
  scope = DEFAULT_PANEL_SCOPE,
  className,
}: {
  children: ReactNode
  scope?: ModelToolsPanelScope
  className?: string
}) {
  return (
    <ChatSessionContext.Provider value={scope.sessionId}>
      <WorkspacePanelsLayoutInner scope={scope} className={className}>
        {children}
      </WorkspacePanelsLayoutInner>
    </ChatSessionContext.Provider>
  )
}

function WorkspacePanelsLayoutInner({
  children,
  scope = DEFAULT_PANEL_SCOPE,
  className,
}: {
  children: ReactNode
  scope?: ModelToolsPanelScope
  className?: string
}) {
  const sidePanelOpen = useChatSessionUiSelector((session) => session.sidePanelOpen)
  const persistedSidePanelWidth = useChatSessionUiSelector(
    (session) => session.sidePanelWidth
  )
  const { setSidePanelWidth } = useChatSessionUiActions()
  const [dragSidePanelWidth, setDragSidePanelWidth] = useState<string | null>(
    null
  )
  const sidePanelWidth = dragSidePanelWidth ?? persistedSidePanelWidth
  const isResizingSidePanel = dragSidePanelWidth !== null
  const bottomPanelOpen = useChatSessionUiSelector(
    (session) => session.bottomPanelOpen
  )
  const bottomPanelHeight = useChatSessionUiSelector(
    (session) => session.bottomPanelHeight
  )

  const onResizeLive = useCallback((width: string) => {
    setDragSidePanelWidth(width)
  }, [])

  const onResizeEnd = useCallback(
    (width: string) => {
      setSidePanelWidth(width)
      setDragSidePanelWidth(null)
    },
    [setSidePanelWidth]
  )

  const sidePanelResize = useMemo<SidePanelResizeContextValue>(
    () => ({
      effectiveWidth: sidePanelWidth,
      onResizeLive,
      onResizeEnd,
    }),
    [sidePanelWidth, onResizeLive, onResizeEnd]
  )

  return (
    <SidePanelResizeContext.Provider value={sidePanelResize}>
      <div
        className={cn(
          'grid h-full min-h-0 min-w-0 overflow-hidden',
          isResizingSidePanel
            ? 'transition-[grid-template-rows] duration-200 ease-out'
            : 'transition-[grid-template-columns,grid-template-rows] duration-200 ease-out',
          className
        )}
        style={{
          gridTemplateColumns: `minmax(0, 1fr) ${sidePanelOpen ? sidePanelWidth : '0rem'}`,
          gridTemplateRows: `minmax(0, 1fr) ${bottomPanelOpen ? bottomPanelHeight : '0rem'}`,
        }}
      >
        <WorkspacePanelTitlebarControls open={sidePanelOpen} />
        <div className="col-start-1 row-start-1 min-h-0 min-w-0 overflow-hidden">
          {children}
        </div>
        <ModelToolsPanel scope={scope} />
        <BottomWorkspacePanel />
      </div>
    </SidePanelResizeContext.Provider>
  )
}

function WorkspaceTitlebarLayer({
  children,
  className,
  style,
  hidden,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  hidden?: boolean
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'pointer-events-auto z-[var(--app-layer-workspace-titlebar-controls)]',
        className,
        hidden && 'pointer-events-none opacity-0'
      )}
      style={style}
      aria-hidden={hidden}
    >
      {children}
    </div>,
    document.body
  )
}

function WorkspacePanelTitlebarControls({ open }: { open?: boolean }) {
  const sidePanelOpen = useChatSessionUiSelector((session) => session.sidePanelOpen)
  const isSidePanelOpen = open ?? sidePanelOpen

  if (isSidePanelOpen) return null

  const needsPadding = isPlatformTauri() && !isPlatformMacOS()

  return (
    <WorkspaceTitlebarLayer
      className={cn(
        'fixed top-0 flex h-[var(--app-titlebar-height)] items-center gap-1 transition-opacity duration-150',
        needsPadding
          ? 'right-[calc(var(--app-titlebar-control-width)+0.5rem)]'
          : 'right-2'
      )}
    >
      <BottomPanelToggle />
      <ModelToolsToggle />
    </WorkspaceTitlebarLayer>
  )
}

function SidePanelResizeRail({
  width,
  onResize,
  onResizeEnd,
  onToggle,
}: {
  width: string
  onResize: (width: string) => void
  onResizeEnd: (width: string) => void
  onToggle: () => void
}) {
  const railRef = useRef<HTMLButtonElement>(null)
  const { dragRef, handleMouseDown } = useSidebarResize({
    direction: 'left',
    currentWidth: width,
    onResize,
    onResizeEnd,
    onToggle,
    isCollapsed: false,
    minResizeWidth: CHAT_SIDE_PANEL_MIN_WIDTH,
    maxResizeWidth: CHAT_SIDE_PANEL_MAX_WIDTH,
    enableAutoCollapse: false,
    enableToggle: false,
    isNested: true,
    widthCookieName: 'chat-side-panel:width',
    widthCookieMaxAge: 60 * 60 * 24 * 7,
  })

  const combinedRef = mergeButtonRefs([railRef, dragRef])

  return (
    <button
      ref={combinedRef}
      type="button"
      aria-label="Resize side panel"
      title="Drag to resize"
      onMouseDown={handleMouseDown}
      className={cn(
        'absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
        'hover:after:bg-border/80'
      )}
    />
  )
}

export function ModelToolsPanel({
  scope = DEFAULT_PANEL_SCOPE,
}: {
  scope?: ModelToolsPanelScope
}) {
  const sidePanelResize = useContext(SidePanelResizeContext)
  const open = useChatSessionUiSelector((session) => session.sidePanelOpen)
  const persistedWidth = useChatSessionUiSelector(
    (session) => session.sidePanelWidth
  )
  const activeSection = useChatSessionUiSelector(
    (session) => session.sidePanelActiveSection
  )
  const linkedSessionIds = useChatSessionUiSelector((session) => session.terminalLinkedSessionIds) ?? []
  const rawOpenTabs = useChatSessionUiSelector((session) => session.sidePanelOpenTabs) ?? ['files', 'side-chat', 'review', 'terminal', 'browser']
  
  const openTabs = useMemo(() => {
    return resolveOpenTabs(rawOpenTabs, linkedSessionIds)
  }, [rawOpenTabs, linkedSessionIds])

  const { setSidePanelWidth, setSidePanelOpen, setSidePanelActiveSection, closeSidePanelTab, openNewTerminal } =
    useChatSessionUiActions()

  const sessionNames = useTerminalRuntime((state) => state.sessionNames)
  const sessions = useTerminalRuntime((state) => state.sessions)

  const width = sidePanelResize?.effectiveWidth ?? persistedWidth
  const onResizeLive =
    sidePanelResize?.onResizeLive ??
    ((nextWidth: string) => setSidePanelWidth(nextWidth))
  const onResizeEnd =
    sidePanelResize?.onResizeEnd ??
    ((nextWidth: string) => setSidePanelWidth(nextWidth))

  const getTabInfo = (tabId: string) => {
    if (tabId.startsWith('terminal:')) {
      const sid = tabId.replace('terminal:', '')
      const session = sessions[sid]
      const customName = sessionNames[sid]?.trim()
      const shellName = session?.shell.split('/').filter(Boolean).pop()
      const label = customName || `Terminal (${shellName ?? 'zsh'})`
      return {
        id: tabId,
        label,
        icon: Terminal,
      }
    } else {
      const section = getChatSidePanelSection(tabId as any)
      return {
        id: tabId,
        label: section.label,
        icon: section.icon,
      }
    }
  }

  const selectorSections = openTabs.map(getTabInfo)
  const remainingSections = [
    { id: 'files', label: 'Files', icon: Folder },
    { id: 'side-chat', label: 'Side chat', icon: MessageCirclePlus },
    { id: 'review', label: 'Review', icon: ClipboardCheck },
    { id: 'browser', label: 'Browser', icon: Globe },
  ].filter((section) => !openTabs.includes(section.id))

  return (
    <aside
      className={cn(
        'col-start-2 row-start-1 relative h-full max-h-full min-h-0 shrink-0 overflow-hidden border-border/60 bg-background',
        'transition-[opacity,transform,border-color] duration-200 ease-out',
        open
          ? 'translate-x-0 border-l opacity-100'
          : 'pointer-events-none translate-x-full border-l-0 opacity-0'
      )}
      aria-hidden={!open}
      style={{ width }}
    >
      <SidePanelResizeRail
        width={width}
        onResize={onResizeLive}
        onResizeEnd={onResizeEnd}
        onToggle={() => setSidePanelOpen(false)}
      />

      <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
        {open ? (
          <WorkspaceTitlebarLayer
            className={cn(
              'fixed top-0 right-0 flex h-[var(--app-titlebar-height)] items-end border-b border-border/60 bg-background px-2 pb-[1px]',
              isPlatformTauri() && !isPlatformMacOS()
                ? 'pr-[calc(var(--app-titlebar-control-width)+0.5rem)]'
                : 'pr-2'
            )}
            style={{ width }}
          >
            <div className="flex h-10 min-w-0 flex-1 items-end gap-[2px] overflow-x-auto scrollbar-hide mr-2">
              {selectorSections.map((section) => {
                const Icon = section.icon
                const active = section.id === activeSection

                return (
                  <div
                    key={section.id}
                    onClick={() => setSidePanelActiveSection(section.id as any)}
                    className={cn(
                      'flex h-9 items-center gap-1.5 px-3 rounded-t-md text-[11px] border border-border/40 transition-all cursor-pointer select-none -mb-[1px] shrink-0',
                      active
                        ? 'bg-background border-b-transparent border-t-2 border-t-primary text-foreground font-semibold z-10'
                        : 'bg-muted/10 border-transparent text-muted-foreground hover:bg-muted/20 hover:text-foreground'
                    )}
                    aria-label={`Open ${section.label}`}
                    aria-pressed={active}
                    title={section.label}
                  >
                    <Icon className="size-3.5" />
                    <span>{section.label}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeSidePanelTab(section.id)
                      }}
                      className="rounded-full p-0.5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors ml-1"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )
              })}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mb-1 size-7 shrink-0 rounded-md border border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    title="Open new tab"
                  >
                    <span className="text-lg font-light leading-none">+</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {remainingSections.map((section) => {
                    const Icon = section.icon
                    return (
                      <DropdownMenuItem
                        key={section.id}
                        onSelect={() => setSidePanelActiveSection(section.id as any)}
                      >
                        <Icon className="mr-2 size-3.5" />
                        <span>{section.label}</span>
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuItem
                    onSelect={() => void openNewTerminal('side')}
                  >
                    <Terminal className="mr-2 size-3.5" />
                    <span>New Terminal</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex h-10 items-center gap-1 shrink-0 pb-1">
              <BottomPanelToggle />
              <ModelToolsToggle />
            </div>
          </WorkspaceTitlebarLayer>
        ) : null}
        <div
          className="shrink-0 border-b border-border/60 h-[var(--app-titlebar-height)]"
          aria-hidden
        />

        <SidePanelTabBody
          scope={scope}
          activeSection={activeSection}
          open={open}
          onOpenSection={setSidePanelActiveSection}
        />
      </div>
    </aside>
  )
}

function BottomWorkspacePanel() {
  const open = useChatSessionUiSelector((session) => session.bottomPanelOpen)
  const activeSection = useChatSessionUiSelector(
    (session) => session.bottomPanelActiveSection
  )
  const linkedSessionIds = useChatSessionUiSelector((session) => session.terminalLinkedSessionIds) ?? []
  const rawOpenTabs = useChatSessionUiSelector((session) => session.bottomPanelOpenTabs) ?? ['terminal', 'browser']
  
  const openTabs = useMemo(() => {
    return resolveOpenTabs(rawOpenTabs, linkedSessionIds)
  }, [rawOpenTabs, linkedSessionIds])

  const { setBottomPanelActiveSection, setBottomPanelOpen, closeBottomPanelTab, openNewTerminal } =
    useChatSessionUiActions()

  const sessionNames = useTerminalRuntime((state) => state.sessionNames)
  const sessions = useTerminalRuntime((state) => state.sessions)

  const getTabInfo = (tabId: string) => {
    if (tabId.startsWith('terminal:')) {
      const sid = tabId.replace('terminal:', '')
      const session = sessions[sid]
      const customName = sessionNames[sid]?.trim()
      const shellName = session?.shell.split('/').filter(Boolean).pop()
      const label = customName || `Terminal (${shellName ?? 'zsh'})`
      return {
        id: tabId,
        label,
        icon: Terminal,
      }
    } else {
      const label = tabId === 'browser' ? 'Browser' : 'Terminal'
      const Icon = tabId === 'browser' ? Globe : Terminal
      return {
        id: tabId,
        label,
        icon: Icon,
      }
    }
  }

  const selectorSections = openTabs.map(getTabInfo)
  const showBrowserOption = !openTabs.includes('browser')

  return (
    <section
      aria-hidden={!open}
      className={cn(
        'col-start-1 row-start-2 col-span-2 min-h-0 overflow-hidden border-t border-border/70 bg-background',
        'transition-[opacity,transform,border-color] duration-200 ease-out',
        open
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-full border-transparent opacity-0'
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-end border-b border-border/60 px-2 bg-background">
          <div className="flex items-end gap-[2px] h-full min-w-0 flex-1 overflow-x-auto scrollbar-hide">
            {selectorSections.map((section) => {
              const Icon = section.icon
              const active = section.id === activeSection

              return (
                <div
                  key={section.id}
                  onClick={() => setBottomPanelActiveSection(section.id as any)}
                  className={cn(
                    'flex h-9 items-center gap-1.5 px-3 rounded-t-md text-[11px] border border-border/40 transition-all cursor-pointer select-none -mb-[1px] shrink-0',
                    active
                      ? 'bg-background border-b-transparent border-t-2 border-t-primary text-foreground font-semibold z-10'
                      : 'bg-muted/10 border-transparent text-muted-foreground hover:bg-muted/20 hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                  <span>{section.label}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeBottomPanelTab(section.id)
                    }}
                    className="rounded-full p-0.5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors ml-1"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mb-1 size-7 shrink-0 rounded-md border border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  title="Open new tab"
                >
                  <span className="text-lg font-light leading-none">+</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {showBrowserOption && (
                  <DropdownMenuItem
                    onSelect={() => setBottomPanelActiveSection('browser')}
                  >
                    <Globe className="mr-2 size-3.5" />
                    <span>Browser</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => void openNewTerminal('bottom')}
                >
                  <Terminal className="mr-2 size-3.5" />
                  <span>New Terminal</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex h-10 items-center shrink-0 pl-2 pb-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-md"
              aria-label="Dismiss bottom panel"
              title="Close"
              onClick={() => setBottomPanelOpen(false)}
            >
              <X className="size-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {activeSection === 'browser' ? (
            <BrowserSection isActive={open && activeSection === 'browser'} />
          ) : activeSection.startsWith('terminal:') ? (
            <TerminalSection key={activeSection} sessionId={activeSection.replace('terminal:', '')} />
          ) : (
            <TerminalSection />
          )}
        </div>
      </div>
    </section>
  )
}

function TerminalSection({ sessionId: propSessionId }: { sessionId?: string } = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const scrollbackLoadRef = useRef(0)
  const ensureSessionRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const isDark = useTheme((state) => state.isDark)
  const chatSessionId = useChatSessionId()
  const chatSessionUi = useChatSessionUi()
  const { linkTerminalSession, setTerminalActiveSessionId, replaceTerminalSession } =
    useChatSessionUiActions()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const sessions = useTerminalRuntime((state) => state.sessions)
  const sessionNames = useTerminalRuntime((state) => state.sessionNames)
  const activeSessionId = propSessionId ?? useTerminalRuntime((state) => state.activeSessionId)
  const activeSession = useTerminalRuntime((state) =>
    activeSessionId ? state.sessions[activeSessionId] : undefined
  )
  const hydrateSessions = useTerminalRuntime((state) => state.hydrateSessions)
  const upsertSession = useTerminalRuntime((state) => state.upsertSession)
  const setActiveSession = useTerminalRuntime((state) => state.setActiveSession)
  const renameSession = useTerminalRuntime((state) => state.renameSession)
  const markExited = useTerminalRuntime((state) => state.markExited)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    ensureSessionRef.current = false
  }, [chatSessionId])

  useEffect(() => {
    const preferred = chatSessionUi.terminalActiveSessionId
    if (!preferred || !sessions[preferred]) return
    if (activeSessionId === preferred) return
    setActiveSession(preferred)
  }, [
    chatSessionId,
    chatSessionUi.terminalActiveSessionId,
    sessions,
    activeSessionId,
    setActiveSession,
  ])

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const sessionId = activeSessionIdRef.current
    if (!terminal || !fitAddon) return

    try {
      fitAddon.fit()
      if (isPlatformTauri() && sessionId) {
        void invoke('resize_terminal_session', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      }
    } catch (error) {
      console.warn('Failed to resize terminal:', error)
    }
  }, [])

  const startSession = useCallback(async () => {
    if (starting || !isPlatformTauri()) return

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.start',
      actionLabel: 'start terminal shell',
      category: 'shell',
      resourceLabel: 'local PTY',
      risk: 'high',
      details: {
        shell: 'default login shell',
        cwd: 'workspace default',
      },
    })
    if (!allowed) return

    setStarting(true)
    try {
      const info = await invoke<TerminalSessionInfo>('start_terminal_session', {
        request: {
          cols: terminalRef.current?.cols,
          rows: terminalRef.current?.rows,
        },
      })
      upsertSession(info)
      setActiveSession(info.sessionId)
      linkTerminalSession(info.sessionId)
      terminalRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
      terminalRef.current?.writeln(`\x1b[2mStarted ${info.shell}\x1b[0m`)
    } catch (error) {
      terminalRef.current?.writeln(
        `\r\n\x1b[31mFailed to start terminal: ${String(error)}\x1b[0m`
      )
    } finally {
      setStarting(false)
    }
  }, [
    linkTerminalSession,
    requestRuntimePermission,
    setActiveSession,
    starting,
    upsertSession,
  ])

  const ensureTerminalSession = useCallback(async () => {
    if (!isPlatformTauri() || ensureSessionRef.current || starting) return
    ensureSessionRef.current = true

    try {
      const nextSessions = await invoke<TerminalSessionInfo[]>(
        'list_terminal_sessions'
      )
      hydrateSessions(nextSessions)

      const runningSessionIds = new Set(nextSessions.map((s) => s.sessionId))
      if (activeSessionId && !runningSessionIds.has(activeSessionId)) {
        setStarting(true)
        try {
          const info = await invoke<TerminalSessionInfo>('start_terminal_session', {
            request: {
              cols: terminalRef.current?.cols || 80,
              rows: terminalRef.current?.rows || 24,
            },
          })
          upsertSession(info)
          replaceTerminalSession(activeSessionId, info.sessionId)
          terminalRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
          terminalRef.current?.writeln(`\x1b[2mStarted fresh shell ${info.shell}\x1b[0m`)
        } catch (error) {
          console.error('Failed to replace dead terminal session:', error)
        } finally {
          setStarting(false)
        }
        return
      }

      const preferredId = chatSessionUi.terminalActiveSessionId
      const preferred = preferredId
        ? nextSessions.find((session) => session.sessionId === preferredId)
        : undefined
      if (preferred) {
        setActiveSession(preferred.sessionId)
        return
      }

      const linkedRunning = chatSessionUi.terminalLinkedSessionIds
        .map((sessionId) =>
          nextSessions.find((session) => session.sessionId === sessionId)
        )
        .find((session) => session?.status === 'running')

      if (linkedRunning) {
        setActiveSession(linkedRunning.sessionId)
        setTerminalActiveSessionId(linkedRunning.sessionId)
        return
      }

      await startSession()
    } catch (error) {
      ensureSessionRef.current = false
      terminalRef.current?.writeln(
        `\r\n\x1b[31mFailed to connect terminal: ${String(error)}\x1b[0m`
      )
    }
  }, [
    activeSessionId,
    chatSessionUi.terminalActiveSessionId,
    chatSessionUi.terminalLinkedSessionIds,
    hydrateSessions,
    replaceTerminalSession,
    setActiveSession,
    setTerminalActiveSessionId,
    startSession,
    starting,
    upsertSession,
  ])

  const stopSession = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId ?? activeSessionId
      if (!targetSessionId || !isPlatformTauri()) return

      const targetSession = sessions[targetSessionId]
      const allowed = await requestRuntimePermission({
        actionId: 'terminal.stop',
        actionLabel: 'stop terminal session',
        category: 'shell',
        resourceLabel:
          sessionNames[targetSessionId] ??
          targetSession?.shell ??
          targetSessionId.slice(0, 8),
        risk: 'medium',
        details: {
          sessionId: targetSessionId,
          shell: targetSession?.shell,
          status: targetSession?.status,
        },
      })
      if (!allowed) return

      try {
        await invoke('stop_terminal_session', { sessionId: targetSessionId })
      } catch (error) {
        terminalRef.current?.writeln(
          `\r\n\x1b[31mFailed to stop terminal: ${String(error)}\x1b[0m`
        )
      }
    },
    [activeSessionId, requestRuntimePermission, sessionNames, sessions]
  )

  const attachTerminalOutput = useCallback(async () => {
    const terminal = terminalRef.current
    if (!activeSession || !terminal) return

    let content = terminal.hasSelection() ? terminal.getSelection() : ''
    let captureMode: 'selection' | 'scrollback' = 'selection'

    if (!content.trim()) {
      captureMode = 'scrollback'
      try {
        content = await invoke<string>('read_terminal_scrollback', {
          sessionId: activeSession.sessionId,
        })
      } catch (error) {
        terminal.writeln(
          `\r\n\x1b[31mFailed to read terminal scrollback: ${String(error)}\x1b[0m`
        )
        return
      }
    }

    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal output to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.attach-output',
      actionLabel: 'attach terminal output to chat',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        captureMode,
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    const maxChars = 12000
    const finalContent =
      trimmedContent.length > maxChars
        ? trimmedContent.slice(trimmedContent.length - maxChars)
        : trimmedContent

    setAttachmentsForThread(attachmentsKey, (attachments) => [
      ...attachments,
      createTerminalOutputAttachment({
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        cwd: activeSession.cwd,
        status: activeSession.status,
        exitCode: activeSession.exitCode,
        capturedAt: Date.now(),
        captureMode,
        content: finalContent,
      }),
    ])

    toast.success(
      captureMode === 'selection'
        ? 'Terminal selection attached'
        : 'Terminal scrollback attached'
    )
  }, [
    activeSession,
    attachmentsKey,
    requestRuntimePermission,
    sessionNames,
    setAttachmentsForThread,
  ])

  const readActiveScrollback = useCallback(async () => {
    if (!activeSessionId) return ''
    return invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
  }, [activeSessionId])

  const copyTerminalScrollback = useCallback(async () => {
    if (!activeSession) return

    const content = await readActiveScrollback()
    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal scrollback to copy')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.copy-scrollback',
      actionLabel: 'copy terminal scrollback',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    await navigator.clipboard.writeText(trimmedContent)
    toast.success('Terminal scrollback copied')
  }, [
    activeSession,
    readActiveScrollback,
    requestRuntimePermission,
    sessionNames,
  ])

  const clearTerminalScreen = useCallback(() => {
    terminalRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
  }, [])

  const reflowTerminal = useCallback(() => {
    fitAndResize()
    toast.success('Terminal reflowed')
  }, [fitAndResize])

  const renameActiveSession = useCallback(() => {
    if (!activeSession) return
    const currentName =
      sessionNames[activeSession.sessionId] ?? activeSession.shell
    const nextName = window.prompt('Terminal session name', currentName)
    if (!nextName) return
    renameSession(activeSession.sessionId, nextName)
  }, [activeSession, renameSession, sessionNames])

  useEffect(() => {
    return () => {
      ensureSessionRef.current = false
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = {
      background: 'transparent',
      foreground: isDark ? '#f8fafc' : '#0f172a',
      cursor: isDark ? '#f8fafc' : '#0f172a',
      selectionBackground: isDark
        ? 'rgba(255, 255, 255, 0.15)'
        : 'rgba(0, 0, 0, 0.15)',
    }
  }, [isDark])

  const ensureTerminalSessionRef = useRef(ensureTerminalSession)
  const fitAndResizeRef = useRef(fitAndResize)

  useEffect(() => {
    ensureTerminalSessionRef.current = ensureTerminalSession
    fitAndResizeRef.current = fitAndResize
  }, [ensureTerminalSession, fitAndResize])

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: 'transparent',
        foreground: isDark ? '#f8fafc' : '#0f172a',
        cursor: isDark ? '#f8fafc' : '#0f172a',
        selectionBackground: isDark
          ? 'rgba(255, 255, 255, 0.15)'
          : 'rgba(0, 0, 0, 0.15)',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.loadAddon(new SearchAddon())
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    if (containerRef.current) {
      terminal.open(containerRef.current)
      fitAndResizeRef.current()
      terminal.writeln('\x1b[2mConnecting terminal session...\x1b[0m')
      void ensureTerminalSessionRef.current()
    }

    const disposable = terminal.onData((data) => {
      const sessionId = activeSessionIdRef.current
      if (!isPlatformTauri() || !sessionId) return
      void invoke('write_terminal_stdin', {
        sessionId,
        input: data,
      })
    })

    return () => {
      disposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const loadId = scrollbackLoadRef.current + 1
    scrollbackLoadRef.current = loadId
    terminal.write('\x1b[2J\x1b[3J\x1b[H')

    if (!activeSessionId) {
      terminal.writeln('\x1b[2mStarting terminal session...\x1b[0m')
      return
    }
    if (!isPlatformTauri()) return

    void invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
      .then((scrollback) => {
        if (scrollbackLoadRef.current !== loadId) return
        terminal.write('\x1b[2J\x1b[3J\x1b[H')
        if (scrollback) {
          terminal.write(scrollback)
        } else if (activeSession) {
          terminal.writeln(`\x1b[2mAttached to ${activeSession.shell}\x1b[0m`)
        }
        fitAndResize()
      })
      .catch((error) => {
        if (scrollbackLoadRef.current !== loadId) return
        terminal.writeln(
          `\r\n\x1b[31mFailed to load terminal scrollback: ${String(error)}\x1b[0m`
        )
      })
  }, [activeSession, activeSessionId, fitAndResize])

  const throttledFitAndResize = useMemo(
    () => throttle(() => fitAndResize(), 100),
    [fitAndResize]
  )

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => throttledFitAndResize())
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [throttledFitAndResize])

  const markExitedRef = useRef(markExited)
  useEffect(() => {
    markExitedRef.current = markExited
  }, [markExited])

  useEffect(() => {
    if (!isPlatformTauri()) return

    const unlistenOutputPromise = listen<{ sessionId: string; data: string }>(
      'terminal-output',
      (event) => {
        if (event.payload.sessionId === activeSessionIdRef.current) {
          terminalRef.current?.write(event.payload.data)
        }
      }
    )

    const unlistenExitPromise = listen<{
      sessionId: string
      exitCode?: number | null
    }>('terminal-exit', (event) => {
      markExitedRef.current(event.payload.sessionId, event.payload.exitCode)
      if (event.payload.sessionId === activeSessionIdRef.current) {
        terminalRef.current?.writeln(
          `\r\n\x1b[2mProcess exited${typeof event.payload.exitCode === 'number' ? ` (${event.payload.exitCode})` : ''}.\x1b[0m`
        )
      }
    })

    const unlistenErrorPromise = listen<{ sessionId: string; message: string }>(
      'terminal-error',
      (event) => {
        if (event.payload.sessionId === activeSessionIdRef.current) {
          terminalRef.current?.writeln(
            `\r\n\x1b[31m${event.payload.message}\x1b[0m`
          )
        }
      }
    )

    return () => {
      void unlistenOutputPromise.then((unlisten) => unlisten())
      void unlistenExitPromise.then((unlisten) => unlisten())
      void unlistenErrorPromise.then((unlisten) => unlisten())
    }
  }, [])

  if (!isPlatformTauri()) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center rounded-md border border-border/60 bg-card px-4 text-center text-sm text-muted-foreground">
        Terminal sessions are available in the desktop app.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[180px] flex-col overflow-hidden bg-background">
      <div className="flex h-7 shrink-0 items-center justify-between bg-background px-2">
        <div className="font-mono text-[11px] text-muted-foreground truncate select-all" title={activeSession?.cwd ?? activeSession?.shell}>
          {activeSession ? (activeSession.cwd || activeSession.shell) : 'Connecting...'}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 bg-transparent px-1 py-1 font-mono text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
              aria-label="Terminal actions"
              title="Terminal actions"
            >
              ···
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={() => void attachTerminalOutput()}
            >
              <Paperclip className="size-4" />
              <span>Attach selection/scrollback to chat</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={() => void copyTerminalScrollback()}
            >
              <Copy className="size-4" />
              <span>Copy scrollback</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={clearTerminalScreen}
            >
              <Trash2 className="size-4" />
              <span>Clear screen</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={reflowTerminal}
            >
              <RefreshCw className="size-4" />
              <span>Resize/reflow</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={renameActiveSession}
            >
              <File className="size-4" />
              <span>Rename session</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={activeSession?.status !== 'running'}
              onClick={() => void stopSession()}
            >
              <X className="size-4" />
              <span>Kill session</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <div ref={containerRef} className="h-full min-h-0 w-full" />
      </div>
    </div>
  )
}
