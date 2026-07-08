import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Host flags for Codex-as-SOT runtime (DESIGN_CODEX_HOST).
 * Product defaults keep legacy single-route / direct-remote behavior.
 */
export type CodexHostFlags = {
  /** When true, authenticated remotes may collapse onto Parlo-gateway if Local API is ready. */
  preferGatewayForRemotes: boolean
  /** When true, spawn env unions all lease keys (PR3+). When false, last-writer single key. */
  perProviderEnvKeys: boolean
  /** When true, merge all leased model_providers into config.toml (PR4+). */
  multiProviderMerge: boolean
  /** When true, refuse chat if binary health fails hard checks (PR6). Product default soft-warn. */
  binaryHealthHardBlock: boolean
}

type CodexHostFlagsState = CodexHostFlags & {
  setFlag: <K extends keyof CodexHostFlags>(key: K, value: CodexHostFlags[K]) => void
  resetFlags: () => void
}

export const CODEX_HOST_FLAG_DEFAULTS: CodexHostFlags = {
  preferGatewayForRemotes: false,
  perProviderEnvKeys: false,
  multiProviderMerge: false,
  binaryHealthHardBlock: false,
}

export const useCodexHostFlags = create<CodexHostFlagsState>()(
  persist(
    (set) => ({
      ...CODEX_HOST_FLAG_DEFAULTS,
      setFlag: (key, value) => set({ [key]: value } as Partial<CodexHostFlagsState>),
      resetFlags: () => set({ ...CODEX_HOST_FLAG_DEFAULTS }),
    }),
    {
      name: localStorageKey.codexHostFlags ?? 'codex-host-flags',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
