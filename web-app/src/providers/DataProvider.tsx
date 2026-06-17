import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@parlo-lab/core'
import { SystemEvent } from '@/types/events'
import { isDev } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'
import {
  providerHasRemoteAuth,
  providerRemoteAuthKeyChain,
} from '@/lib/provider-api-keys'
import {
  formatGatewayModelId,
  gatewayWireApiForProvider,
  hasGatewayUpstreamProviders,
  isLocalApiGatewayUpstreamProvider,
  resolveGatewayProviderBaseUrl,
} from '@/lib/local-api-gateway'
import { isLocalProvider } from '@/lib/utils'
import { ensureLocalApiServerRunning } from '@/lib/ensure-local-api-server'

type ProviderCustomHeader = {
  header: string
  value: string
}

type RegisterProviderRequest = {
  provider: string
  api_key?: string
  api_keys?: string[]
  base_url?: string
  wire_api?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

async function registerRemoteProvider(provider: ModelProvider) {
  if (!isLocalApiGatewayUpstreamProvider(provider.provider)) return

  const chain = await providerRemoteAuthKeyChain(provider)
  if (chain.length === 0) {
    console.log(`Provider ${provider.provider} has no API key, skipping registration`)
    return
  }

  const request: RegisterProviderRequest = {
    provider: provider.provider,
    api_key: chain[0],
    api_keys: chain.slice(1),
    base_url: resolveGatewayProviderBaseUrl(provider),
    wire_api: gatewayWireApiForProvider(provider.provider),
    custom_headers: (provider.custom_header || []).map((h) => ({
      header: h.header,
      value: h.value,
    })),
    models: provider.models.map((m) =>
      formatGatewayModelId(provider.provider, m.id)
    ),
  }

  try {
    await invoke('register_provider_config', { request })
    console.log(`Registered remote provider: ${provider.provider}`)
  } catch (error) {
    console.error(`Failed to register provider ${provider.provider}:`, error)
  }
}

// Track which providers have been registered so we can unregister stale ones
let registeredProviderNames = new Set<string>()

// Effect to sync remote providers when providers change
const syncRemoteProviders = async () => {
  const providers = useModelProvider.getState().providers
  const currentActive = new Set<string>()

  for (const provider of providers) {
    if (
      provider.active &&
      isLocalApiGatewayUpstreamProvider(provider.provider) &&
      (await providerHasRemoteAuth(provider))
    ) {
      await registerRemoteProvider(provider)
      currentActive.add(provider.provider)
    }
  }

  // Unregister providers that were previously registered but are now inactive/removed
  for (const name of registeredProviderNames) {
    if (!currentActive.has(name)) {
      invoke('unregister_provider_config', { provider: name }).catch(() => {})
    }
  }

  registeredProviderNames = currentActive
}

export function DataProvider() {
  const { setProviders, getProviderByName } =
    useModelProvider()

  const { checkForUpdate } = useAppUpdater()
  const autoUpdateCheck = useGeneralSetting((s) => s.autoUpdateCheck)
  const { setServers, setSettings } = useMCPServers()
  const { setAssistants } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  // Local API Server hooks
  const {
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort: _setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    lastServerModels,
    setLastServerModels,
    defaultModelLocalApiServer,
  } = useLocalApiServer()
  const setServerStatus = useAppState((state) => state.setServerStatus)

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then((providers) => {
      setProviders(providers)
      // Register active remote providers with the backend
      void Promise.all(
        providers.map(async (provider) => {
          if (
            provider.active &&
            isLocalApiGatewayUpstreamProvider(provider.provider)
          ) {
            await registerRemoteProvider(provider)
            registeredProviderNames.add(provider.provider)
          }
        })
      )
    })
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
        setSettings(data.mcpSettings ?? DEFAULT_MCP_SETTINGS)
      })
    serviceHub
      .assistants()
      .getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
        } else {
          setAssistants(null)
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    serviceHub.deeplink().getCurrent().then(handleDeepLink)
    serviceHub.deeplink().onOpenUrl(handleDeepLink)

    // Listen for deep link events
    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const deep_link = event.payload as string
        handleDeepLink([deep_link])
      })
      .then((unsub) => {
        unsubscribe = unsub
      })
    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    serviceHub
      .threads()
      .fetchThreads()
      .then((threads) => {
        setThreads(threads)
      })
  }, [serviceHub, setThreads])

  // Sync remote providers with backend when providers change
  const providers = useModelProvider((s) => s.providers)
  useEffect(() => {
    void syncRemoteProviders()
  }, [providers])

  // Check for app updates - initial check and periodic interval
  useEffect(() => {
    // Only check for updates if the auto updater is not disabled
    // App might be distributed via other package managers
    // or methods that handle updates differently
    if (isDev() || !autoUpdateCheck) {
      return
    }

    // Defer the initial check until the browser is idle (after first paint) so
    // the network round-trip and any resulting dialog don't compete with the
    // initial render.
    const hasRic = typeof window.requestIdleCallback === 'function'
    const idleHandle = hasRic
      ? window.requestIdleCallback(() => checkForUpdate(), { timeout: 3000 })
      : window.setTimeout(() => checkForUpdate(), 0)

    // Set up periodic update checks (singleton - only runs in DataProvider)
    const intervalId = setInterval(() => {
      console.log('Periodic update check triggered')
      checkForUpdate()
    }, Number(UPDATE_CHECK_INTERVAL_MS))

    // Cleanup interval on unmount
    return () => {
      if (hasRic) window.cancelIdleCallback(idleHandle as number)
      else window.clearTimeout(idleHandle as number)
      clearInterval(intervalId)
    }
  }, [checkForUpdate, autoUpdateCheck])

  useEffect(() => {
    events.on(AppEvent.onModelImported, () => {
      serviceHub.providers().getProviders().then((providers) => {
        setProviders(providers)
        syncRemoteProviders()
      })
    })
  }, [serviceHub, setProviders])

  // Auto-start Local API Server on app startup if enabled
  useEffect(() => {
    if (enableOnStartup) {
      // Check if server is already running
      serviceHub
        .app()
        .getServerStatus()
        .then(async (isRunning) => {
          if (isRunning) {
            console.log('Local API Server is already running')
            setServerStatus('running')
            return
          }

          setServerStatus('pending')

          // Start model(s): prefer user-configured default, fall back to last session's models
          const modelsToStart = (() => {
            if (defaultModelLocalApiServer) {
              return [defaultModelLocalApiServer]
            }
            return lastServerModels
          })()

          const localModelsToStart = modelsToStart.filter(({ provider: providerName }) => {
            const provider = getProviderByName(providerName)
            return provider && isLocalProvider(provider.provider)
          })

          if (localModelsToStart.length > 0) {
            await Promise.allSettled(
              localModelsToStart.map(async ({ model, provider: providerName }) => {
                const provider = getProviderByName(providerName)
                if (!provider) return
                try {
                  await serviceHub.models().startModel(provider, model, true)
                  console.log(`Auto-started server model: ${model}`)
                } catch (err) {
                  console.warn(`Failed to auto-start server model ${model}:`, err)
                }
              })
            )
          } else if (
            !hasGatewayUpstreamProviders(useModelProvider.getState().providers)
          ) {
            console.warn(
              'Skipping Local API Server auto-start: no local model and no configured remote providers'
            )
            setServerStatus('stopped')
            return
          }

          return ensureLocalApiServerRunning({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
            proxyTimeout: proxyTimeout,
          }).then(async (_actualPort: number) => {
              setServerStatus('running')
              // Persist whichever models are actually running so next startup can restore them
              const activeModels = await serviceHub.models().getActiveModels().catch(() => [] as string[])
              if (activeModels.length > 0) {
                const allProviders = useModelProvider.getState().providers
                const serverModels = activeModels.flatMap((id) => {
                  const p = allProviders.find((p) => p?.models?.some((m: { id: string }) => m.id === id))
                  return p ? [{ model: id, provider: p.provider }] : []
                })
                if (serverModels.length > 0) setLastServerModels(serverModels)
              }
            })
        })
        .catch((error: unknown) => {
          console.error('Failed to start Local API Server on startup:', error)
          setServerStatus('stopped')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  const handleDeepLink = (urls: string[] | null) => {
    if (!urls) return
    console.log('Received deeplink:', urls)
    const deeplink = urls[0]
    if (deeplink) {
      const url = new URL(deeplink)
      const params = url.pathname.split('/').filter((str) => str.length > 0)

      if (params.length < 3) return undefined
      // const action = params[0]
      // const provider = params[1]
      const resource = params.slice(1).join('/')
      // return { action, provider, resource }
      navigate({
        to: route.hub.model,
        search: {
          repo: resource,
        },
      })
    }
  }

  return null
}
