export function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export function decodeUtf8Base64(value: string) {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

export function parseCodexJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value || '') as T
  } catch {
    return fallback
  }
}

export function parseCodexArgTokens(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed) return []

  const tokens: string[] = []
  let inQuotes: '"' | "'" | null = null
  let escapeNext = false
  let current = ''

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (escapeNext) {
      current += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (inQuotes === null) {
      if (char === '"' || char === "'") {
        inQuotes = char
        continue
      }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        if (current.length > 0) {
          tokens.push(current)
          current = ''
        }
        continue
      }
      current += char
      continue
    }

    if (char === inQuotes) {
      inQuotes = null
      continue
    }

    current += char
  }

  if (escapeNext || inQuotes !== null) {
    return null
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

export function stringifyCodexJson(value: unknown, fallback: string = ''): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

export type CodexThreadDescriptor = {
  id: string
  name?: string
  status?: string
  updatedAt?: string
  source: 'loaded' | 'stored'
  turns?: number | null
  turnItems?: number | null
  goal?: string
}

export type CodexMcpResourceDescriptor = {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export type CodexMcpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type CodexPluginDescriptor = {
  id: string
  name?: string
  description?: string
  version?: string
  installed?: boolean
  raw?: unknown
}

export type CodexSkillDescriptor = {
  id: string
  name?: string
  description?: string
  pluginId?: string
  enabled?: boolean
}

export type CodexMarketplaceDescriptor = {
  name: string
  source?: string
  description?: string
  status?: string
}

export function collectCodexThreadIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      ids.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.id === 'string') ids.add(record.id)
      if (typeof record.threadId === 'string') ids.add(record.threadId)
      if (Array.isArray(record.data)) visit(record.data)
      if (Array.isArray(record.threads)) visit(record.threads)
      if (Array.isArray(record.threadIds)) visit(record.threadIds)
      if (Array.isArray(record.items)) visit(record.items)
    }
  }
  visit(value)
  return [...ids]
}

export function collectCodexThreadDescriptors(
  value: unknown,
  source: CodexThreadDescriptor['source']
): CodexThreadDescriptor[] {
  const descriptors = new Map<string, CodexThreadDescriptor>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      descriptors.set(item, { id: item, source })
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const id =
        typeof record.id === 'string'
          ? record.id
          : typeof record.threadId === 'string'
            ? record.threadId
            : ''
      if (id) {
        const existing = descriptors.get(id)
        descriptors.set(id, {
          ...existing,
          id,
          name:
            typeof record.name === 'string'
              ? record.name
              : typeof record.title === 'string'
                ? record.title
                : existing?.name,
          status:
            typeof record.status === 'string'
              ? record.status
              : typeof record.state === 'string'
                ? record.state
                : existing?.status,
          updatedAt:
            typeof record.updatedAt === 'string'
              ? record.updatedAt
              : typeof record.updated_at === 'string'
                ? record.updated_at
                : existing?.updatedAt,
          turns:
            typeof record.turns === 'number'
              ? record.turns
              : typeof record.turn_count === 'number'
                ? record.turn_count
                : typeof record.numTurns === 'number'
                  ? record.numTurns
                  : typeof record.turnsCount === 'number'
                    ? record.turnsCount
                    : existing?.turns ?? null,
          turnItems:
            typeof record.turnItems === 'number'
              ? record.turnItems
              : typeof record.item_count === 'number'
                ? record.item_count
                : typeof record.numItems === 'number'
                  ? record.numItems
                  : typeof record.turnItemsCount === 'number'
                    ? record.turnItemsCount
                    : existing?.turnItems ?? null,
          goal:
            typeof record.goal === 'string'
              ? record.goal
              : typeof record.objective === 'string'
                ? record.objective
                : typeof record.title === 'string'
                  ? record.title
                  : existing?.goal,
          source,
        })
      }
      for (const key of ['data', 'items', 'threads', 'threadIds']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}

export function collectCodexTurnIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      ids.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.turnId === 'string') ids.add(record.turnId)
      if (typeof record.id === 'string') {
        const type = typeof record.type === 'string' ? record.type : ''
        const status = typeof record.status === 'string' ? record.status : ''
        if (type.includes('turn') || status || Array.isArray(record.items)) {
          ids.add(record.id)
        }
      }
      for (const key of ['data', 'items', 'turns']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...ids]
}

export function countCodexCollectionItems(value: unknown): number | null {
  if (!value) return null
  if (Array.isArray(value)) return value.length
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['data', 'items', 'turns', 'messages']) {
    const nested = record[key]
    if (Array.isArray(nested)) return nested.length
  }
  return null
}

export function summarizeCodexValue(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value !== "object") return String(value)
  const record = value as Record<string, unknown>
  for (const key of ["objective", "name", "title", "status", "state", "id"]) {
    if (typeof record[key] === "string") return record[key] as string
  }
  // thread-like readable short form before json dump
  if (typeof record.id === "string") {
    const nm = typeof record.name === "string" ? record.name : (typeof record.title === "string" ? record.title : "")
    const st = typeof record.status === "string" ? record.status : ""
    const short = nm ? `${nm} [${record.id.slice(0, 8)}]` : record.id
    return st ? `${short} (${st})` : short
  }
  if (Array.isArray(record.data) || Array.isArray(record.items) || Array.isArray(record.turns)) {
    const len = (record.data as any[])?.length ?? (record.items as any[])?.length ?? (record.turns as any[])?.length ?? 0
    return `items:${len}`
  }
  try {
    return JSON.stringify(value).slice(0, 120)
  } catch {
    return ""
  }
}

export function collectCodexItemIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      ids.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.itemId === 'string') ids.add(record.itemId)
      if (typeof record.id === 'string') {
        const type = typeof record.type === 'string' ? record.type : ''
        if (
          type ||
          'command' in record ||
          'status' in record ||
          'content' in record
        ) {
          ids.add(record.id)
        }
      }
      for (const key of ['data', 'items']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...ids]
}

export function collectCodexProcessHandles(value: unknown): string[] {
  const handles = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      if (/^(proc|process|cmd|command)[-_:/]/i.test(item)) handles.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      for (const key of [
        'handle',
        'processHandle',
        'processId',
        'terminalId',
      ]) {
        if (typeof record[key] === 'string') handles.add(record[key])
      }
      for (const key of ['data', 'items', 'lastAction', 'processes', 'result']) {
        if (record[key]) visit(record[key])
      }
    }
  }
  visit(value)
  return [...handles]
}

export function collectCodexMcpServerNames(value: unknown): string[] {
  const names = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      for (const key of ['name', 'server', 'serverName']) {
        if (typeof record[key] === 'string') names.add(record[key])
      }
      for (const key of ['data', 'servers', 'items', 'mcpServers']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const [key, nested] of Object.entries(record)) {
        if (
          nested &&
          typeof nested === 'object' &&
          !Array.isArray(nested) &&
          ['status', 'state', 'tools', 'resources'].some((field) => field in nested)
        ) {
          names.add(key)
        }
      }
    }
  }
  visit(value)
  return [...names]
}

export function collectCodexMcpResourceUris(value: unknown): string[] {
  const uris = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      for (const key of ['uri', 'resourceUri', 'resourceURI']) {
        if (typeof record[key] === 'string') uris.add(record[key])
      }
      for (const key of [
        'data',
        'items',
        'resources',
        'resourceTemplates',
        'templates',
      ]) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === 'object') visit(nested)
      }
    }
  }
  visit(value)
  return [...uris]
}

export function collectCodexMcpToolNames(value: unknown): string[] {
  const tools = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const maybeToolContainer =
        'inputSchema' in record ||
        'input_schema' in record ||
        'parameters' in record ||
        'description' in record
      for (const key of ['name', 'tool', 'toolName']) {
        if (typeof record[key] === 'string' && maybeToolContainer) {
          tools.add(record[key])
        }
      }
      for (const key of ['data', 'items', 'tools']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === 'object') visit(nested)
      }
    }
  }
  visit(value)
  return [...tools]
}

export function collectCodexMcpResourceDescriptors(
  value: unknown
): CodexMcpResourceDescriptor[] {
  const descriptors = new Map<string, CodexMcpResourceDescriptor>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const uri =
        typeof record.uri === 'string'
          ? record.uri
          : typeof record.resourceUri === 'string'
            ? record.resourceUri
            : typeof record.resourceURI === 'string'
              ? record.resourceURI
              : ''
      if (uri) {
        descriptors.set(uri, {
          uri,
          name: typeof record.name === 'string' ? record.name : undefined,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          mimeType:
            typeof record.mimeType === 'string'
              ? record.mimeType
              : typeof record.mime_type === 'string'
                ? record.mime_type
                : undefined,
        })
      }
      for (const key of [
        'data',
        'items',
        'resources',
        'resourceTemplates',
        'templates',
      ]) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === 'object') visit(nested)
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}

export function collectCodexMcpToolDescriptors(
  value: unknown
): CodexMcpToolDescriptor[] {
  const descriptors = new Map<string, CodexMcpToolDescriptor>()
  const visit = (item: unknown) => {
    if (!item) return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const inputSchema =
        record.inputSchema ?? record.input_schema ?? record.parameters
      const looksLikeTool =
        inputSchema ||
        'description' in record ||
        'toolName' in record ||
        'tool' in record
      const name =
        typeof record.name === 'string'
          ? record.name
          : typeof record.toolName === 'string'
            ? record.toolName
            : typeof record.tool === 'string'
              ? record.tool
              : ''
      if (name && looksLikeTool) {
        descriptors.set(name, {
          name,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          inputSchema,
        })
      }
      for (const key of ['data', 'items', 'tools']) {
        if (Array.isArray(record[key])) visit(record[key])
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === 'object') visit(nested)
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}

export function buildJsonTemplateFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return {}
  const record = schema as Record<string, unknown>
  if ('default' in record) return record.default
  if (Array.isArray(record.enum) && record.enum.length > 0) {
    return record.enum[0]
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const variants = record[key]
    if (Array.isArray(variants) && variants.length > 0) {
      return buildJsonTemplateFromSchema(variants[0])
    }
  }
  const type = record.type
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'array') {
    return record.items ? [buildJsonTemplateFromSchema(record.items)] : []
  }
  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : null
  if (properties) {
    const required = Array.isArray(record.required)
      ? record.required.map((item) => String(item))
      : []
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        required.includes(key) ? `${key}` : key,
        buildJsonTemplateFromSchema(value),
      ])
    )
  }
  if (
    record.additionalProperties &&
    typeof record.additionalProperties === 'object'
  ) {
    return {
      key: buildJsonTemplateFromSchema(record.additionalProperties),
    }
  }
  return {}
}

export function validateJsonAgainstSchema(
  schema: unknown,
  value: unknown,
  path = '$'
): string[] {
  if (!schema || typeof schema !== 'object') return []
  const record = schema as Record<string, unknown>

  if (Array.isArray(record.enum) && !record.enum.includes(value as never)) {
    return [`${path} must be one of ${record.enum.map(String).join(', ')}`]
  }

  for (const key of ['oneOf', 'anyOf'] as const) {
    const variants = record[key]
    if (Array.isArray(variants) && variants.length > 0) {
      const variantErrors = variants.map((variant) =>
        validateJsonAgainstSchema(variant, value, path)
      )
      if (variantErrors.some((errors) => errors.length === 0)) return []
      return variantErrors[0] ?? []
    }
  }

  const allOf = record.allOf
  if (Array.isArray(allOf)) {
    return allOf.flatMap((variant) =>
      validateJsonAgainstSchema(variant, value, path)
    )
  }

  const type = record.type
  const errors: string[] = []
  if (type === 'string' && typeof value !== 'string') {
    errors.push(`${path} must be a string`)
  }
  if (
    (type === 'number' || type === 'integer') &&
    typeof value !== 'number'
  ) {
    errors.push(`${path} must be a number`)
  }
  if (type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
    errors.push(`${path} must be an integer`)
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`)
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`)
    } else if (record.items) {
      value.forEach((item, index) => {
        errors.push(
          ...validateJsonAgainstSchema(record.items, item, `${path}[${index}]`)
        )
      })
    }
  }

  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : null
  if (properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path} must be an object`)
    } else {
      const objectValue = value as Record<string, unknown>
      const required = Array.isArray(record.required)
        ? record.required.map((item) => String(item))
        : []
      for (const key of required) {
        if (!(key in objectValue)) errors.push(`${path}.${key} is required`)
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in objectValue) {
          errors.push(
            ...validateJsonAgainstSchema(
              propertySchema,
              objectValue[key],
              `${path}.${key}`
            )
          )
        }
      }
    }
  }

  return errors
}

export function collectCodexPluginIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      ids.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      for (const key of [
        'id',
        'name',
        'plugin',
        'pluginId',
        'remotePluginId',
        'pluginName',
      ]) {
        if (typeof record[key] === 'string') ids.add(record[key])
      }
      for (const key of [
        'all',
        'available',
        'data',
        'installed',
        'items',
        'marketplaces',
        'pluginList',
        'plugins',
      ]) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...ids]
}

export function collectCodexPluginDescriptors(value: unknown): CodexPluginDescriptor[] {
  const descriptors = new Map<string, CodexPluginDescriptor>()
  const visit = (item: unknown, installedHint = false) => {
    if (!item) return
    if (typeof item === 'string') {
      descriptors.set(item, { id: item, installed: installedHint })
      return
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, installedHint))
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const id =
        typeof record.id === 'string'
          ? record.id
          : typeof record.name === 'string'
            ? record.name
            : typeof record.plugin === 'string'
              ? record.plugin
              : typeof record.pluginId === 'string'
                ? record.pluginId
                : typeof record.remotePluginId === 'string'
                  ? record.remotePluginId
                  : typeof record.pluginName === 'string'
                    ? record.pluginName
                : ''
      if (id) {
        const existing = descriptors.get(id)
        descriptors.set(id, {
          ...existing,
          id,
          name: typeof record.name === 'string' ? record.name : existing?.name,
          description:
            typeof record.description === 'string'
              ? record.description
              : existing?.description,
          version:
            typeof record.version === 'string'
              ? record.version
              : existing?.version,
          installed:
            installedHint ||
            existing?.installed ||
            Boolean(record.installed) ||
            Boolean(record.enabled),
          raw: record,
        })
      }
      for (const key of [
        'all',
        'available',
        'data',
        'items',
        'pluginList',
        'plugins',
        'marketplaces',
      ]) {
        if (Array.isArray(record[key])) visit(record[key], installedHint)
      }
      for (const key of ['installed', 'installedPlugins']) {
        if (Array.isArray(record[key])) visit(record[key], true)
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}

export function collectCodexMarketplaceDescriptors(
  value: unknown
): CodexMarketplaceDescriptor[] {
  const descriptors = new Map<string, CodexMarketplaceDescriptor>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      descriptors.set(item, { name: item })
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const name =
        typeof record.name === 'string'
          ? record.name
          : typeof record.marketplaceName === 'string'
            ? record.marketplaceName
            : typeof record.id === 'string'
              ? record.id
              : ''
      if (name) {
        descriptors.set(name, {
          name,
          source:
            typeof record.source === 'string'
              ? record.source
              : typeof record.url === 'string'
                ? record.url
                : undefined,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          status:
            typeof record.status === 'string'
              ? record.status
              : typeof record.state === 'string'
                ? record.state
                : undefined,
        })
      }
      for (const key of [
        'pluginList',
        'installedPlugins',
        'data',
        'items',
        'marketplace',
        'marketplaces',
        'sources',
      ]) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}

export function collectCodexSkillIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (item: unknown) => {
    if (!item) return
    if (typeof item === 'string') {
      ids.add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      for (const key of [
        'id',
        'name',
        'skill',
        'skillId',
        'remoteSkillId',
        'skillName',
      ]) {
        if (typeof record[key] === 'string') ids.add(record[key])
      }
      for (const key of [
        'available',
        'data',
        'pluginList',
        'enabled',
        'items',
        'marketplaces',
        'skills',
      ]) {
        if (Array.isArray(record[key])) visit(record[key])
      }
    }
  }
  visit(value)
  return [...ids]
}

export function collectCodexSkillDescriptors(value: unknown): CodexSkillDescriptor[] {
  const descriptors = new Map<string, CodexSkillDescriptor>()
  const visit = (item: unknown, pluginId?: string) => {
    if (!item) return
    if (typeof item === 'string') {
      descriptors.set(item, { id: item, pluginId })
      return
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, pluginId))
      return
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>
      const parentPlugin =
        typeof record.pluginId === 'string'
          ? record.pluginId
          : typeof record.plugin === 'string'
            ? record.plugin
            : pluginId
      const id =
        typeof record.id === 'string'
          ? record.id
          : typeof record.name === 'string'
            ? record.name
            : typeof record.skill === 'string'
              ? record.skill
              : typeof record.skillId === 'string'
                ? record.skillId
                : typeof record.remoteSkillId === 'string'
                  ? record.remoteSkillId
                  : typeof record.skillName === 'string'
                    ? record.skillName
                : ''
      if (id) {
        descriptors.set(id, {
          id,
          name: typeof record.name === 'string' ? record.name : undefined,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          pluginId: parentPlugin,
          enabled: Boolean(record.enabled),
        })
      }
      for (const key of [
        'available',
        'data',
        'pluginList',
        'enabled',
        'items',
        'skills',
        'marketplaces',
      ]) {
        if (Array.isArray(record[key])) visit(record[key], parentPlugin)
      }
    }
  }
  visit(value)
  return [...descriptors.values()]
}
