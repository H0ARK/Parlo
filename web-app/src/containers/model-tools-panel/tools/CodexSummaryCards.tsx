import {
  collectCodexPluginDescriptors,
  collectCodexSkillDescriptors,
  summarizeCodexValue,
} from '../shared/codex-helpers'

type CodexSummaryCardsProps = {
  skills: unknown
  plugins: unknown
  hooks: unknown
  currentThreadIdForCaps: string | null | undefined
  onSetSkillExtraRoots: () => Promise<void> | void
  onSelectPluginId?: (value: string) => void
  onSelectSkillId?: (value: string) => void
}

type HooksSummary = {
  count: number
  names: string[]
  preview: string
}

function summarizeHookDescriptors(value: unknown): HooksSummary {
  const names = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'string') {
      names.add(item)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const maybeName = summarizeCodexValue(record)
      if (maybeName) names.add(maybeName)
      for (const key of ['data', 'items', 'hooks', 'hookDescriptors']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const [key, nested] of Object.entries(record)) {
        if (nested && typeof nested === 'object') visit(nested)
        if (typeof nested === 'string' && key.toLowerCase().includes('hook')) {
          names.add(nested)
        }
      }
    }
  }
  visit(value)
  const list = [...names].filter(Boolean)
  return {
    count: list.length,
    names: list.slice(0, 8),
    preview: list.length ? `${list.slice(0, 3).join(', ')}` : '—',
  }
}

function stringifySummaryLine(label: string, count: number, items: string[]) {
  if (!items.length) {
    return `${label}: ${count === 0 ? 0 : 1}+`
  }
  return `${label}: ${count} (${items.join(', ')})`
}

export function CodexSummaryCards({
  skills,
  plugins,
  hooks,
  currentThreadIdForCaps,
  onSetSkillExtraRoots,
  onSelectPluginId,
  onSelectSkillId,
}: CodexSummaryCardsProps) {
  const skillDescriptors = collectCodexSkillDescriptors(skills)
  const normalizedSkillDescriptors = skillDescriptors
    .map((skill) => {
      const tag = skill.id || 'skill'
      const pluginTag = skill.pluginId ? ` • ${skill.pluginId}` : ''
      const state =
        skill.enabled === true
          ? 'enabled'
          : skill.enabled === false
            ? 'disabled'
            : 'unknown'
      return `${tag}${pluginTag} · ${state}`
    })
    .sort()
  const allPlugins = collectCodexPluginDescriptors(
    plugins && typeof plugins === 'object' && 'all' in plugins
      ? (plugins as { all?: unknown }).all
      : plugins
  )
  const installedPlugins = collectCodexPluginDescriptors(
    plugins && typeof plugins === 'object' && 'installed' in plugins
      ? (plugins as { installed?: unknown }).installed
      : plugins
  ).filter((entry) => entry.installed)
  const hookSummary = summarizeHookDescriptors(hooks)
  const pluginSummary =
    installedPlugins.length || allPlugins.length
      ? `${installedPlugins.length}/${allPlugins.length} installed`
      : '—'

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
      <div className="border rounded p-1 bg-background/50">
        <div className="font-mono mb-0.5">Skills</div>
        <div className="mb-1 truncate text-[9px] text-muted-foreground">
          {normalizedSkillDescriptors.length
            ? stringifySummaryLine(
                'skills',
                normalizedSkillDescriptors.length,
                normalizedSkillDescriptors
              )
            : 'No skills in payload'}
        </div>
        <div className="mb-1 max-h-24 overflow-auto space-y-1">
          {skillDescriptors.length ? (
            skillDescriptors
              .slice()
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((skill) => {
                const state =
                  skill.enabled === true
                    ? 'enabled'
                    : skill.enabled === false
                      ? 'disabled'
                      : 'unknown'
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className="block w-full rounded border px-1 py-0.5 text-left text-[9px] hover:bg-accent"
                    title="Select this skill in the Plugins / Marketplace / Skills panel"
                    onClick={() => {
                      onSelectSkillId?.(skill.id)
                      if (skill.pluginId) onSelectPluginId?.(skill.pluginId)
                    }}
                  >
                    <div className="truncate font-mono">{skill.id}</div>
                    <div className="truncate text-muted-foreground">
                      {skill.pluginId ? `${skill.pluginId} • ` : ''}
                      {state}
                    </div>
                  </button>
                )
              })
          ) : (
            <pre className="whitespace-pre-wrap break-words">{typeof skills === 'undefined' ? '— (refresh to load)' : JSON.stringify(skills, null, 2)}</pre>
          )}
        </div>
        <button
          type="button"
          className="mt-1 text-[9px] underline"
          disabled={!currentThreadIdForCaps}
          onClick={() => void onSetSkillExtraRoots()}
        >
          Set extra roots for workspace
        </button>
      </div>
      <div className="border rounded p-1 bg-background/50">
        <div className="font-mono mb-0.5">Plugins (all / installed)</div>
        <div className="mb-1 truncate text-[9px] text-muted-foreground">
          {pluginSummary}
        </div>
        <div className="mb-1 max-h-24 overflow-auto space-y-1">
          {allPlugins.length ? (
            allPlugins.slice(0, 10).map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                className="block w-full rounded border px-1 py-0.5 text-left text-[9px] hover:bg-accent"
                title="Select this plugin in the Plugins / Marketplace / Skills panel"
                onClick={() => onSelectPluginId?.(plugin.id)}
              >
                <div className="truncate font-mono">{plugin.id}</div>
                <div className="truncate text-muted-foreground">
                  {plugin.version ? `v${plugin.version} • ` : ''}
                  {plugin.installed ? 'installed' : 'available'}
                </div>
              </button>
            ))
          ) : (
            <pre className="whitespace-pre-wrap break-words">{typeof plugins === 'undefined' ? '— (refresh to load)' : JSON.stringify(plugins, null, 2)}</pre>
          )}
        </div>
      </div>
      <div className="border rounded p-1 bg-background/50">
        <div className="font-mono mb-0.5">Hooks</div>
        <div className="mb-1 truncate text-[9px] text-muted-foreground">
          {hookSummary.count ? `hooks: ${hookSummary.count}` : 'No hooks in payload'}
        </div>
        <div className="mb-1 max-h-24 overflow-auto space-y-1">
          {hookSummary.names.length ? (
            hookSummary.names.map((hook) => (
              <div
                key={hook}
                className="rounded border px-1 py-0.5 text-[9px] truncate"
              >
                {hook}
              </div>
            ))
          ) : (
            <pre className="whitespace-pre-wrap break-words">{typeof hooks === 'undefined' ? '— (refresh to load)' : JSON.stringify(hooks, null, 2)}</pre>
          )}
        </div>
        <div className="text-muted-foreground text-[9px]">sample: {hookSummary.preview}</div>
      </div>
    </div>
  )
}
