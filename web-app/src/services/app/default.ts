/**
 * Default App Service - Generic implementation with minimal returns
 */

import type { AppService, FactoryResetOptions, LogEntry } from './types'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

export class DefaultAppService implements AppService {
  async factoryReset(options?: FactoryResetOptions): Promise<void> {
    console.log('factoryReset called with options:', options)
    // No-op
  }

  async readLogs(): Promise<LogEntry[]> {
    return []
  }

  parseLogLine(line: string): LogEntry {
    return {
      timestamp: Date.now(),
      level: 'info',
      target: 'default',
      message: line ?? '',
    }
  }

  async getParloDataFolder(): Promise<string | undefined> {
    return undefined
  }

  async relocateParloDataFolder(path: string): Promise<void> {
    console.log('relocateParloDataFolder called with path:', path)
    // No-op - not implemented in default service
  }

  async getServerStatus(): Promise<boolean> {
    const { serverHost, serverPort, apiPrefix } = useLocalApiServer.getState()
    if (!serverPort) return false

    const prefix = apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`
    const statusUrl = `http://${serverHost}:${serverPort}${prefix}`

    try {
      const response = await fetch(statusUrl, {
        method: 'GET',
        cache: 'no-store',
      })
      return response.ok || response.status === 401
    } catch {
      return false
    }
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    console.log('readYaml called with path:', path)
    throw new Error('readYaml not implemented in default app service')
  }
}
