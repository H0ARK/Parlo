import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { getServiceHub } from '@/hooks/useServiceHub'

export type LocalApiServerStartConfig = {
  host: string
  port: number
  prefix: string
  apiKey: string
  trustedHosts: string[]
  isCorsEnabled: boolean
  isVerboseEnabled: boolean
  proxyTimeout: number
  enableServerToolExecution?: boolean
}

let startInFlight: Promise<number> | null = null

function isServerAlreadyRunningError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return message.includes('Server is already running')
}

/**
 * Start the local API server once, even if multiple callers race on startup.
 * Returns the listening port (may differ from the requested port when port is 0).
 */
export async function ensureLocalApiServerRunning(
  config: LocalApiServerStartConfig
): Promise<number> {
  const serviceHub = getServiceHub()
  const localApi = useLocalApiServer.getState()

  const running = await serviceHub.app().getServerStatus().catch(() => false)
  if (running) {
    return localApi.serverPort
  }

  if (!startInFlight) {
    startInFlight = (async () => {
      try {
        const actualPort = await window.core?.api?.startServer({
          host: config.host,
          port: config.port,
          prefix: config.prefix,
          apiKey: config.apiKey,
          trustedHosts: config.trustedHosts,
          isCorsEnabled: config.isCorsEnabled,
          isVerboseEnabled: config.isVerboseEnabled,
          proxyTimeout: config.proxyTimeout,
          enableServerToolExecution: config.enableServerToolExecution,
        })

        if (!actualPort) {
          throw new Error('startServer returned no port')
        }

        if (actualPort !== localApi.serverPort) {
          localApi.setServerPort(actualPort)
        }

        return actualPort
      } catch (error) {
        if (isServerAlreadyRunningError(error)) {
          const portAfterRace = useLocalApiServer.getState().serverPort
          return portAfterRace || config.port
        }
        throw error
      } finally {
        startInFlight = null
      }
    })()
  }

  return startInFlight
}