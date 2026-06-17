import { IconPackage, IconPuzzle } from '@tabler/icons-react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type {
  CodexMarketplaceDescriptor,
  CodexPluginDescriptor,
  CodexSkillDescriptor,
} from '@/containers/model-tools-panel/shared/codex-helpers'

type PluginMarketplaceSectionProps = {
  plugins: CodexPluginDescriptor[]
  visiblePlugins: CodexPluginDescriptor[]
  marketplaces: CodexMarketplaceDescriptor[]
  skills: CodexSkillDescriptor[]
  pluginsLoading: boolean
  pluginsError: string | null
  showInstalledOnly: boolean
  searchValue: string
  onInstalledOnlyChange: (value: boolean) => void
  onRefresh: () => void
  onAddOpenAiPluginsMarketplace: () => void
  onPluginAction: (plugin: CodexPluginDescriptor, action: 'install' | 'uninstall') => void
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  )
}

export function PluginMarketplaceSection({
  plugins,
  visiblePlugins,
  marketplaces,
  skills,
  pluginsLoading,
  pluginsError,
  showInstalledOnly,
  searchValue,
  onInstalledOnlyChange,
  onRefresh,
  onAddOpenAiPluginsMarketplace,
  onPluginAction,
}: PluginMarketplaceSectionProps) {
  const hasMarketplaceEvidence = marketplaces.length > 0 || skills.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Metric label="Plugins" value={plugins.length} />
          <Metric label="Sources" value={marketplaces.length} />
          <Metric label="Skills" value={skills.length} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={pluginsLoading} onClick={onAddOpenAiPluginsMarketplace}>
            <Plus className="mr-1.5 size-3.5" />
            OpenAI plugins
          </Button>
          <label className="inline-flex h-7 items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 text-xs text-muted-foreground">
            <Switch checked={showInstalledOnly} onCheckedChange={onInstalledOnlyChange} />
            Installed
          </label>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pluginsLoading} onClick={onRefresh}>
            <RefreshCw className={cn('mr-1.5 size-3.5', pluginsLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {pluginsError ? (
        <div className="rounded-lg border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Marketplace unavailable</div>
          <div className="mt-1 break-words text-xs">{pluginsError}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pluginsLoading} onClick={onRefresh}>
              Retry
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={pluginsLoading} onClick={onAddOpenAiPluginsMarketplace}>
              <Plus className="mr-1.5 size-3.5" />
              OpenAI plugins
            </Button>
          </div>
        </div>
      ) : pluginsLoading && !plugins.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="animate-pulse rounded-lg border border-border/60 bg-card/70 p-3">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="mt-3 h-3 w-full rounded bg-muted" />
              <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : visiblePlugins.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visiblePlugins.map((plugin) => (
            <div key={plugin.id} className="group flex min-h-36 flex-col rounded-lg border border-border/60 bg-card/70 p-3 transition-colors hover:border-border hover:bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <IconPackage size={15} className="shrink-0 text-muted-foreground" />
                    <h2 className="truncate text-sm font-medium text-foreground" title={plugin.name ?? plugin.id}>
                      {plugin.name ?? plugin.id}
                    </h2>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={plugin.id}>
                    {plugin.id}
                  </div>
                </div>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', plugin.installed ? 'bg-emerald-500/10 text-emerald-500' : 'bg-secondary/80 text-muted-foreground')}>
                  {plugin.installed ? 'Installed' : 'Available'}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {plugin.description || 'No description.'}
              </p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                <span className="truncate text-xs text-muted-foreground">
                  {plugin.version ? `v${plugin.version}` : 'Version unknown'}
                </span>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs opacity-80 group-hover:opacity-100" disabled={pluginsLoading} onClick={() => onPluginAction(plugin, plugin.installed ? 'uninstall' : 'install')}>
                  {plugin.installed ? 'Remove' : 'Install'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : hasMarketplaceEvidence ? (
        <div className="rounded-lg border border-border/60 bg-card/70 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <IconPuzzle size={16} />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">No installable packages</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {marketplaces.length} sources, {skills.length} skills.
              </p>
            </div>
          </div>
          {marketplaces.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {marketplaces.slice(0, 6).map((marketplace) => (
                <div key={marketplace.name} className="rounded-md border border-border/60 bg-background/40 p-2">
                  <div className="truncate text-sm font-medium text-foreground">{marketplace.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{marketplace.source ?? marketplace.description ?? marketplace.status ?? 'Source'}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-card/70 p-6 text-center text-sm text-muted-foreground">
          {searchValue || showInstalledOnly ? 'No matches.' : 'No marketplace data.'}
        </div>
      )}
    </div>
  )
}
