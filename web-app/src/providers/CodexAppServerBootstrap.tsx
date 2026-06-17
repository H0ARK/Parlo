import { useEffect } from 'react'
import { ensureGlobalCodexAppServer } from '@/lib/codex-app-server/global-codex-runtime'
import { buildGlobalCodexSpawnOptions } from '@/lib/codex-app-server/chat-backend'
import { ensureLocalApiServerRunning } from '@/lib/ensure-local-api-server'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * Starts the shared Codex app-server process once when the desktop app loads.
 * Chat threads reuse this process instead of spawning their own.
 */
export function CodexAppServerBootstrap() {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const localApi = useLocalApiServer.getState()
        await ensureLocalApiServerRunning({
          host: localApi.serverHost,
          port: localApi.serverPort,
          prefix: localApi.apiPrefix,
          apiKey: localApi.apiKey,
          trustedHosts: localApi.trustedHosts,
          isCorsEnabled: localApi.corsEnabled,
          isVerboseEnabled: localApi.verboseLogs,
          proxyTimeout: localApi.proxyTimeout,
        })
        const spawnOptions = buildGlobalCodexSpawnOptions()
        if (cancelled) return
        if (!isPlatformTauri()) return
        await ensureGlobalCodexAppServer(spawnOptions)
      } catch (error) {
        console.error('Failed to start global Codex app-server:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
