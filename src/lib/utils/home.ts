// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { Tone } from '../agents/agentLook';
import type { BoardRow } from '../pulls/board';
import { lang, t, tn } from '../i18n/i18n';
import type {
  ApprovalItem,
  AuditEvent,
  HealthReport,
  HealthTrend,
  ReviewFlag,
} from '../api/uiApi';

// Home, in words: what needs the owner, what got better or worse since last week, how each repository is doing and
// what happened. Pure, so the sentences are tested; the page only lays them out.

export interface Decision {
  item: ApprovalItem;
  agent: ApprovalItem['agents'][number];
  flag: ReviewFlag;
}

/**
 * The owner's decisions: open findings for a person that carry the agent's plain yes/no question. What is assigned to
 * you comes first, then what nobody was asked, then what someone else was asked; within each, the order of the list.
 */
export function decisionsOf(
  items: ApprovalItem[],
  me: string | null
): Decision[] {
  const rank = (d: Decision) =>
    !d.flag.assignee ? 1 : d.flag.assignee.login === me ? 0 : 2;
  const found: Decision[] = [];
  for (const item of items)
    for (const agent of item.agents)
      for (const flag of agent.flags)
        if (
          flag.kind === 'needs_person' &&
          !flag.approvedAt &&
          flag.question?.trim()
        )
          found.push({ item, agent, flag });
  return found
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .map(({ d }) => d);
}

/** "a", "a and b", "a, b and c" (in Chinese "a、b 和 c"). */
const joinAnd = (xs: string[]) =>
  xs.length < 2
    ? (xs[0] ?? '')
    : t('{list} and {last}', {
        list: xs.slice(0, -1).join(lang === 'zh' ? '、' : ', '),
        last: xs[xs.length - 1],
      });

/** What is known about whether anything is broken, from the health of the repositories Home checked. */
export type HealthState =
  /** Still reading: the statement shows a placeholder rather than a claim that may change. */
  | { kind: 'loading' }
  /** The repositories, the reviewer agents or a health report could not be read: no claim either way. */
  | { kind: 'unavailable' }
  /** Tests on main are failing in these repositories. */
  | { kind: 'failing'; repos: string[] }
  /** Every report arrived and none has failing tests, for `checked` of `total` code repositories. */
  | { kind: 'fine'; checked: number; total: number };

/**
 * What can be said about health. Nothing before everything Home asked for has settled; a failure to read anything
 * means no claim, unless a repository is known to be failing; and only when every report is in is it "fine", for
 * as many repositories as were actually checked.
 */
export function healthState(input: {
  /** The repository board or the reviewer agents are still loading. */
  loading: boolean;
  /** The repository board or the reviewer agents could not be loaded. */
  unavailable: boolean;
  /** Code repositories on the instance. */
  total: number;
  /** Health reports asked for (the busiest repositories). */
  checked: number;
  /** Of those, still loading. */
  pending: number;
  /** Of those, failed. */
  failed: number;
  /** The repositories whose answered reports show failing tests on main. */
  failing: string[];
}): HealthState {
  if (input.unavailable) return { kind: 'unavailable' };
  if (input.loading || input.pending > 0) return { kind: 'loading' };
  if (input.failing.length) return { kind: 'failing', repos: input.failing };
  if (input.failed > 0) return { kind: 'unavailable' };
  return { kind: 'fine', checked: input.checked, total: input.total };
}

/**
 * Home's statement, or null while it is not known yet. `decisions` are plain questions for the owner and `others`
 * everything else waiting in Approvals. It only says nothing is broken for the repositories that were checked: with
 * more code repositories than that, it says "in your 3 busiest repositories".
 */
export function homeHeadline(input: {
  decisions: number;
  others: number;
  health: HealthState;
}): string | null {
  const { decisions, others, health } = input;
  if (health.kind === 'loading') return null;
  const parts = [
    decisions > 0 && tn(decisions, '{n} decision', '{n} decisions'),
    others > 0 &&
      (decisions > 0
        ? tn(others, '{n} other item', '{n} other items')
        : tn(others, '{n} item', '{n} items')),
  ].filter((p): p is string => !!p);
  const things = joinAnd(parts);
  const needs = parts.length
    ? decisions + others === 1
      ? t('{things} needs you.', { things })
      : t('{things} need you.', { things })
    : t('Nothing needs you.');
  switch (health.kind) {
    case 'unavailable':
      return needs;
    case 'failing':
      return t('Tests are failing on {repos}. {needs}', {
        repos: joinAnd(health.repos),
        needs,
      });
    case 'fine': {
      const checked = tn(
        health.checked,
        'busiest repository',
        '{n} busiest repositories'
      );
      return health.checked >= health.total
        ? t('Nothing is broken. {needs}', { needs })
        : t('Nothing is broken in your {checked}. {needs}', {
            checked,
            needs,
          });
    }
  }
}

/** The sentence under Home's statement: what merged in the last seven days and how much needed no merge click. */
export function homeLede(input: {
  merged7d: number;
  automatic: number;
}): string {
  const { merged7d, automatic } = input;
  if (merged7d === 0) return t('Nothing has merged in the last 7 days.');
  const changes = tn(merged7d, '{n} change', '{n} changes');
  if (automatic === merged7d)
    return merged7d === 1
      ? t(
          'CloudForge merged {changes} in the last 7 days, and it needed no merge click.',
          { changes }
        )
      : t(
          'CloudForge merged {changes} in the last 7 days, and none needed a merge click.',
          { changes }
        );
  return t(
    'CloudForge merged {changes} in the last 7 days; {automatic} needed no merge click.',
    { changes, automatic }
  );
}

/** "Friday 9 October", in the reader's own day ("10月9日星期五" in Chinese). */
export function dateEyebrow(now: Date): string {
  if (lang === 'zh')
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(now);
  const of = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${of('weekday')} ${of('day')} ${of('month')}`;
}

/**
 * The code repositories Home checks the health of: the busiest first (open pull requests plus merges this week,
 * then the most recently changed). Reviewer agents' instruction repositories are left out.
 */
export function topByActivity(rows: BoardRow[], count: number): BoardRow[] {
  const score = (r: BoardRow) =>
    r.repo.stats.pulls.open + r.repo.stats.merged7d;
  return rows
    .filter((r) => r.agent === null)
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        b.repo.stats.updatedAt - a.repo.stats.updatedAt ||
        a.repo.fullName.localeCompare(b.repo.fullName)
    )
    .slice(0, count);
}

export interface RepoHealth {
  repo: string;
  report: HealthReport;
}

/** The repositories whose tests on main are failing now. */
export function brokenRepos(reports: RepoHealth[]): string[] {
  return reports
    .filter((r) => r.report.areas.some((a) => a.id === 'tests' && a.open > 0))
    .map((r) => r.repo);
}

export interface GlanceLine {
  trend: HealthTrend;
  text: string;
}

/**
 * "Since last week": every area that got worse, then every one that got better, then what stayed the same (an area
 * with problems still open on its own line, the quiet ones together). With several repositories each line names its
 * repository, and the quiet areas are only counted.
 */
export function sinceLastWeek(reports: RepoHealth[]): GlanceLine[] {
  const several = reports.length > 1;
  const worse: GlanceLine[] = [];
  const better: GlanceLine[] = [];
  const same: GlanceLine[] = [];
  for (const { repo, report } of reports) {
    // "Security in a/one" when there are several repositories, else just "Security".
    const named = (label: string) =>
      several ? t('{area} in {repo}', { area: label, repo }) : label;
    const line = (label: string, detail: string) =>
      t('{area}: {detail}', { area: named(label), detail });
    const quiet: string[] = [];
    for (const a of report.areas) {
      if (a.trend === 'worse')
        worse.push({ trend: 'worse', text: line(a.label, a.detail) });
      else if (a.trend === 'better')
        better.push({ trend: 'better', text: line(a.label, a.detail) });
      else if (a.open > 0)
        same.push({ trend: 'same', text: line(a.label, a.status) });
      else quiet.push(a.label);
    }
    if (quiet.length)
      same.push({
        trend: 'same',
        text: several
          ? tn(
              quiet.length,
              '{n} area in {repo} unchanged',
              '{n} areas in {repo} unchanged',
              { repo }
            )
          : t('No change in {areas}', { areas: joinAnd(quiet) }),
      });
  }
  return [...worse, ...better, ...same];
}

/** One repository's verdict on its Home card: failing tests, then decisions waiting, then what got worse, else healthy. */
export function repoVerdict(report: HealthReport): {
  tone: Tone;
  label: string;
} {
  if (report.areas.some((a) => a.id === 'tests' && a.open > 0))
    return { tone: 'critical', label: t('Tests are failing on main') };
  if (report.decisionsWaiting > 0)
    return {
      tone: 'warn',
      label: tn(
        report.decisionsWaiting,
        '{n} decision for you',
        '{n} decisions for you'
      ),
    };
  const worse = report.areas.filter((a) => a.trend === 'worse');
  if (worse.length === 1)
    return {
      tone: 'serious',
      label: t('{area} got worse', { area: worse[0].label }),
    };
  if (worse.length > 1)
    return {
      tone: 'serious',
      label: t('{n} areas got worse', { n: worse.length }),
    };
  return { tone: 'good', label: t('Healthy') };
}

/** Pull request timeline entries worth a line in the feed; the rest (state changes, stacking) is noise on Home. */
const LOUD_PULL = new Set([
  'pull.merged',
  'pull.reverted',
  'pull.approved',
  'pull.withdrawn',
  'pull.learned',
  'pull.rebased',
]);

/** Whether an audit event belongs in Home's activity feed. */
export function isNotable(e: AuditEvent): boolean {
  if (e.action === 'branch.deleted') return false;
  if (e.action.startsWith('pull.')) return LOUD_PULL.has(e.action);
  return true;
}

/** The newest notable events of several repositories' logs, once each, at most `limit`. */
export function mergeActivity(
  lists: AuditEvent[][],
  limit: number
): AuditEvent[] {
  const seen = new Set<string>();
  const all: AuditEvent[] = [];
  for (const list of lists)
    for (const e of list) {
      if (seen.has(e.id) || !isNotable(e)) continue;
      seen.add(e.id);
      all.push(e);
    }
  return all
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, limit);
}
