/**
 * Pure multi-provider config merge API (DESIGN_CODEX_HOST PR4a).
 * Implementation lives in config-lease.ts — this module is the stable pure-function surface.
 */

export {
  mergeLeasesToConfig as mergeMultiProviderConfig,
  hashConfigContent,
  type MergedConfig,
  type MergeOptions,
  type ConfigLease,
} from './config-lease'
