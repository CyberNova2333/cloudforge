// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Themes: eight compatible preset IDs sharing the Enterprise palette, each shown in System, Light or Dark appearance. The preference is per
 * browser (localStorage). `index.html` applies it before the first paint with an inline script that mirrors
 * `rootAttributes`; `ThemeProvider` keeps it applied afterwards. Pure: no DOM access here.
 */
import { t } from '../i18n/i18n';

export type ThemeId =
  | 'navy'
  | 'ink'
  | 'slate'
  | 'indigo'
  | 'forest'
  | 'claret'
  | 'paper'
  | 'github';
/** `hq` is the XY Space look (our tokens); `dev` is GitHub's Primer look. */
export type Skin = 'hq' | 'dev';
/** The rail and top band colourway (`.app[data-chrome]`). `midnight` is Paper in dark mode. */
export type Chrome =
  | 'navy'
  | 'ink'
  | 'slate'
  | 'indigo'
  | 'forest'
  | 'claret'
  | 'paper'
  | 'midnight';
export type Mode = 'system' | 'light' | 'dark';

export interface Theme {
  id: ThemeId;
  label: string;
  skin: Skin;
  chrome: Chrome;
  /** Two colours for the menu swatch: the chrome and the accent. */
  swatch: [string, string];
}

export const THEMES: readonly Theme[] = [
  {
    id: 'navy',
    label: `${t('Theme')} 01`,
    skin: 'hq',
    chrome: 'navy',
    swatch: ['#0a2440', '#0C5CAB'],
  },
  {
    id: 'ink',
    label: `${t('Theme')} 02`,
    skin: 'hq',
    chrome: 'ink',
    swatch: ['#09090b', '#0C5CAB'],
  },
  {
    id: 'slate',
    label: `${t('Theme')} 03`,
    skin: 'hq',
    chrome: 'slate',
    swatch: ['#162b40', '#0C5CAB'],
  },
  {
    id: 'indigo',
    label: `${t('Theme')} 04`,
    skin: 'hq',
    chrome: 'indigo',
    swatch: ['#0a4a8a', '#fafafa'],
  },
  {
    id: 'forest',
    label: `${t('Theme')} 05`,
    skin: 'hq',
    chrome: 'forest',
    swatch: ['#0b345e', '#0C5CAB'],
  },
  {
    id: 'claret',
    label: `${t('Theme')} 06`,
    skin: 'hq',
    chrome: 'claret',
    swatch: ['#0a1d31', '#0C5CAB'],
  },
  {
    id: 'paper',
    label: `${t('Theme')} 07`,
    skin: 'hq',
    chrome: 'paper',
    swatch: ['#0C5CAB', '#fafafa'],
  },
  // The Dev skin restyles the chrome itself (tokens.css), so its chrome value is never shown.
  {
    id: 'github',
    label: `${t('Theme')} 08`,
    skin: 'dev',
    chrome: 'navy',
    swatch: ['#fafafa', '#0C5CAB'],
  },
];

export const THEME_KEY = 'go-theme-id';
export const MODE_KEY = 'go-mode';
export const DEFAULT_THEME: ThemeId = 'navy';
export const DEFAULT_MODE: Mode = 'system';

export function parseThemeId(value: unknown): ThemeId {
  return THEMES.find((th) => th.id === value)?.id ?? DEFAULT_THEME;
}

export function parseMode(value: unknown): Mode {
  return value === 'light' || value === 'dark' ? value : DEFAULT_MODE;
}

export interface ResolvedTheme {
  skin: Skin;
  chrome: Chrome;
  dark: boolean;
}

/** What a theme looks like right now: System mode follows `systemDark`; Paper turns midnight in the dark. */
export function resolveTheme(
  id: ThemeId,
  mode: Mode,
  systemDark: boolean
): ResolvedTheme {
  const theme = THEMES.find((th) => th.id === id) ?? THEMES[0];
  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  return {
    skin: theme.skin,
    chrome: theme.chrome === 'paper' && dark ? 'midnight' : theme.chrome,
    dark,
  };
}

/**
 * The attributes `<html>` carries for a theme: our `data-skin`/`data-theme` (absent = follow the system) and
 * Primer's `data-color-mode`, so Primer's own variables switch with ours. `null` means remove the attribute.
 * Keep the boot script in `index.html` in step with this.
 */
export function rootAttributes(
  id: ThemeId,
  mode: Mode
): Record<string, string | null> {
  return {
    'data-skin': resolveTheme(id, mode, false).skin,
    'data-theme': mode === 'system' ? null : mode,
    'data-color-mode': mode === 'system' ? 'auto' : mode,
    'data-light-theme': 'light',
    'data-dark-theme': 'dark',
  };
}
