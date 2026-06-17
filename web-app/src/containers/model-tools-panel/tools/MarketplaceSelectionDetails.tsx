import type { CodexPluginDescriptor, CodexSkillDescriptor } from '../shared/codex-helpers'

type MarketplaceSelectionDetailsProps = {
  currentThreadIdForCaps: string | null | undefined
  marketplaceBusy: boolean
  selectedCodexPluginDescriptor?: CodexPluginDescriptor | null
  selectedCodexPluginMetadataKeys: string[]
  selectedCodexSkillDescriptor?: CodexSkillDescriptor | null
  onCopyPluginMetadata: () => void | Promise<void>
  onReadPlugin: () => void
  onInstallPlugin: () => void
  onUninstallPlugin: () => void
  onReadSkill: () => void
  onWriteSkillConfig: () => void
}

export function MarketplaceSelectionDetails({
  currentThreadIdForCaps,
  marketplaceBusy,
  selectedCodexPluginDescriptor,
  selectedCodexPluginMetadataKeys,
  selectedCodexSkillDescriptor,
  onCopyPluginMetadata,
  onReadPlugin,
  onInstallPlugin,
  onUninstallPlugin,
  onReadSkill,
  onWriteSkillConfig,
}: MarketplaceSelectionDetailsProps) {
  if (!selectedCodexPluginDescriptor && !selectedCodexSkillDescriptor) {
    return null
  }

  const selectedPluginInstalled = Boolean(selectedCodexPluginDescriptor?.installed)

  return (
    <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
      {selectedCodexPluginDescriptor ? (
        <div className="rounded border bg-background/40 p-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[9px]">Plugin detail</span>
            <span className="text-[9px] text-muted-foreground">
              {selectedCodexPluginDescriptor.installed ? 'installed' : 'available'}
            </span>
          </div>
          <div className="space-y-0.5 text-[9px]">
            <div className="truncate">
              <span className="text-muted-foreground">id:</span>{' '}
              {selectedCodexPluginDescriptor.id}
            </div>
            <div className="truncate">
              <span className="text-muted-foreground">name:</span>{' '}
              {selectedCodexPluginDescriptor.name ?? '—'}
            </div>
            <div className="truncate">
              <span className="text-muted-foreground">version:</span>{' '}
              {selectedCodexPluginDescriptor.version ?? '—'}
            </div>
            <div className="line-clamp-2">
              <span className="text-muted-foreground">description:</span>{' '}
              {selectedCodexPluginDescriptor.description ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">metadata keys:</span>
              {selectedCodexPluginMetadataKeys.length ? (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {selectedCodexPluginMetadataKeys.slice(0, 12).map((key) => (
                    <span
                      key={key}
                      className="max-w-full truncate rounded border bg-background/60 px-1 py-0.5 font-mono"
                      title={key}
                    >
                      {key}
                    </span>
                  ))}
                  {selectedCodexPluginMetadataKeys.length > 12 ? (
                    <span className="rounded border bg-background/60 px-1 py-0.5 text-muted-foreground">
                      +{selectedCodexPluginMetadataKeys.length - 12}
                    </span>
                  ) : null}
                </div>
              ) : (
                <span> —</span>
              )}
            </div>
          </div>
          {selectedCodexPluginDescriptor.raw ? (
            <details className="mt-1 rounded border bg-background/60 p-1">
              <summary className="cursor-pointer text-[9px] text-muted-foreground">
                Raw plugin metadata JSON
              </summary>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px]">
                {JSON.stringify(selectedCodexPluginDescriptor.raw, null, 2)}
              </pre>
            </details>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!selectedCodexPluginDescriptor.raw}
              onClick={() => void onCopyPluginMetadata()}
            >
              Copy metadata
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!currentThreadIdForCaps || marketplaceBusy}
              onClick={onReadPlugin}
            >
              Read
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={
                !currentThreadIdForCaps || marketplaceBusy || selectedPluginInstalled
              }
              onClick={onInstallPlugin}
            >
              {selectedPluginInstalled ? 'Installed' : 'Install'}
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={
                !currentThreadIdForCaps || marketplaceBusy || !selectedPluginInstalled
              }
              onClick={onUninstallPlugin}
            >
              Uninstall
            </button>
          </div>
        </div>
      ) : null}
      {selectedCodexSkillDescriptor ? (
        <div className="rounded border bg-background/40 p-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[9px]">Skill detail</span>
            <span className="text-[9px] text-muted-foreground">
              {selectedCodexSkillDescriptor.enabled
                ? 'enabled'
                : selectedCodexSkillDescriptor.pluginId ?? 'skill'}
            </span>
          </div>
          <div className="space-y-0.5 text-[9px]">
            <div className="truncate">
              <span className="text-muted-foreground">id:</span>{' '}
              {selectedCodexSkillDescriptor.id}
            </div>
            <div className="truncate">
              <span className="text-muted-foreground">name:</span>{' '}
              {selectedCodexSkillDescriptor.name ?? '—'}
            </div>
            <div className="truncate">
              <span className="text-muted-foreground">plugin:</span>{' '}
              {selectedCodexSkillDescriptor.pluginId ?? '—'}
            </div>
            <div className="line-clamp-2">
              <span className="text-muted-foreground">description:</span>{' '}
              {selectedCodexSkillDescriptor.description ?? '—'}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={
                !currentThreadIdForCaps ||
                marketplaceBusy ||
                !selectedCodexSkillDescriptor.pluginId
              }
              onClick={onReadSkill}
            >
              Read skill
            </button>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={!currentThreadIdForCaps || marketplaceBusy}
              onClick={onWriteSkillConfig}
            >
              Write config
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
