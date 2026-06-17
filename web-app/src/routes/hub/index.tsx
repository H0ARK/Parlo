/* eslint-disable @typescript-eslint/no-explicit-any */
import { invoke } from '@tauri-apps/api/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, formatBytes, sanitizeModelId } from '@/lib/utils'
import { sumMlxModelBytes } from '@/lib/modelCompatibility'
import {
  useState,
  useMemo,
  useEffect,
  ChangeEvent,
  useCallback,
  useRef,
  useTransition,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Card, CardItem } from '@/containers/Card'
import {
  extractModelName,
  extractDescription,
  selectDefaultQuant,
} from '@/lib/models'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconFileCode,
  IconEye,
  IconPuzzle,
  IconSearch,
  IconTool,
} from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import { Boxes, ChevronsUpDown, Loader, RefreshCw, Store } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { useShallow } from 'zustand/shallow'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import {
  installCodexPlugin,
  listCodexApps,
  listCodexHooks,
  listCodexPlugins,
  listInstalledCodexPlugins,
  listCodexSkills,
  addCodexMarketplace,
  prepareCodexCapabilitySession,
  upgradeCodexMarketplace,
  uninstallCodexPlugin,
} from '@/lib/codex-app-server'
import {
  collectCodexMarketplaceDescriptors,
  collectCodexPluginDescriptors,
  collectCodexSkillDescriptors,
  type CodexPluginDescriptor,
} from '@/containers/model-tools-panel/shared/codex-helpers'
import { toast } from 'sonner'
import {
  ModelHubFilters,
  type ModelCapabilityFilter,
  type ModelFormatFilter,
} from './components/ModelHubFilters'
import { FeaturedModelGrid } from './components/FeaturedModelGrid'
import { PluginMarketplaceSection } from './components/PluginMarketplaceSection'

type SearchParams = {
  repo: string
}

type QuantTier = {
  label: string
  className: string
}

type HubSection = 'models' | 'plugins'

type HubPluginSnapshot = {
  pluginList: unknown
  installedPlugins: unknown
  skills: unknown
  hooks: unknown
  apps: unknown
}

const HUB_CODEX_THREAD_ID = 'hub-codex-marketplace'
const OPENAI_PLUGINS_MARKETPLACE_SOURCE = 'openai/plugins'
const OPENAI_PLUGINS_MARKETPLACE_REF = 'main'
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

const normalizeErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    return (error as Record<string, unknown>).message as string
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'error' in error &&
    typeof (error as Record<string, unknown>).error === 'string'
  ) {
    return (error as Record<string, unknown>).error as string
  }
  if (error !== null && typeof error === 'object') {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error ?? '')
}

const isMissingMarketplaceManifestError = (error: unknown): boolean => {
  const normalized = normalizeErrorText(error).toLowerCase()
  return (
    normalized.includes('marketplace root does not contain a supported manifest') ||
    normalized.includes('marketplace root does not contain')
  )
}

const addCodexMarketplaceWithRetry = async (
  threadId: string,
  params: Record<string, unknown>
): Promise<unknown> => {
  try {
    return await addCodexMarketplace(threadId, params)
  } catch (error) {
    const source = typeof params.source === 'string' ? params.source : ''
    const supportsSparsePaths =
      Boolean(source) && Boolean(getOpenAiPluginsSparsePaths(source)?.length)
    const hasSparsePaths = Boolean(params.sparsePaths)
    if (
      !isMissingMarketplaceManifestError(error) ||
      !supportsSparsePaths ||
      !hasSparsePaths
    ) {
      throw error
    }

    const fullCloneParams: Record<string, unknown> = { ...params }
    delete fullCloneParams.sparsePaths
    return await addCodexMarketplace(threadId, fullCloneParams)
  }
}

async function resolveHubCodexCwd() {
  const dataFolder = await invoke<string>('get_jan_data_folder_path').catch(
    async () => {
      const configuration = await invoke<{ data_folder?: string }>(
        'get_app_configurations'
      ).catch(() => null)
      return configuration?.data_folder
    }
  )
  const trimmed = typeof dataFolder === 'string' ? dataFolder.trim() : ''
  return trimmed || '/'
}

function getQuantTier(modelId: string): QuantTier | null {
  const id = modelId.toLowerCase()
  if (/(^|[-_.])(f32|bf16|f16|q8|q6)([-_.]|$)/.test(id)) {
    return {
      label: 'Large',
      className:
        'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    }
  }
  if (/(^|[-_.])(q5|q4_k|iq4)/.test(id)) {
    return {
      label: 'Balanced',
      className:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    }
  }
  if (/(^|[-_.])(iq2|iq3|q2|q3|q4_0|q4_1)/.test(id)) {
    return {
      label: 'Small',
      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    }
  }
  return null
}

function getPluginText(plugin: CodexPluginDescriptor) {
  return [plugin.id, plugin.name, plugin.description, plugin.version]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function describePluginMarketplaceError(error: unknown) {
  const message = normalizeErrorText(error)
  if (
    message.includes('No codex app-server process') ||
    message.includes('Codex app-server') ||
    message.includes('CODEX_NOT_RUNNING')
  ) {
    return 'Codex app-server is not running. Start or restart a Codex-backed session, then refresh the marketplace.'
  }
  return message
}

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubContent() {
  const [isPending, startTransition] = useTransition()
  const parentRef = useRef(null)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const serviceHub = useServiceHub()

  const { t } = useTranslation()

  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
  ]
  const searchOptions = useMemo(
    () => ({
      includeScore: true,
      // Search in `author` and in `tags` array
      keys: ['model_name', 'quants.model_id'],
    }),
    []
  )

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [modelFormatFilter, setModelFormatFilter] =
    useState<ModelFormatFilter>('all')
  const [modelCapabilityFilter, setModelCapabilityFilter] =
    useState<ModelCapabilityFilter>('all')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [isSearching, setIsSearching] = useState(false)
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false)
  const [huggingFaceRepo, setHuggingFaceRepo] = useState<CatalogModel | null>(
    null
  )
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [activeHubSection, setActiveHubSection] = useState<HubSection>('models')
  const [pluginSearchValue, setPluginSearchValue] = useState('')
  const [showInstalledPluginsOnly, setShowInstalledPluginsOnly] = useState(false)
  const [pluginDescriptors, setPluginDescriptors] = useState<CodexPluginDescriptor[]>([])
  const [pluginSnapshot, setPluginSnapshot] = useState<HubPluginSnapshot | null>(null)
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [pluginsLoadAttempted, setPluginsLoadAttempted] = useState(false)
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const prepareHubCodexSession = useCallback(async () => {
    const cwd = await resolveHubCodexCwd()
    await prepareCodexCapabilitySession(HUB_CODEX_THREAD_ID, { cwd })
  }, [])

  const refreshPlugins = useCallback(async () => {
    setPluginsLoadAttempted(true)
    setPluginsLoading(true)
    setPluginsError(null)
    try {
      await prepareHubCodexSession()
      const [pluginList, installedPlugins, skills, hooks, apps] = await Promise.all([
        listCodexPlugins(HUB_CODEX_THREAD_ID, {
          includeDisabled: true,
        }),
        listInstalledCodexPlugins(HUB_CODEX_THREAD_ID, {
          suggestions: [],
        }),
        listCodexSkills(HUB_CODEX_THREAD_ID),
        listCodexHooks(HUB_CODEX_THREAD_ID),
        listCodexApps(HUB_CODEX_THREAD_ID),
      ])
      const snapshot = { pluginList, installedPlugins, skills, hooks, apps }
      setPluginSnapshot(snapshot)
      setPluginDescriptors(
        collectCodexPluginDescriptors(snapshot).sort((a, b) => {
          if (Boolean(a.installed) !== Boolean(b.installed)) {
            return a.installed ? -1 : 1
          }
          return (a.name ?? a.id).localeCompare(b.name ?? b.id)
        })
      )
    } catch (error) {
      setPluginsError(describePluginMarketplaceError(error))
      setPluginSnapshot(null)
      setPluginDescriptors([])
    } finally {
      setPluginsLoading(false)
    }
  }, [prepareHubCodexSession])

  const addOpenAiPluginsMarketplace = useCallback(async () => {
    setPluginsLoadAttempted(true)
    setPluginsLoading(true)
    setPluginsError(null)
    try {
      await prepareHubCodexSession()
      const source = OPENAI_PLUGINS_MARKETPLACE_SOURCE
      const sparsePaths = getOpenAiPluginsSparsePaths(source)
      const result = await addCodexMarketplaceWithRetry(HUB_CODEX_THREAD_ID, {
        source: OPENAI_PLUGINS_MARKETPLACE_SOURCE,
        refName: OPENAI_PLUGINS_MARKETPLACE_REF,
        ...(sparsePaths ? { sparsePaths } : {}),
      })
      const resultRecord =
        result && typeof result === 'object'
          ? (result as Record<string, unknown>)
          : {}
      const marketplaceName =
        typeof resultRecord.marketplaceName === 'string'
          ? resultRecord.marketplaceName
          : OPENAI_PLUGINS_MARKETPLACE_SOURCE
      if (resultRecord.alreadyAdded) {
        await upgradeCodexMarketplace(HUB_CODEX_THREAD_ID, { marketplaceName })
        toast.success('OpenAI plugins marketplace refreshed')
      } else {
        toast.success('OpenAI plugins marketplace added')
      }
      await refreshPlugins()
    } catch (error) {
      const message = describePluginMarketplaceError(error)
      setPluginsError(message)
      toast.error(`Marketplace add failed: ${message}`)
    } finally {
      setPluginsLoading(false)
    }
  }, [prepareHubCodexSession, refreshPlugins])

  const runPluginAction = useCallback(
    async (plugin: CodexPluginDescriptor, action: 'install' | 'uninstall') => {
      setPluginsLoading(true)
      setPluginsError(null)
      try {
        await prepareHubCodexSession()
        if (action === 'install') {
          await installCodexPlugin(HUB_CODEX_THREAD_ID, {
            plugin: plugin.id,
            pluginId: plugin.id,
          })
          toast.success(`Installed ${plugin.name ?? plugin.id}`)
        } else {
          await uninstallCodexPlugin(HUB_CODEX_THREAD_ID, {
            plugin: plugin.id,
            pluginId: plugin.id,
          })
          toast.success(`Uninstalled ${plugin.name ?? plugin.id}`)
        }
        await refreshPlugins()
      } catch (error) {
        const message = describePluginMarketplaceError(error)
        setPluginsError(message)
        toast.error(`Plugin ${action} failed: ${message}`)
      } finally {
        setPluginsLoading(false)
      }
    },
    [prepareHubCodexSession, refreshPlugins]
  )

  const toggleModelExpansion = useCallback((modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }, [])

  // Sorting functionality
  const sortedModels = useMemo(() => {
    const sorted = [...sources]

    // Apply sorting
    if (sortSelected === 'most-downloaded') {
      return sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    }
    return sorted.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
  }, [sortSelected, sources])

  // Filtered models (debounced search)
  const [debouncedSearchValue, setDebouncedSearchValue] = useState(searchValue)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchValue])

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

  const filteredModels = useMemo(() => {
    let filtered = sortedModels
    // Apply search filter
    if (debouncedSearchValue.length) {
      const fuse = new Fuse(filtered, searchOptions)
      // Remove domain from search value (e.g., "huggingface.co/author/model" -> "author/model")
      const cleanedSearchValue = debouncedSearchValue.replace(
        /^https?:\/\/[^/]+\//,
        ''
      )
      filtered = fuse.search(cleanedSearchValue).map((result) => result.item)
    }
    if (modelFormatFilter === 'mlx') {
      filtered = filtered.filter((model) => model.is_mlx)
    } else if (modelFormatFilter === 'gguf') {
      filtered = filtered.filter((model) => !model.is_mlx)
    }
    if (modelCapabilityFilter === 'tools') {
      filtered = filtered.filter((model) => Boolean(model.tools))
    } else if (modelCapabilityFilter === 'vision') {
      filtered = filtered.filter((model) => (model.num_mmproj ?? 0) > 0)
    }
    // Apply downloaded filter
    if (showOnlyDownloaded) {
      filtered = filtered
        ?.map((model) => ({
          ...model,
          quants: model.quants?.filter((variant) => {
            // Check both direct match and with developer prefix (like DownloadButton does)
            const isLlamaCppDownloaded = useModelProvider
              .getState()
              .getProviderByName('llamacpp')
              ?.models.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id === `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )

            const isMlxDownloaded = useModelProvider
              .getState()
              .getProviderByName('mlx')
              ?.models.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id === `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )

            return isLlamaCppDownloaded || isMlxDownloaded
          }),
        }))
        .filter((model) => (model.quants?.length ?? 0) > 0)
    }
    // Add HuggingFace repo at the beginning if available
    if (huggingFaceRepo) {
      filtered = [huggingFaceRepo, ...filtered]
    }
    return filtered
  }, [
    sortedModels,
    debouncedSearchValue,
    modelFormatFilter,
    modelCapabilityFilter,
    showOnlyDownloaded,
    huggingFaceRepo,
    searchOptions,
  ])

  const modelFilterCounts = useMemo(
    () => ({
      all: sources.length,
      gguf: sources.filter((model) => !model.is_mlx).length,
      mlx: sources.filter((model) => model.is_mlx).length,
      tools: sources.filter((model) => Boolean(model.tools)).length,
      vision: sources.filter((model) => (model.num_mmproj ?? 0) > 0).length,
    }),
    [sources]
  )

  const featuredModels = useMemo(
    () =>
      [...filteredModels]
        .sort((a, b) => {
          const aScore =
            (isRecommendedModel(a.model_name) ? 1000000 : 0) +
            (a.tools ? 200000 : 0) +
            ((a.num_mmproj ?? 0) > 0 ? 100000 : 0) +
            (a.downloads ?? 0)
          const bScore =
            (isRecommendedModel(b.model_name) ? 1000000 : 0) +
            (b.tools ? 200000 : 0) +
            ((b.num_mmproj ?? 0) > 0 ? 100000 : 0) +
            (b.downloads ?? 0)
          return bScore - aScore
        })
        .slice(0, 6),
    [filteredModels, isRecommendedModel]
  )

  const filteredPlugins = useMemo(() => {
    const query = pluginSearchValue.trim().toLowerCase()
    return pluginDescriptors.filter((plugin) => {
      if (showInstalledPluginsOnly && !plugin.installed) return false
      if (!query) return true
      return getPluginText(plugin).includes(query)
    })
  }, [pluginDescriptors, pluginSearchValue, showInstalledPluginsOnly])

  const marketplaceDescriptors = useMemo(
    () =>
      pluginSnapshot
        ? collectCodexMarketplaceDescriptors(pluginSnapshot)
        : [],
    [pluginSnapshot]
  )

  const skillDescriptors = useMemo(
    () =>
      pluginSnapshot
        ? collectCodexSkillDescriptors(pluginSnapshot)
        : [],
    [pluginSnapshot]
  )

  const hubStats = useMemo(() => {
    const installedPlugins = pluginDescriptors.filter(
      (plugin) => plugin.installed
    ).length
    const llamaModels =
      useModelProvider.getState().getProviderByName('llamacpp')?.models ?? []
    const mlxModels =
      useModelProvider.getState().getProviderByName('mlx')?.models ?? []
    const localModels = [...llamaModels, ...mlxModels]
    const downloadedModels = sources.reduce((count, model) => {
      const hasDownloadedQuant = model.quants?.some((variant) => {
        const normalized = `${model.developer}/${sanitizeModelId(variant.model_id)}`
        return localModels.some(
          (entry: { id: string }) =>
            entry.id === variant.model_id || entry.id === normalized
        )
      })
      return hasDownloadedQuant ? count + 1 : count
    }, 0)
    return {
      totalModels: sources.length,
      downloadedModels,
      totalPlugins: pluginDescriptors.length,
      installedPlugins,
      totalMarketplaces: marketplaceDescriptors.length,
      totalSkills: skillDescriptors.length,
      appsCount: pluginSnapshot
        ? collectCodexPluginDescriptors(pluginSnapshot.apps).length
        : 0,
    }
  }, [
    marketplaceDescriptors.length,
    pluginDescriptors,
    pluginSnapshot,
    skillDescriptors.length,
    sources,
  ])

  useEffect(() => {
    if (
      activeHubSection === 'plugins' &&
      !pluginsLoadAttempted &&
      !pluginsLoading
    ) {
      void refreshPlugins()
    }
  }, [
    activeHubSection,
    pluginsLoadAttempted,
    pluginsLoading,
    refreshPlugins,
  ])

  // Dynamic estimate size based on model state
  const estimateSize = useCallback(
    (index: number) => {
      const model = filteredModels[index]
      if (!model) return 100
      // Base height + variants height if expanded
      const baseHeight = 95
      const variantHeight = 36
      const expanded = expandedModels[model.model_name]
      return expanded && (model.quants?.length ?? 0) > 1
        ? baseHeight + (model.quants?.length ?? 0) * variantHeight
        : baseHeight
    },
    [expandedModels, filteredModels]
  )

  // The virtualizer - only enable when we have models
  const rowVirtualizer = useVirtualizer(
    filteredModels.length > 0
      ? {
          count: filteredModels.length,
          getScrollElement: () => parentRef.current,
          estimateSize,
          overscan: 8,
          measureElement: (el: HTMLElement) => el.getBoundingClientRect().height,
        }
      : { count: 0, getScrollElement: () => null, estimateSize: () => 0 }
  )

  useEffect(() => {
    // Use startTransition to keep UI responsive during data fetch
    startTransition(() => {
      fetchSources()
    })
  }, [fetchSources])

  // Reset initial load state after data loads or on filter change
  useEffect(() => {
    if (!isInitialLoad) return

    // Hide skeleton after a short delay to show loading state
    const timer = setTimeout(() => setIsInitialLoad(false), 150)
    return () => clearTimeout(timer)
  }, [isInitialLoad, filteredModels.length])

  const fetchHuggingFaceModel = async (searchValue: string) => {
    if (
      !searchValue.length ||
      (!searchValue.includes('/') && !searchValue.startsWith('http'))
    ) {
      return
    }

    setIsSearching(true)
    if (addModelSourceTimeoutRef.current) {
      clearTimeout(addModelSourceTimeoutRef.current)
    }

    addModelSourceTimeoutRef.current = setTimeout(async () => {
      try {
        const repoInfo = await serviceHub
          .models()
          .fetchHuggingFaceRepo(searchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub
            .models()
            .convertHfRepoToCatalogModel(repoInfo)
          if (
            !sources.some(
              (s) =>
                catalogModel.model_name.trim().split('/').pop() ===
                  s.model_name.trim() &&
                catalogModel.developer?.trim() === s.developer?.trim()
            )
          ) {
            setHuggingFaceRepo(catalogModel)
          }
        }
      } catch (error) {
        console.error('Error fetching repository info:', error)
      } finally {
        setIsSearching(false)
      }
    }, 500)
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setIsSearching(false)
    setSearchValue(e.target.value)
    setHuggingFaceRepo(null) // Clear previous repo info

    if (!showOnlyDownloaded) {
      fetchHuggingFaceModel(e.target.value)
    }
  }

  const navigate = useNavigate()

  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          threadModel: {
            id: modelId,
            provider: 'llamacpp',
          },
        },
      })
    },
    [navigate]
  )

  const handleOpenModel = useCallback(
    (model: CatalogModel) => {
      navigate({
        to: route.hub.model,
        params: {
          modelId: model.model_name,
        },
      })
    },
    [navigate]
  )

  const renderFilter = () => {
    return (
      <>
        {/* Sort dropdown - always visible */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {
                sortOptions.find((option) => option.value === sortSelected)
                  ?.name
              }
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                className={cn(
                  'cursor-pointer my-0.5',
                  sortSelected === option.value && 'bg-secondary'
                )}
                key={option.value}
                onClick={() => {
                  setIsInitialLoad(true)
                  setSortSelected(option.value)
                }}
              >
                {option.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyDownloaded}
            onCheckedChange={(checked) => {
              setIsInitialLoad(true)
              setShowOnlyDownloaded(checked)
              if (checked) {
                setHuggingFaceRepo(null)
              } else {
                // Re-trigger HuggingFace search when switching back to "All models"
                fetchHuggingFaceModel(searchValue)
              }
            }}
          />
          <span className="text-xs text-foreground font-medium whitespace-nowrap">
            {t('hub:downloaded')}
          </span>
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full ">
        <HeaderPage>
          <div className={cn("pr-3 py-3 min-h-12 w-full flex items-center justify-between gap-3 relative z-20", !IS_MACOS && "pr-30")}>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Store className="size-4" />
              </div>
              <div className="hidden sm:block text-sm font-semibold text-foreground">
                Hub
              </div>
            </div>
            <div className="flex h-8 shrink-0 rounded-md border border-border/70 bg-muted/20 p-0.5">
              {(['models', 'plugins'] as HubSection[]).map((section) => (
                <button
                  key={section}
                  type="button"
                  className={cn(
                    'flex items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors',
                    activeHubSection === section
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setActiveHubSection(section)}
                >
                  {section === 'models' ? (
                    <Boxes className="size-3.5" />
                  ) : (
                    <IconPuzzle size={14} />
                  )}
                  <span className="capitalize">{section}</span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
              {activeHubSection === 'models' && isSearching ? (
                <Loader className="shrink-0 size-4 animate-spin text-muted-foreground" />
              ) : activeHubSection === 'plugins' && pluginsLoading ? (
                <Loader className="shrink-0 size-4 animate-spin text-muted-foreground" />
              ) : (
                <IconSearch
                  className="shrink-0 text-muted-foreground"
                  size={14}
                />
              )}
              <input
                placeholder={activeHubSection === 'models' ? 'Search models' : 'Search plugins'}
                value={activeHubSection === 'models' ? searchValue : pluginSearchValue}
                onChange={activeHubSection === 'models' ? handleSearchChange : (event) => setPluginSearchValue(event.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {activeHubSection === 'models' ? (
                renderFilter()
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pluginsLoading}
                    onClick={() => void refreshPlugins()}
                  >
                    <RefreshCw className={cn('mr-2 size-3.5', pluginsLoading && 'animate-spin')} />
                    Refresh
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showInstalledPluginsOnly}
                      onCheckedChange={setShowInstalledPluginsOnly}
                    />
                    <span className="whitespace-nowrap text-xs font-medium text-foreground">
                      Installed
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </HeaderPage>
        <div ref={parentRef} className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto! first-step-setup-local-provider">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{filteredModels.length} models</span>
              <span className="text-border">/</span>
              <span>{hubStats.downloadedModels} local</span>
              <span className="text-border">/</span>
              <span>{hubStats.totalPlugins || 0} plugins</span>
              <span className="text-border">/</span>
              <span>
                {pluginSnapshot
                  ? `${hubStats.totalMarketplaces} sources`
                  : 'marketplace idle'}
              </span>
            </div>
            {activeHubSection === 'plugins' ? (
              <PluginMarketplaceSection
                plugins={pluginDescriptors}
                visiblePlugins={filteredPlugins}
                marketplaces={marketplaceDescriptors}
                skills={skillDescriptors}
                pluginsLoading={pluginsLoading}
                pluginsError={pluginsError}
                showInstalledOnly={showInstalledPluginsOnly}
                searchValue={pluginSearchValue}
                onInstalledOnlyChange={setShowInstalledPluginsOnly}
                onRefresh={() => void refreshPlugins()}
                onAddOpenAiPluginsMarketplace={() =>
                  void addOpenAiPluginsMarketplace()
                }
                onPluginAction={(plugin, action) =>
                  void runPluginAction(plugin, action)
                }
              />
            ) : (
              <>
            <ModelHubFilters
              formatFilter={modelFormatFilter}
              capabilityFilter={modelCapabilityFilter}
              counts={modelFilterCounts}
              onFormatFilterChange={(value) => {
                setIsInitialLoad(true)
                setModelFormatFilter(value)
              }}
              onCapabilityFilterChange={(value) => {
                setIsInitialLoad(true)
                setModelCapabilityFilter(value)
              }}
            />
            {/* Show skeleton immediately on navigation, then show actual content when loaded */}
            {(isInitialLoad || (loading && !filteredModels.length)) ? (
              // Skeleton loading state for better perceived performance
              <div className="flex flex-col gap-3 animate-pulse">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-border rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="h-5 bg-muted rounded w-1/3" />
                      <div className="flex items-center gap-3">
                        <div className="h-4 bg-muted rounded w-20" />
                        <div className="h-8 w-8 bg-muted rounded" />
                      </div>
                    </div>
                    <div className="mt-3 h-4 bg-muted rounded w-full" />
                    <div className="mt-2 h-4 bg-muted rounded w-2/3" />
                    <div className="flex items-center gap-4 mt-3">
                      <div className="h-4 bg-muted rounded w-16" />
                      <div className="h-4 bg-muted rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  {t('hub:noModels')}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'flex flex-col gap-4 pb-2 mb-2 transition-opacity duration-200',
                  isPending ? 'opacity-70' : 'opacity-100'
                )}
              >
                <FeaturedModelGrid
                  models={featuredModels}
                  onOpenModel={handleOpenModel}
                />
                <div className="flex items-center gap-2 justify-end sm:hidden">
                  {renderFilter()}
                </div>
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                        paddingBottom: 8,
                      }}
                    >
                      <Card
                        header={
                          <div className="flex items-start justify-between gap-x-3">
                            <div
                              className="cursor-pointer min-w-0 flex-1"
                              onClick={() => {
                                navigate({
                                  to: route.hub.model,
                                  params: {
                                    modelId:
                                      filteredModels[virtualItem.index]
                                        .model_name,
                                  },
                                })
                              }}
                            >
                              <h1
                                className={cn(
                                  'text-foreground font-medium text-base capitalize sm:max-w-none',
                                  isRecommendedModel(
                                    filteredModels[virtualItem.index]
                                      .model_name
                                  )
                                    ? 'hub-model-card-step'
                                    : ''
                                )}
                                title={
                                  extractModelName(
                                    filteredModels[virtualItem.index]
                                      .model_name
                                  ) || ''
                                }
                              >
                                {extractModelName(
                                  filteredModels[virtualItem.index].model_name
                                ) || ''}
                              </h1>
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground font-medium text-xs">
                                  {filteredModels[virtualItem.index].is_mlx
                                    ? formatBytes(
                                        sumMlxModelBytes(
                                          filteredModels[virtualItem.index]
                                        ) || undefined
                                      )
                                    : selectDefaultQuant(
                                        filteredModels[virtualItem.index].quants,
                                        DEFAULT_MODEL_QUANTIZATIONS
                                      )?.file_size}
                                </span>
                                <ModelInfoHoverCard
                                  model={filteredModels[virtualItem.index]}
                                  defaultModelQuantizations={
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  }
                                  variant={selectDefaultQuant(
                                    filteredModels[virtualItem.index].quants,
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  )}
                                  isDefaultVariant={true}
                                />
                              </div>
                              {filteredModels[virtualItem.index].is_mlx ? (
                                <MlxModelDownloadAction
                                  model={filteredModels[virtualItem.index]}
                                />
                              ) : (
                                <DownloadButtonPlaceholder
                                  model={filteredModels[virtualItem.index]}
                                  handleUseModel={handleUseModel}
                                />
                              )}
                            </div>
                          </div>
                        }
                      >
                        <div className="line-clamp-2 mt-3 text-muted-foreground leading-normal">
                          <RenderMarkdown
                            className="select-none reset-heading"
                            components={{
                              a: ({ ...props }) => (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                />
                              ),
                            }}
                            content={
                              extractDescription(
                                filteredModels[virtualItem.index]?.description
                              ) || ''
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="capitalize text-foreground">
                            {t('hub:by')}{' '}
                            {filteredModels[virtualItem.index]?.developer}
                          </span>
                          <div className="flex items-center gap-4 ml-2">
                            <div className="flex items-center gap-1">
                              <IconDownload
                                size={18}
                                className="text-muted-foreground"
                                title={t('hub:downloads')}
                              />
                              <span className="text-foreground">
                                {filteredModels[virtualItem.index]
                                  .downloads || 0}
                              </span>
                            </div>
                            {!filteredModels[virtualItem.index].is_mlx && (
                              <div className="flex items-center gap-1">
                                <IconFileCode
                                  size={20}
                                  className="text-muted-foreground"
                                  title={t('hub:variants')}
                                />
                                <span className="text-foreground">
                                  {filteredModels[virtualItem.index].quants
                                    ?.length || 0}
                                </span>
                              </div>
                            )}
                            {filteredModels[virtualItem.index].is_mlx && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                                    MLX
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Requires MLX engine (Apple Silicon only)</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <div className="flex gap-1.5 items-center">
                              {(filteredModels[virtualItem.index].num_mmproj ?? 0) >
                                0 && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-foreground/80">
                                  <IconEye size={13} />
                                  {t('multimodal')}
                                </span>
                              )}
                              {filteredModels[virtualItem.index].tools && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-foreground/80">
                                  <IconTool size={13} />
                                  {t('tools')}
                                </span>
                              )}
                            </div>
                          </div>
                          {(filteredModels[virtualItem.index].quants?.length ?? 0) >
                            1 && (
                            <button
                              className="flex items-center gap-1 hub-show-variants-step ml-auto"
                              onClick={() =>
                                toggleModelExpansion(
                                  filteredModels[virtualItem.index]
                                    .model_name
                                )
                              }
                            >
                              <span className="text-foreground">
                                {t('hub:showVariants')}
                              </span>
                              {expandedModels[
                                filteredModels[virtualItem.index].model_name
                              ] ? (
                                <IconChevronUp
                                  size={18}
                                  className="text-muted-foreground"
                                />
                              ) : (
                                <IconChevronDown
                                  size={18}
                                  className="text-muted-foreground"
                                />
                              )}
                            </button>
                          )}
                        </div>
                        {expandedModels[
                          filteredModels[virtualItem.index].model_name
                        ] &&
                          (filteredModels[virtualItem.index].quants?.length ?? 0) >
                            0 &&
                          (() => {
                            const quants =
                              filteredModels[virtualItem.index].quants ?? []
                            const recommendedId = selectDefaultQuant(
                              quants,
                              DEFAULT_MODEL_QUANTIZATIONS
                            )?.model_id
                            return (
                            <div className="mt-5">
                              {quants.map(
                                (variant) => (
                                  <CardItem
                                    key={variant.model_id}
                                    title={
                                      <div className="flex items-center gap-2">
                                        <span>{variant.model_id}</span>
                                        {(() => {
                                          const tier = getQuantTier(
                                            variant.model_id
                                          )
                                          return tier ? (
                                            <span
                                              className={cn(
                                                'text-xs font-medium px-1.5 py-0.5 rounded',
                                                tier.className
                                              )}
                                            >
                                              {tier.label}
                                            </span>
                                          ) : null
                                        })()}
                                        {variant.model_id === recommendedId && (
                                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                            Recommended
                                          </span>
                                        )}
                                      </div>
                                    }
                                    actions={
                                      <div className="flex items-center gap-2">
                                        <p className="text-muted-foreground font-medium text-xs">
                                          {variant.file_size}
                                        </p>
                                        <ModelInfoHoverCard
                                          model={
                                            filteredModels[virtualItem.index]
                                          }
                                          variant={variant}
                                          defaultModelQuantizations={
                                            DEFAULT_MODEL_QUANTIZATIONS
                                          }
                                        />
                                        {filteredModels[virtualItem.index]
                                          .is_mlx ? (
                                          <MlxModelDownloadAction
                                            model={
                                              filteredModels[virtualItem.index]
                                            }
                                          />
                                        ) : (
                                          <ModelDownloadAction
                                            variant={variant}
                                            model={
                                              filteredModels[virtualItem.index]
                                            }
                                          />
                                        )}
                                      </div>
                                    }
                                  />
                                )
                              )}
                            </div>
                            )
                          })()}
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
