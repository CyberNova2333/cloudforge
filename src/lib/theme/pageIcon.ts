// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
/**
 * The icons a page can show beside its name in the top band (`usePageHead({ icon })`), by name so pure modules can
 * pick one. `src/components/shell/icons.tsx` draws them.
 */
export type PageIconName =
  | 'home'
  | 'repo'
  | 'inbox'
  | 'bell'
  | 'crew'
  | 'sliders'
  | 'shield'
  | 'plus'
  | 'person'
  | 'code'
  | 'file'
  | 'pull'
  | 'issue'
  | 'commit'
  | 'branch'
  | 'tag'
  | 'play'
  | 'graph'
  | 'pulse'
  | 'live'
  | 'book'
  | 'key'
  | 'mail'
  | 'plug'
  | 'search'
  | 'alert';
