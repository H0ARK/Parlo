import { getParloDataFolderPath, fs, joinPath, events } from '@parlo-lab/core'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig } from './util'
import { dirname } from '@tauri-apps/api/path'
import { getSystemInfo } from '@parlo-lab/tauri-plugin-hardware-api'
import {
  getLocalInstalledBackendsInternal,
  normalizeFeatures,
  determineSupportedBackends,
  listSupportedBackendsFromRust,
  BackendVersion,
  getSupportedFeaturesFromRust,
} from '@parlo-lab/tauri-plugin-llamacpp-api'

/*
 * Reads currently installed backends in parloDataFolderPath
 *
 */
export async function getLocalInstalledBackends(): Promise<
  { version: string; backend: string }[]
> {
  const parloDataFolderPath = await getParloDataFolderPath()
  const backendDir = await joinPath([
    parloDataFolderPath,
    'llamacpp',
    'backends',
  ])
  return await getLocalInstalledBackendsInternal(backendDir)
}

// folder structure
// <Parlo's data folder>/llamacpp/backends/<backend_version>/<backend_type>

// what should be available to the user for selection?
/**
 * Hardware-supported backends published by upstream. Excludes
 * locally-installed-only entries, so the "recommended backend" calculation
 * isn't biased by user side-loads.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const rawFeatures = await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
  const features = normalizeFeatures(rawFeatures)
  const supportedBackends = await determineSupportedBackends(
    sysInfo.os_type,
    sysInfo.cpu.arch,
    features
  )

  try {
    return await invoke<BackendVersion[]>(
      'plugin:llamacpp|fetch_remote_supported_backends',
      { supportedBackends, proxy: getProxyConfig() }
    )
  } catch (e) {
    console.debug(
      `Not able to get remote backends, Parlo might be offline or network problem: ${String(e)}`
    )
    return []
  }
}

export async function listSupportedBackends(
  checkRemote: boolean = true
): Promise<BackendVersion[]> {
  const remoteBackendVersions = checkRemote ? await fetchRemoteBackends() : []
  const localBackendVersions = await getLocalInstalledBackends()
  return listSupportedBackendsFromRust(remoteBackendVersions, localBackendVersions)
}

export async function getBackendDir(
  backend: string,
  version: string
): Promise<string> {
  const parloDataFolder = await getParloDataFolderPath()
  return invoke<string>('plugin:llamacpp|get_backend_dir', {
    backend,
    version,
    parloDataFolder,
  })
}

export async function getBackendExePath(
  backend: string,
  version: string
): Promise<string> {
  const parloDataFolder = await getParloDataFolderPath()
  return invoke<string>('plugin:llamacpp|get_backend_exe_path', {
    backend,
    version,
    parloDataFolder,
    isWindows: IS_WINDOWS,
  })
}

export async function isBackendInstalled(
  backend: string,
  version: string
): Promise<boolean> {
  const parloDataFolder = await getParloDataFolderPath()
  return invoke<boolean>('plugin:llamacpp|check_backend_installed', {
    backend,
    version,
    parloDataFolder,
    isWindows: IS_WINDOWS,
  })
}

export type BackendVerificationResult = {
  verified: boolean
  missing_libraries: string[]
  resolved_libraries: string[]
}

export async function verifyBackendInstallation(
  backend: string,
  version: string
): Promise<BackendVerificationResult> {
  const parloDataFolder = await getParloDataFolderPath()
  return invoke<BackendVerificationResult>(
    'plugin:llamacpp|verify_backend_installation',
    {
      backend,
      version,
      parloDataFolder,
      isWindows: IS_WINDOWS,
    }
  )
}

export async function downloadBackend(
  backend: string,
  version: string,
  source: 'github' | 'cdn' = 'github'
): Promise<void> {
  const parloDataFolderPath = await getParloDataFolderPath()
  const sysInfo = await getSystemInfo()
  const proxyConfig = getProxyConfig()

  const downloadItems: Array<{
    url: string
    save_path: string
    model_id: string
    proxy?: object
  }> = await invoke('plugin:llamacpp|build_backend_download_items', {
    backend,
    version,
    source,
    parloDataFolder: parloDataFolderPath,
    osType: sysInfo.os_type,
  })

  // Attach proxy config to each item
  const itemsWithProxy = downloadItems.map((item) => ({
    ...item,
    proxy: proxyConfig,
  }))

  const downloadManager = window.core.extensionManager.getByName(
    '@parlo-lab/download-extension'
  )
  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  console.log(
    `Downloading backend ${backend} version ${version} from ${source}: ${JSON.stringify(itemsWithProxy)}`
  )

  let downloadCompleted = false
  try {
    const onProgress = (transferred: number, total: number) => {
      events.emit('onFileDownloadUpdate', {
        modelId: taskId,
        percent: transferred / total,
        size: { transferred, total },
        downloadType,
      })
      downloadCompleted = transferred === total
    }
    await downloadManager.downloadFiles(itemsWithProxy, taskId, onProgress)

    if (!downloadCompleted) {
      events.emit('onFileDownloadStopped', { modelId: taskId, downloadType })
      return
    }

    for (const { save_path } of itemsWithProxy) {
      // Official Windows HIP assets ship as .zip; everything else is .tar.gz.
      if (save_path.endsWith('.tar.gz') || save_path.endsWith('.zip')) {
        const parentDir = await dirname(save_path)
        await invoke('decompress', { path: save_path, outputDir: parentDir })
        await fs.rm(save_path)
      }
    }

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    if (
      source === 'github' &&
      error?.toString() !== 'Error: Download cancelled'
    ) {
      console.warn(`GitHub download failed, falling back to CDN:`, error)
      return await downloadBackend(backend, version, 'cdn')
    }
    console.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}
