import { useEffect, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type {
  CodexMarketplaceDescriptor,
  CodexPluginDescriptor,
  CodexSkillDescriptor,
} from '../shared/codex-helpers'
import {
  parseCodexJson,
  stringifyCodexJson,
} from '../shared/codex-helpers'
import { MarketplaceSelectionDetails } from './MarketplaceSelectionDetails'

type PluginsMarketplaceToolState = {
  codexMarketplaceDescriptors: CodexMarketplaceDescriptor[]
  codexMarketplaceFilter: string
  codexMarketplaceInstalledOnly: boolean
  codexMarketplaceName: string
  codexMarketplaceSnapshot: unknown
  codexMarketplaceSource: string
  codexPluginDescriptors: CodexPluginDescriptor[]
  codexPluginId: string
  codexPluginSkillId: string
  codexSkillConfigJson: string
  codexSkillDescriptors: CodexSkillDescriptor[]
  currentThreadIdForCaps: string | null | undefined
  filteredCodexPluginDescriptors: CodexPluginDescriptor[]
  filteredCodexSkillDescriptors: CodexSkillDescriptor[]
  marketplaceBusy: boolean
  selectableCodexPluginIds: string[]
  selectableCodexSkillIds: string[]
  selectedCodexPluginDescriptor: CodexPluginDescriptor | null | undefined
  selectedCodexPluginMetadataKeys: string[]
  selectedCodexSkillDescriptor: CodexSkillDescriptor | null | undefined
}

type PluginsMarketplaceToolActions = {
  onAddMarketplace: () => void
  onCopyPluginMetadata: () => Promise<void>
  onInstallPlugin: () => void
  onInstallSelectedPlugin: () => void
  onReadPlugin: () => void
  onReadSelectedPlugin: () => void
  onReadPluginSkill: () => void
  onReadSelectedSkill: () => void
  onRefresh: () => void
  onRemoveMarketplace: () => void
  onSelectInstalledOnly: (value: boolean) => void
  onSelectMarketplaceFilter: (value: string) => void
  onSelectMarketplaceName: (value: string) => void
  onSelectMarketplaceSource: (value: string) => void
  onSelectPluginId: (value: string) => void
  onSelectPluginSkillId: (value: string) => void
  onSetSkillConfigJson: (value: string) => void
  onUninstallPlugin: () => void
  onUninstallSelectedPlugin: () => void
  onUpgradeMarketplace: () => void
  onWriteSelectedSkillConfig: () => void
  onWriteSkillConfig: () => void
}

type PluginsMarketplaceToolProps = {
  state: PluginsMarketplaceToolState
  actions: PluginsMarketplaceToolActions
}

type SkillConfigField = {
  key: string
  value: string
}

export function PluginsMarketplaceTool({
  state,
  actions,
}: PluginsMarketplaceToolProps) {
  const {
    codexMarketplaceDescriptors,
    codexMarketplaceFilter,
    codexMarketplaceInstalledOnly,
    codexMarketplaceName,
    codexMarketplaceSnapshot,
    codexMarketplaceSource,
    codexPluginDescriptors,
    codexPluginId,
    codexPluginSkillId,
    codexSkillConfigJson,
    codexSkillDescriptors,
    currentThreadIdForCaps,
    filteredCodexPluginDescriptors,
    filteredCodexSkillDescriptors,
    marketplaceBusy,
    selectableCodexPluginIds,
    selectableCodexSkillIds,
    selectedCodexPluginDescriptor,
    selectedCodexPluginMetadataKeys,
    selectedCodexSkillDescriptor,
  } = state
  const {
    onAddMarketplace,
    onCopyPluginMetadata,
    onInstallPlugin,
    onInstallSelectedPlugin,
    onReadPlugin,
    onReadSelectedPlugin,
    onReadPluginSkill,
    onReadSelectedSkill,
    onRefresh,
    onRemoveMarketplace,
    onSelectInstalledOnly,
    onSelectMarketplaceFilter,
    onSelectMarketplaceName,
    onSelectMarketplaceSource,
    onSelectPluginId,
    onSelectPluginSkillId,
    onSetSkillConfigJson,
    onUninstallPlugin,
    onUninstallSelectedPlugin,
    onUpgradeMarketplace,
    onWriteSelectedSkillConfig,
    onWriteSkillConfig,
  } = actions
  const [showAdvancedSkillConfigJson, setShowAdvancedSkillConfigJson] =
    useState(false)
  const [skillConfigFields, setSkillConfigFields] = useState<SkillConfigField[]>([
    { key: '', value: '' },
  ])

  const parsedSkillConfig = parseCodexJson<Record<string, unknown>>(
    codexSkillConfigJson,
    {}
  )
  const parsedSkillConfigEntries = useMemo<SkillConfigField[]>(() => {
    if (
      !parsedSkillConfig ||
      typeof parsedSkillConfig !== 'object' ||
      Array.isArray(parsedSkillConfig)
    ) {
      return [{ key: '', value: '' }]
    }
    const entries = Object.entries(parsedSkillConfig).map(([key, value]) => ({
      key,
      value:
        typeof value === 'string'
          ? value
          : stringifyCodexJson(value, String(value ?? '')),
    }))
    return entries.length ? entries : [{ key: '', value: '' }]
  }, [parsedSkillConfig, codexSkillConfigJson])

  const parseSkillConfigValue = (value: string): unknown => {
    const trimmed = value.trim()
    if (!trimmed) return value
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (!Number.isNaN(Number(trimmed))) return Number(trimmed)
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return value
      }
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return value
  }

  const normalizeSkillConfigPayload = (fields: SkillConfigField[]) => {
    const payload: Record<string, unknown> = {}
    fields.forEach((field) => {
      const fieldKey = field.key.trim()
      if (!fieldKey) return
      payload[fieldKey] = parseSkillConfigValue(field.value)
    })
    return payload
  }

  const setSkillConfigFromFields = (nextFields: SkillConfigField[]) => {
    setSkillConfigFields(nextFields)
    onSetSkillConfigJson(
      stringifyCodexJson(normalizeSkillConfigPayload(nextFields), '{}')
    )
  }

  const setSkillConfigField = (index: number, field: SkillConfigField) => {
    setSkillConfigFromFields(
      skillConfigFields.map((nextField, nextIndex) =>
        nextIndex === index ? field : nextField
      )
    )
  }

  const addSkillConfigField = () => {
    setSkillConfigFromFields([...skillConfigFields, { key: '', value: '' }])
  }

  const removeSkillConfigField = (index: number) => {
    const nextFields = skillConfigFields.filter((_, fieldIndex) => {
      return fieldIndex !== index
    })
    setSkillConfigFromFields(nextFields.length ? nextFields : [{ key: '', value: '' }])
  }

  useEffect(() => {
    if (showAdvancedSkillConfigJson) return
    setSkillConfigFields(parsedSkillConfigEntries)
  }, [showAdvancedSkillConfigJson, parsedSkillConfigEntries])

  const marketplaceSummary = useMemo(() => {
    const installedPlugins = codexPluginDescriptors.filter(
      (plugin) => plugin.installed
    ).length
    const availablePlugins = codexPluginDescriptors.length - installedPlugins
    const enabledSkills = codexSkillDescriptors.filter((skill) => skill.enabled).length
    return {
      installedPlugins,
      availablePlugins,
      enabledSkills,
      disabledSkills: codexSkillDescriptors.length - enabledSkills,
    }
  }, [codexPluginDescriptors, codexSkillDescriptors])

  return (
    <div className="mb-2 border rounded p-1 bg-background/50 text-[10px]">
      <div className="font-mono mb-1 flex items-center justify-between gap-2">
        <span>Plugins / Marketplace / Skills</span>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || marketplaceBusy}
          onClick={() => onRefresh()}
        >
          {marketplaceBusy ? 'Loading' : 'Refresh'}
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        Manages app-server plugin install state, plugin metadata,
        marketplaces, app descriptors, and skill config without leaving the
        Codex-backed workspace.
      </div>
      <div className="mb-1 grid grid-cols-2 gap-1 md:grid-cols-4">
        <div className="rounded border bg-background/40 px-2 py-1">
          <div className="font-mono text-[9px]">Installed</div>
          <div className="text-[10px]">
            {marketplaceSummary.installedPlugins} plugins
          </div>
        </div>
        <div className="rounded border bg-background/40 px-2 py-1">
          <div className="font-mono text-[9px]">Available</div>
          <div className="text-[10px]">
            {marketplaceSummary.availablePlugins} plugins
          </div>
        </div>
        <div className="rounded border bg-background/40 px-2 py-1">
          <div className="font-mono text-[9px]">Skills</div>
          <div className="text-[10px]">
            {marketplaceSummary.enabledSkills} enabled /{' '}
            {marketplaceSummary.disabledSkills} other
          </div>
        </div>
        <div className="rounded border bg-background/40 px-2 py-1">
          <div className="font-mono text-[9px]">Sources</div>
          <div className="text-[10px]">
            {codexMarketplaceDescriptors.length} marketplaces
          </div>
        </div>
      </div>
      <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Plugin id/name"
          value={codexPluginId}
          onChange={(event) => onSelectPluginId(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Plugin skill id/name"
          value={codexPluginSkillId}
          onChange={(event) => onSelectPluginSkillId(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Marketplace name"
          value={codexMarketplaceName}
          onChange={(event) => onSelectMarketplaceName(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Marketplace source"
          value={codexMarketplaceSource}
          onChange={(event) => onSelectMarketplaceSource(event.target.value)}
        />
        <Input
          className="h-6 px-2 text-[10px]"
          placeholder="Search plugins / skills"
          value={codexMarketplaceFilter}
          onChange={(event) => onSelectMarketplaceFilter(event.target.value)}
        />
        <label className="flex h-6 items-center gap-1 rounded border px-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={codexMarketplaceInstalledOnly}
            onChange={(event) => onSelectInstalledOnly(event.target.checked)}
          />
          Installed plugins only
        </label>
      </div>
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || marketplaceBusy}
          onClick={() =>
            setShowAdvancedSkillConfigJson((previous) => !previous)
          }
        >
          {showAdvancedSkillConfigJson ? 'Use fields' : 'Advanced skill JSON'}
        </button>
      </div>
      {showAdvancedSkillConfigJson ? (
        <textarea
          className="mb-1 min-h-12 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[10px]"
          placeholder="Skill config JSON"
          value={codexSkillConfigJson}
          onChange={(event) => onSetSkillConfigJson(event.target.value)}
        />
      ) : (
        <div className="mb-1 space-y-1">
          {skillConfigFields.map((field, index) => (
            <div
              key={`${field.key || 'key'}-${index}`}
              className="grid grid-cols-[1.3fr_1.6fr_auto] gap-1"
            >
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="config key"
                value={field.key}
                onChange={(event) =>
                  setSkillConfigField(index, {
                    ...field,
                    key: event.target.value,
                  })
                }
              />
              <Input
                className="h-6 px-2 text-[10px]"
                placeholder="config value"
                value={field.value}
                onChange={(event) =>
                  setSkillConfigField(index, {
                    ...field,
                    value: event.target.value,
                  })
                }
              />
              <button
                type="button"
                className="text-[9px] underline disabled:opacity-50"
                disabled={marketplaceBusy}
                onClick={() => removeSkillConfigField(index)}
              >
                remove
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-muted-foreground">
              Keys configured: {Object.keys(normalizeSkillConfigPayload(skillConfigFields)).length}
            </span>
            <button
              type="button"
              className="text-[9px] underline disabled:opacity-50"
              disabled={marketplaceBusy}
              onClick={addSkillConfigField}
            >
              + add key
            </button>
          </div>
        </div>
      )}
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || marketplaceBusy || !codexPluginId.trim()}
          onClick={() => onInstallPlugin()}
        >
          Install plugin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || marketplaceBusy || !codexPluginId.trim()}
          onClick={() => onUninstallPlugin()}
        >
          Uninstall plugin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={!currentThreadIdForCaps || marketplaceBusy || !codexPluginId.trim()}
          onClick={() => onReadPlugin()}
        >
          Read plugin
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            marketplaceBusy ||
            !codexPluginId.trim() ||
            !codexPluginSkillId.trim()
          }
          onClick={() => onReadPluginSkill()}
        >
          Read plugin skill
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            marketplaceBusy ||
            !codexMarketplaceName.trim() ||
            !codexMarketplaceSource.trim()
          }
          onClick={() => onAddMarketplace()}
        >
          Add marketplace
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            marketplaceBusy ||
            !codexMarketplaceName.trim()
          }
          onClick={() => onRemoveMarketplace()}
        >
          Remove marketplace
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            marketplaceBusy ||
            !codexMarketplaceName.trim()
          }
          onClick={() => onUpgradeMarketplace()}
        >
          Upgrade marketplace
        </button>
        <button
          type="button"
          className="text-[9px] underline disabled:opacity-50"
          disabled={
            !currentThreadIdForCaps ||
            marketplaceBusy ||
            !codexPluginSkillId.trim()
          }
          onClick={() => onWriteSkillConfig()}
        >
          Write skill config
        </button>
      </div>
      {codexMarketplaceDescriptors.length ? (
        <div className="mb-1 rounded border bg-background/40 p-1">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
            <span>Marketplace sources</span>
            <span className="text-muted-foreground">
              {codexMarketplaceDescriptors.length}
            </span>
          </div>
          <div className="max-h-24 space-y-1 overflow-auto">
            {codexMarketplaceDescriptors.map((marketplace) => (
              <button
                key={marketplace.name}
                type="button"
                className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
                title={
                  marketplace.description ?? marketplace.source ?? marketplace.name
                }
                onClick={() => {
                  onSelectMarketplaceName(marketplace.name)
                  if (marketplace.source) {
                    onSelectMarketplaceSource(marketplace.source)
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[9px]">
                    {marketplace.name}
                  </span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {marketplace.status ?? 'source'}
                  </span>
                </div>
                <div className="truncate text-[9px] text-muted-foreground">
                  {marketplace.source ??
                    marketplace.description ??
                    'no source metadata'}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {codexPluginDescriptors.length || codexSkillDescriptors.length ? (
        <div className="mb-1 grid grid-cols-1 gap-1 md:grid-cols-2">
          <div className="rounded border bg-background/40 p-1">
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
              <span>Plugins</span>
              <span className="text-muted-foreground">
                {filteredCodexPluginDescriptors.length}/{codexPluginDescriptors.length}
              </span>
            </div>
            {filteredCodexPluginDescriptors.length ? (
              <div className="max-h-32 space-y-1 overflow-auto">
                {filteredCodexPluginDescriptors.map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
                    title={plugin.description ?? plugin.id}
                    onClick={() => onSelectPluginId(plugin.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[9px]">
                        {plugin.name ?? plugin.id}
                      </span>
                      <span className="shrink-0 text-[9px] text-muted-foreground">
                        {plugin.installed ? 'installed' : 'available'}
                      </span>
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {plugin.version ? `v${plugin.version} · ` : ''}
                      {plugin.description ?? plugin.id}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-muted-foreground">
                No matching plugin descriptors.
              </div>
            )}
          </div>
          <div className="rounded border bg-background/40 p-1">
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
              <span>Skills</span>
              <span className="text-muted-foreground">
                {filteredCodexSkillDescriptors.length}/{codexSkillDescriptors.length}
              </span>
            </div>
            {filteredCodexSkillDescriptors.length ? (
              <div className="max-h-32 space-y-1 overflow-auto">
                {filteredCodexSkillDescriptors.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
                    title={skill.description ?? skill.id}
                    onClick={() => {
                      onSelectPluginSkillId(skill.id)
                      if (skill.pluginId) onSelectPluginId(skill.pluginId)
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[9px]">
                        {skill.name ?? skill.id}
                      </span>
                      <span className="shrink-0 text-[9px] text-muted-foreground">
                        {skill.enabled ? 'enabled' : skill.pluginId ?? ''}
                      </span>
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {skill.description ?? skill.pluginId ?? skill.id}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-muted-foreground">
                No matching skill descriptors.
              </div>
            )}
          </div>
        </div>
      ) : null}
      <MarketplaceSelectionDetails
        currentThreadIdForCaps={currentThreadIdForCaps}
        marketplaceBusy={marketplaceBusy}
        selectedCodexPluginDescriptor={selectedCodexPluginDescriptor}
        selectedCodexPluginMetadataKeys={selectedCodexPluginMetadataKeys}
        selectedCodexSkillDescriptor={selectedCodexSkillDescriptor}
        onCopyPluginMetadata={onCopyPluginMetadata}
        onReadPlugin={onReadSelectedPlugin}
        onInstallPlugin={onInstallSelectedPlugin}
        onUninstallPlugin={onUninstallSelectedPlugin}
        onReadSkill={onReadSelectedSkill}
        onWriteSkillConfig={onWriteSelectedSkillConfig}
      />
      <pre className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {codexMarketplaceSnapshot
          ? JSON.stringify(codexMarketplaceSnapshot, null, 2)
          : '— (refresh to load)'}
      </pre>
      {selectableCodexPluginIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexPluginIds.map((pluginId) => (
            <button
              key={pluginId}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexPluginId.trim() === pluginId && 'bg-accent'
              )}
              title={pluginId}
              onClick={() => onSelectPluginId(pluginId)}
            >
              {pluginId}
            </button>
          ))}
        </div>
      ) : null}
      {selectableCodexSkillIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectableCodexSkillIds.map((skillId) => (
            <button
              key={skillId}
              type="button"
              className={cn(
                'max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[9px] hover:bg-accent',
                codexPluginSkillId.trim() === skillId && 'bg-accent'
              )}
              title={skillId}
              onClick={() => onSelectPluginSkillId(skillId)}
            >
              skill:{skillId}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
