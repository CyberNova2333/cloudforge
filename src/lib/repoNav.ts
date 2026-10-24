// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Repository navigation: which tab a repository URL belongs to, the tabs a repository shows, and the top band's
 * default trail for a repository page that doesn't name itself (pages redesigned later publish their own through
 * `usePageHead`). Crumbs here are relative to the repository; `RepoLayout` puts `owner / repo` in front.
 */
import { t } from './i18n';
import type { PageIconName } from './pageIcon';

export type RepoTabId =
  | 'code'
  | 'health'
  | 'pulls'
  | 'releases'
  | 'actions'
  | 'insights'
  | 'settings'
  | 'commits';

export interface RepoTab {
  id: RepoTabId;
  label: string;
  icon: PageIconName;
  /** Under `/owner/repo/` ('' is the repository's home). */
  path: string;
}

export interface BandCrumb {
  label: string;
  to?: string;
}

export interface RepoBand {
  tab: RepoTabId;
  icon: PageIconName;
  crumbs: BandCrumb[];
  title: string;
}

const TABS: Record<RepoTabId, RepoTab> = {
  code: { id: 'code', label: t('Code'), icon: 'code', path: '' },
  health: { id: 'health', label: t('Health'), icon: 'pulse', path: 'health' },
  pulls: {
    id: 'pulls',
    label: t('Pull requests'),
    icon: 'pull',
    path: 'pulls',
  },
  releases: {
    id: 'releases',
    label: t('Releases'),
    icon: 'tag',
    path: 'releases',
  },
  actions: {
    id: 'actions',
    label: t('Actions'),
    icon: 'play',
    path: 'actions',
  },
  insights: {
    id: 'insights',
    label: t('Insights'),
    icon: 'graph',
    path: 'insights',
  },
  settings: {
    id: 'settings',
    label: t('Settings'),
    icon: 'sliders',
    path: 'settings',
  },
  commits: {
    id: 'commits',
    label: t('Commits'),
    icon: 'commit',
    path: 'commits',
  },
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The decoded path segments after `/owner/repo`. */
export function repoRest(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).slice(2).map(decode);
}

/** The tab a repository page belongs to; on agent repositories the commit pages have their own tab. */
export function repoTabOf(rest: string[], agentRepo: boolean): RepoTabId {
  switch (rest[0]) {
    case 'health':
      return 'health';
    case 'pulls':
    case 'pull':
    case 'compare':
    case 'session':
      return 'pulls';
    case 'releases':
    case 'tags':
      return 'releases';
    case 'actions':
      return 'actions';
    case 'insights':
      return 'insights';
    case 'settings':
      return 'settings';
    case 'commits':
    case 'commit':
      return agentRepo ? 'commits' : 'code';
    default:
      return 'code';
  }
}

/**
 * The tabs, in order. Agent repositories (`<handle>/<handle>`, the agent's instructions) show Code, Commits and
 * Settings. Settings needs admin rights on the repository. Health, Branches, Live and Audit log join as their
 * pages are built.
 */
export function repoTabs(agentRepo: boolean, admin: boolean): RepoTab[] {
  const ids: RepoTabId[] = agentRepo
    ? ['code', 'commits']
    : ['code', 'health', 'pulls', 'releases', 'actions', 'insights'];
  if (admin) ids.push('settings');
  return ids.map((id) => TABS[id]);
}

/** The band's trail and name for a repository page, from its URL. */
export function repoBand(
  rest: string[],
  base: string,
  agentRepo: boolean
): RepoBand {
  const tab = repoTabOf(rest, agentRepo);
  const page = (icon: PageIconName, title: string): RepoBand => ({
    tab,
    icon,
    crumbs: [{ label: title }],
    title,
  });
  const item = (
    icon: PageIconName,
    parent: RepoTab,
    title: string
  ): RepoBand => ({
    tab,
    icon,
    crumbs: [
      { label: parent.label, to: `${base}/${parent.path}` },
      { label: title },
    ],
    title,
  });
  const [section, id] = rest;
  const last = rest[rest.length - 1];
  switch (section) {
    case 'tree':
      return rest.length > 1 ? page('code', last) : page('code', t('Code'));
    case 'blob':
      return rest.length > 1 ? page('file', last) : page('code', t('Code'));
    case 'commits':
      return page('commit', t('Commits'));
    case 'commit':
      return item('commit', TABS.commits, (id ?? '').slice(0, 7));
    case 'health':
      return page('pulse', t('Health'));
    case 'pulls':
      return page('pull', t('Pull requests'));
    case 'pull':
      return item('pull', TABS.pulls, `#${id ?? ''}`);
    case 'compare':
      return item('pull', TABS.pulls, t('New pull request'));
    case 'session':
      return item('pull', TABS.pulls, t('Session'));
    case 'releases':
      return id ? item('tag', TABS.releases, id) : page('tag', t('Releases'));
    case 'tags':
      return item('tag', TABS.releases, t('Tags'));
    case 'actions':
      if (id === 'runs' && rest[2])
        return item('play', TABS.actions, t('Run #{n}', { n: rest[2] }));
      if (id === 'agent') return item('play', TABS.actions, t('Agent run'));
      return page('play', t('Actions'));
    case 'insights':
      return page('graph', t('Insights'));
    case 'settings':
      return page('sliders', t('Settings'));
    default:
      return page('code', t('Code'));
  }
}
