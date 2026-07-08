import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '..')

function read(name: string) {
  return readFileSync(join(dir, name), 'utf8')
}

describe('capability barrels (PR8)', () => {
  it('product barrel re-exports core chat path symbols', () => {
    const src = read('chat-backend-product.ts')
    expect(src).toContain('sendCodexAppServerChatMessage')
    expect(src).toContain('buildCodexSessionOptions')
    expect(src).toContain('CODEX_APP_SERVER_PROVIDER_ID')
    expect(src).toContain("from './chat-backend'")
  })

  it('advanced barrel re-exports full chat-backend facade', () => {
    const src = read('chat-backend-advanced.ts')
    expect(src).toMatch(/export \* from '\.\/chat-backend'/)
  })

  it('root index exposes product and advanced namespace barrels', () => {
    const src = read('index.ts')
    expect(src).toContain("export * as codexProduct from './chat-backend-product'")
    expect(src).toContain("export * as codexAdvanced from './chat-backend-advanced'")
    // Full facade still exported from chat-backend path
    expect(src).toContain('sendCodexAppServerChatMessage')
  })

  it('chat-backend still exports advanced CLI helpers (no removal)', () => {
    const src = read('chat-backend.ts')
    for (const name of [
      'export async function runCodexCliHelp',
      'export async function runCodexCliSubcommand',
      'export async function runCodexExec',
    ]) {
      expect(src).toContain(name)
    }
  })
})

