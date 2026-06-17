import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ServerHostSwitcher } from '@/containers/ServerHostSwitcher'
import { PortInput } from '@/containers/PortInput'
import { ProxyTimeoutInput } from '@/containers/ProxyTimeoutInput'
import { ApiPrefixInput } from '@/containers/ApiPrefixInput'
import { TrustedHostsInput } from '@/containers/TrustedHostsInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { IconSettings2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LogViewer } from '@/components/LogViewer'
import { ensureModelForServer } from '@/utils/ensureModelForServer'
import {
  buildGatewayCurlExample,
  buildLocalApiBaseUrl,
  formatGatewayModelId,
  gatewayBareModelId,
  getGatewayUpstreamProviders,
  hasGatewayUpstreamProviders,
} from '@/lib/local-api-gateway'
import { CopyButton } from '@/containers/CopyButton'
import { getProviderTitle, isLocalProvider } from '@/lib/utils'

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
} from '@tabler/icons-react'
import { ChevronsUpDown } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.local_api_server as any)({
  component: LocalAPIServerContent,
})

function LocalAPIServerContent() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    corsEnabled,
    setCorsEnabled,
    verboseLogs,
    setVerboseLogs,
    enableOnStartup,
    setEnableOnStartup,
    serverHost,
    serverPort,
    setServerPort: _setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    proxyTimeout,
    setLastServerModels,
    defaultModelLocalApiServer,
    setDefaultModelLocalApiServer,
  } = useLocalApiServer()

  const providers = useModelProvider((state) => state.providers)
  const localModels = useMemo(
    () =>
      providers
        .filter((p) => isLocalProvider(p.provider))
        .flatMap((p) => p.models.map((m) => ({ id: m.id, provider: p.provider }))),
    [providers]
  )

  const gatewayProviders = useMemo(
    () => getGatewayUpstreamProviders(providers),
    [providers]
  )

  const gatewayModels = useMemo(
    () =>
      gatewayProviders.flatMap((p) =>
        p.models.map((m) => ({
          id: formatGatewayModelId(p.provider, m.id),
          provider: p.provider,
        }))
      ),
    [gatewayProviders]
  )

  const prefixedLocalModels = useMemo(
    () =>
      localModels.map((m) => ({
        ...m,
        id: formatGatewayModelId(m.provider, m.id),
      })),
    [localModels]
  )

  const defaultModelOptions = useMemo(
    () => [
      ...gatewayModels.map((m) => ({
        model: gatewayBareModelId(m.id),
        provider: m.provider,
        label: m.id,
        kind: 'remote' as const,
      })),
      ...localModels.map((m) => ({
        model: m.id,
        provider: m.provider,
        label: formatGatewayModelId(m.provider, m.id),
        kind: 'local' as const,
      })),
    ],
    [gatewayModels, localModels]
  )

  const selectedDefaultModelLabel = useMemo(() => {
    if (!defaultModelLocalApiServer) return null
    return formatGatewayModelId(
      defaultModelLocalApiServer.provider,
      defaultModelLocalApiServer.model
    )
  }, [defaultModelLocalApiServer])

  const exampleGatewayModel = useMemo(() => {
    if (defaultModelLocalApiServer) {
      return formatGatewayModelId(
        defaultModelLocalApiServer.provider,
        defaultModelLocalApiServer.model
      )
    }
    if (gatewayModels.length > 0) return gatewayModels[0].id
    if (prefixedLocalModels.length > 0) return prefixedLocalModels[0].id
    return 'openai/gpt-4o'
  }, [defaultModelLocalApiServer, gatewayModels, prefixedLocalModels])

  const baseUrl = useMemo(
    () =>
      buildLocalApiBaseUrl({
        host: serverHost,
        port: serverPort,
        prefix: apiPrefix,
      }),
    [serverHost, serverPort, apiPrefix]
  )

  const curlExample = useMemo(
    () =>
      buildGatewayCurlExample({
        baseUrl,
        apiKey: apiKey?.toString() ?? '',
        modelId: exampleGatewayModel,
      }),
    [baseUrl, apiKey, exampleGatewayModel]
  )

  const canStartGatewayOnly = hasGatewayUpstreamProviders(providers)

  const { serverStatus, setServerStatus } = useAppState()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const setActiveModels = useAppState((state) => state.setActiveModels)

  useEffect(() => {
    const checkServerStatus = async () => {
      try {
        const running = await serviceHub.app().getServerStatus()
        console.log('Server status check:', running)
        if (running) {
          setServerStatus('running')
        }
      } catch (error) {
        console.error('Failed to check server status:', error)
      }
    }
    checkServerStatus()

    // Also check when window gains focus (e.g., server started from another page)
    const handleFocus = () => checkServerStatus()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [serviceHub, setServerStatus])

  const [isModelLoading, setIsModelLoading] = useState(false)

  const toggleAPIServer = async () => {
    // Validate API key before starting server
    if (serverStatus === 'stopped') {
      console.log('Starting server with port:', serverPort)
      toast.info('Starting server...', {
        description: `Attempting to start server on port ${serverPort}`,
      })

      // if (!apiKey || apiKey.toString().trim().length === 0) {
      //   setShowApiKeyError(true)
      //   return
      // }

      setShowApiKeyError(false)

      setServerStatus('pending')

      ensureModelForServer({
        modelsService: serviceHub.models(),
        modelOverride: defaultModelLocalApiServer,
        onLoadStart: () => setIsModelLoading(true),
        onLoadEnd: () => setIsModelLoading(false),
      })
        .then(async (result) => {
          if (result.status === 'no_model_available') {
            throw new Error(
              canStartGatewayOnly
                ? 'No local model available to load'
                : 'No model available to load. Add a local model or configure a remote provider with an API key.'
            )
          }

          if (result.status === 'gateway_only') {
            toast.info('Starting API gateway', {
              description:
                'Routing requests through your configured remote providers.',
            })
            return
          }

          // Remember loaded models for next startup
          const activeModels = await serviceHub.models().getActiveModels()
          if (activeModels && activeModels.length > 0) {
            const allProviders = useModelProvider.getState().providers
            const serverModels = activeModels.flatMap((id: string) => {
              const p = allProviders.find((p) =>
                p?.models?.some((m: { id: string }) => m.id === id)
              )
              return p ? [{ model: id, provider: p.provider }] : []
            })
            if (serverModels.length > 0) setLastServerModels(serverModels)
          }

          // Refresh active models in app state
          const models = await serviceHub.models().getActiveModels()
          setActiveModels(models || [])
        })
        .then(async () => {
          // Then start the server
          const { ensureLocalApiServerRunning } = await import(
            '@/lib/ensure-local-api-server'
          )
          return ensureLocalApiServerRunning({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
            proxyTimeout: proxyTimeout,
          })
        })
        .then((_actualPort: number) => {
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Error starting server or model:', error)
          setServerStatus('stopped')
          setIsModelLoading(false) // Reset loading state on error
          toast.dismiss()

          // Extract error message from various error formats
          const errorMsg =
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error)

          // Port-related errors (highest priority)
          if (errorMsg.includes('Address already in use')) {
            toast.error('Port has been occupied', {
              description: `Port ${serverPort} is already in use. Please try a different port.`,
            })
          }
          // Model-related errors
          else if (errorMsg.includes('Invalid or inaccessible model path')) {
            toast.error('Invalid or inaccessible model path', {
              description: errorMsg,
            })
          } else if (errorMsg.includes('model')) {
            toast.error('Failed to start model', {
              description: errorMsg,
            })
          }
          // Generic server errors
          else {
            toast.error('Failed to start server', {
              description: errorMsg,
            })
          }
        })
    } else {
      setServerStatus('pending')
      window.core?.api
        ?.stopServer()
        .then(() => {
          setServerStatus('stopped')
        })
        .catch((error: unknown) => {
          console.error('Error stopping server:', error)
          setServerStatus('stopped')
        })
    }
  }

  const getButtonContent = () => {
    if (isModelLoading || serverStatus === 'pending') {
      return (
        <>
          <IconLoader2 size={14} className="animate-spin" />
          {isModelLoading
            ? t('settings:localApiServer.loadingModel')
            : t('settings:localApiServer.startingServer')}
        </>
      )
    }
    return isServerRunning
      ? t('settings:localApiServer.stopServer')
      : t('settings:localApiServer.startServer')
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLocalApiServerLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
  }

  const isServerRunning = serverStatus !== 'stopped'

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div
          className={cn(
            'flex items-center justify-between w-full mr-2 pr-3',
            !IS_MACOS && 'pr-30'
          )}
        >
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="relative z-50">
                <IconSettings2 size={16} />
                Configuration
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[480px] max-h-[70vh] overflow-y-auto"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="font-semibold text-sm">
                    {t('settings:localApiServer.serverConfiguration')}
                  </h2>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.serverHost')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.serverHostDesc')}
                      </p>
                    </div>
                    <div>
                      <ServerHostSwitcher isServerRunning={isServerRunning} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.serverPort')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.serverPortDesc')}
                      </p>
                    </div>
                    <PortInput isServerRunning={isServerRunning} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.apiPrefix')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.apiPrefixDesc')}
                      </p>
                    </div>
                    <ApiPrefixInput isServerRunning={isServerRunning} />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">
                      {t('settings:localApiServer.apiKey')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings:localApiServer.apiKeyDesc')}
                    </p>
                    <div className="pt-1">
                      <ApiKeyInput
                        isServerRunning={isServerRunning}
                        showError={showApiKeyError}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">
                      {t('settings:localApiServer.trustedHosts')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings:localApiServer.trustedHostsDesc')}
                    </p>
                    <div className="pt-1">
                      <TrustedHostsInput isServerRunning={isServerRunning} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.proxyTimeout')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.proxyTimeoutDesc')}
                      </p>
                    </div>
                    <ProxyTimeoutInput isServerRunning={isServerRunning} />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
                  <h2 className="font-semibold text-sm">
                    {t('settings:localApiServer.advancedSettings')}
                  </h2>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.cors')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.corsDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={corsEnabled}
                      onCheckedChange={setCorsEnabled}
                      disabled={isServerRunning}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('settings:localApiServer.verboseLogs')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings:localApiServer.verboseLogsDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={verboseLogs}
                      onCheckedChange={setVerboseLogs}
                      disabled={isServerRunning}
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="flex-1 flex flex-col min-h-0 pl-0">
          <div className="flex-1 overflow-y-auto p-4 pt-0">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              {/* General Settings */}
              <Card
                header={
                  <div className="mb-3 flex w-full items-center border-b pb-2">
                    <div className="w-full space-y-2">
                      <h1 className="text-base font-medium text-foreground font-studio">
                        {t('settings:localApiServer.title')}
                      </h1>
                      <p className="text-muted-foreground mb-2">
                        {t('settings:localApiServer.description')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={toggleAPIServer}
                        variant={isServerRunning ? 'destructive' : 'default'}
                        size="sm"
                        disabled={serverStatus === 'pending' || isModelLoading}
                      >
                        {getButtonContent()}
                      </Button>
                    </div>
                  </div>
                }
              >
                <CardItem
                  title={t('settings:localApiServer.runOnStartup')}
                  description={t('settings:localApiServer.runOnStartupDesc')}
                  actions={
                    <Switch
                      checked={enableOnStartup}
                      onCheckedChange={(checked) => {
                        setEnableOnStartup(checked)
                      }}
                    />
                  }
                />
                <CardItem
                  title={t('settings:localApiServer.defaultModel')}
                  description={t('settings:localApiServer.defaultModelDesc')}
                  actions={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-52 justify-between"
                        >
                          <span className="truncate">
                            {selectedDefaultModelLabel ??
                              t(
                                'settings:localApiServer.defaultModelPlaceholder'
                              )}
                          </span>
                          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72 max-h-72 overflow-y-auto">
                        <DropdownMenuItem
                          className={cn(
                            'cursor-pointer my-0.5',
                            !defaultModelLocalApiServer &&
                              'bg-secondary-foreground/8'
                          )}
                          onClick={() => setDefaultModelLocalApiServer(null)}
                        >
                          <span className="truncate">
                            {t('settings:localApiServer.defaultModelNone')}
                          </span>
                        </DropdownMenuItem>
                        {defaultModelOptions.some((m) => m.kind === 'remote') && (
                          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                            {t('settings:localApiServer.defaultModelRemote')}
                          </div>
                        )}
                        {defaultModelOptions
                          .filter((m) => m.kind === 'remote')
                          .map(({ model, provider, label }) => (
                            <DropdownMenuItem
                              key={`${provider}/${model}`}
                              className={cn(
                                'cursor-pointer my-0.5',
                                defaultModelLocalApiServer?.model === model &&
                                  defaultModelLocalApiServer?.provider ===
                                    provider &&
                                  'bg-secondary-foreground/8'
                              )}
                              onClick={() =>
                                setDefaultModelLocalApiServer({
                                  model,
                                  provider,
                                })
                              }
                            >
                              <span className="truncate font-mono text-xs">
                                {label}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        {defaultModelOptions.some((m) => m.kind === 'local') && (
                          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                            {t('settings:localApiServer.defaultModelLocal')}
                          </div>
                        )}
                        {defaultModelOptions
                          .filter((m) => m.kind === 'local')
                          .map(({ model, provider, label }) => (
                            <DropdownMenuItem
                              key={`${provider}/${model}`}
                              className={cn(
                                'cursor-pointer my-0.5',
                                defaultModelLocalApiServer?.model === model &&
                                  defaultModelLocalApiServer?.provider ===
                                    provider &&
                                  'bg-secondary-foreground/8'
                              )}
                              onClick={() =>
                                setDefaultModelLocalApiServer({
                                  model,
                                  provider,
                                })
                              }
                            >
                              <span className="truncate font-mono text-xs">
                                {label}
                              </span>
                              <span className="ml-2 text-[10px] text-muted-foreground">
                                {getProviderTitle(provider)}
                              </span>
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              </Card>

              <Card>
                <CardItem
                  title={t('settings:localApiServer.serverStatus')}
                  description={
                    isServerRunning ? (
                      <div className="space-y-1">
                        <div>{t('settings:localApiServer.serverRunning')}</div>
                        <div className="text-xs font-mono">{baseUrl}</div>
                      </div>
                    ) : (
                      t('settings:localApiServer.serverStopped')
                    )
                  }
                />

                {isServerRunning && (
                  <CardItem
                    title={t('settings:localApiServer.connectAppsTitle')}
                    description={
                      <div className="space-y-3">
                        <p>{t('settings:localApiServer.connectAppsDesc')}</p>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                            <div className="min-w-0">
                              <div className="text-muted-foreground">
                                {t('settings:localApiServer.baseUrl')}
                              </div>
                              <div className="font-mono truncate">{baseUrl}</div>
                            </div>
                            <CopyButton text={baseUrl} />
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                            <div className="min-w-0">
                              <div className="text-muted-foreground">
                                {t('settings:localApiServer.apiKey')}
                              </div>
                              <div className="font-mono truncate">
                                {apiKey?.toString().trim() || t('settings:localApiServer.apiKeyUnset')}
                              </div>
                            </div>
                            {apiKey?.toString().trim() ? (
                              <CopyButton text={apiKey.toString()} />
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {t('settings:localApiServer.exampleRequest')}
                            </span>
                            <CopyButton text={curlExample} />
                          </div>
                          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-relaxed font-mono">
                            {curlExample}
                          </pre>
                        </div>
                        {(gatewayModels.length > 0 || prefixedLocalModels.length > 0) && (
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">
                              {t('settings:localApiServer.availableModels')}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {[...gatewayModels, ...prefixedLocalModels].slice(0, 12).map((m) => (
                                <span
                                  key={`${m.provider}/${m.id}`}
                                  className="rounded border px-1.5 py-0.5 text-[11px] font-mono"
                                >
                                  {m.id}
                                </span>
                              ))}
                              {gatewayModels.length + prefixedLocalModels.length > 12 && (
                                <span className="text-[11px] text-muted-foreground">
                                  +{gatewayModels.length + prefixedLocalModels.length - 12} more
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {t('settings:localApiServer.modelsHint')}
                            </p>
                          </div>
                        )}
                      </div>
                    }
                  />
                )}

                <CardItem
                  title={t('settings:localApiServer.swaggerDocs')}
                  description={t('settings:localApiServer.swaggerDocsDesc')}
                  actions={
                    <a
                      href={`http://${serverHost}:${serverPort}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        isServerRunning ? '' : 'pointer-events-none'
                      )}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isServerRunning}
                        title={t('settings:localApiServer.swaggerDocs')}
                      >
                        <span>{t('settings:localApiServer.openDocs')}</span>
                      </Button>
                    </a>
                  }
                />
              </Card>
            </div>
          </div>
          <div className="p-4 shrink-0">
            <Card>
              <Collapsible defaultOpen={false}>
                <div className="flex items-center justify-between">
                  <CollapsibleTrigger className="flex items-center gap-2 hover:no-underline data-[state=open]:[&>svg.chevron-down]:hidden data-[state=closed]:[&>svg.chevron-up]:hidden">
                    <IconChevronDown size={16} className="chevron-down" />
                    <IconChevronUp size={16} className="chevron-up" />
                    <span className="font-medium text-sm">Server Log</span>
                  </CollapsibleTrigger>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenLogs}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <IconExternalLink size={14} className="mr-1" />
                    Open in New Window
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="pt-3">
                    <div className="h-[200px]">
                      <LogViewer />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
