// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ClockIcon,
  DotFillIcon,
  HistoryIcon,
  InboxIcon,
  PersonAddIcon,
  PlusIcon,
  RepoIcon,
  ShieldLockIcon,
} from '@primer/octicons-react';
import { api, qk, type HealthReport } from '@/lib/api/uiApi';
import { useCurrentUser } from '@/lib/auth/auth';
import { timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import { agentColor } from '@/lib/agents/agentLook';
import {
  boardRows,
  boardTotals,
  crewActivity,
  type BoardRow,
} from '@/lib/pulls/board';
import {
  HOME_AUDIT_LIMIT,
  homeAuditKey,
  useAgentList,
  useRepoStats,
  BOARD_REFRESH_MS,
} from '@/lib/pulls/boardQueries';
import {
  brokenRepos,
  dateEyebrow,
  decisionsOf,
  healthState,
  homeHeadline,
  homeLede,
  mergeActivity,
  repoVerdict,
  sinceLastWeek,
  topByActivity,
  type Decision,
  type GlanceLine,
  type RepoHealth,
} from '@/lib/utils/home';
import { usePageHead } from '@/components/ui/PageHead';
import { Section } from '@/components/ui/Section';
import { Chip } from '@/components/ui/Chip';
import { Verdict } from '@/components/ui/Verdict';
import { EmptyState } from '@/components/ui/EmptyState';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { Avatar } from '@/components/ui/Avatar';
import { AuditList } from '@/components/admin/AuditEvents';
import { LoadError } from '@/components/ui/Notice';
import { CrewAvatar, VisChip } from '@/components/repo/RepoBoard';

/** Decisions shown as cards; the rest wait in Approvals. */
const MAX_DECISIONS = 3;
/** Repositories whose health, and log, Home reads. */
const HEALTH_REPOS = 3;
const ACTIVITY_LIMIT = 8;
const ASIDE_REPOS = 8;
const RECENT_REPOS = 6;
const REFRESH = {
  refetchInterval: BOARD_REFRESH_MS,
  refetchOnWindowFocus: true,
} as const;

/**
 * Home: the owner's answer first. A statement ("Nothing is broken. 1 decision needs you."), the decisions an agent
 * needs answered, what got better or worse since last week, how each busy repository is doing, and what happened.
 * Beside it: your repositories and your crew.
 */
export default function Home() {
  const user = useCurrentUser()!;
  usePageHead({
    icon: 'home',
    crumbs: [{ label: t('Home') }],
    title: t('Home'),
  });

  const stats = useRepoStats();
  const agents = useAgentList();
  const approvals = useQuery({
    queryKey: [...qk.approvals, 'home'],
    queryFn: () => api.approvals({ limit: 25 }),
    refetchOnWindowFocus: true,
  });

  // Which repository is a reviewer agent's decides what is code, what is busiest and what each list shows, so nothing
  // is classified until both the repositories and the agents have loaded.
  const loaded = !!stats.data && !!agents.data;
  const boardFailed =
    (!stats.data && stats.isError) || (!agents.data && agents.isError);
  const boardLoading = !loaded && !boardFailed;
  const rows = useMemo(
    () => (stats.data && agents.data ? boardRows(stats.data, agents.data) : []),
    [stats.data, agents.data]
  );
  const top = useMemo(() => topByActivity(rows, HEALTH_REPOS), [rows]);
  const totals = useMemo(() => boardTotals(rows), [rows]);
  const crew = useMemo(() => crewActivity(rows), [rows]);

  const healths = useQueries({
    queries: top.map((r) => {
      const [o, n] = r.repo.fullName.split('/');
      return {
        queryKey: qk.health(o, n),
        queryFn: () => api.health(o, n),
        ...REFRESH,
      };
    }),
  });
  const audits = useQueries({
    queries: top.map((r) => {
      const [o, n] = r.repo.fullName.split('/');
      return {
        queryKey: homeAuditKey(o, n),
        queryFn: () => api.repoAudit(o, n, undefined, HOME_AUDIT_LIMIT),
        ...REFRESH,
      };
    }),
  });

  const agentByHandle = useMemo(
    () => new Map((agents.data ?? []).map((a) => [a.username, a])),
    [agents.data]
  );
  const agentNames = useMemo(
    () =>
      Object.fromEntries((agents.data ?? []).map((a) => [a.username, a.name])),
    [agents.data]
  );

  const reports: RepoHealth[] = top.flatMap((r, i) =>
    healths[i]?.data
      ? [{ repo: r.repo.fullName, report: healths[i].data! }]
      : []
  );
  const healthSettled = healths.every((h) => !h.isPending);
  const codeRepos = rows.filter((r) => r.agent === null).length;
  const health = healthState({
    loading: boardLoading,
    unavailable: boardFailed,
    total: codeRepos,
    checked: top.length,
    pending: healths.filter((h) => h.isPending).length,
    failed: healths.filter((h) => h.isError).length,
    failing: brokenRepos(reports),
  });

  const decisions = useMemo(
    () => decisionsOf(approvals.data?.items ?? [], user.username ?? null),
    [approvals.data, user.username]
  );
  const waiting = approvals.data?.count ?? 0;
  const cards = decisions.slice(0, MAX_DECISIONS);
  const rest = Math.max(0, waiting - cards.length);

  const headline = approvals.isError
    ? t('We couldn’t check what needs you.')
    : homeHeadline({
        decisions: decisions.length,
        others: Math.max(0, waiting - decisions.length),
        health,
      });
  const ready = !approvals.isPending && headline !== null;

  const activity = useMemo(
    () =>
      mergeActivity(
        audits.map((a) => a.data?.events ?? []),
        ACTIVITY_LIMIT
      ),
    [audits]
  );
  const lines = useMemo(() => sinceLastWeek(reports), [reports]);

  const [find, setFind] = useState('');
  const mine = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.agent === null &&
            (r.repo.owner.id === user.id || r.repo.ownerType === 'team')
        )
        .sort((a, b) => b.repo.stats.updatedAt - a.repo.stats.updatedAt),
    [rows, user.id]
  );
  const foundMine = mine.filter((r) =>
    r.repo.fullName.toLowerCase().includes(find.trim().toLowerCase())
  );
  const recent = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.repo.stats.updatedAt - a.repo.stats.updatedAt)
        .slice(0, RECENT_REPOS),
    [rows]
  );
  const noRepos = stats.data?.length === 0;

  return (
    <>
      <header className="home-head" aria-busy={!ready}>
        <span className="eyebrow">{dateEyebrow(new Date())}</span>
        {ready ? (
          <>
            <h2 className="ph-title">{headline}</h2>
            {loaded && (
              <p className="lede">
                {homeLede({
                  merged7d: totals.merged7d,
                  automatic: totals.automatic,
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="sk sk-title" />
            <div className="sk sk-line w50" />
          </>
        )}
      </header>

      <div className="cols">
        <div className="col">
          {/* What needs you */}
          {approvals.isPending ? (
            <div className="sk sk-block short" />
          ) : approvals.isError ? (
            <LoadError
              what={t('what needs you')}
              error={approvals.error}
              onRetry={() => approvals.refetch()}
            />
          ) : (
            <>
              {cards.length > 0 ? (
                <div className="home-ask-stack">
                  {cards.map((d) => (
                    <DecisionCard
                      key={d.flag.id}
                      decision={d}
                      me={user.username ?? null}
                      color={agentByHandle.get(d.agent.agent.username)?.color}
                    />
                  ))}
                </div>
              ) : waiting === 0 ? (
                <div className="home-ask done">
                  <div className="home-ask-body">
                    <strong>{t('Nothing is waiting on you.')}</strong>
                    <p>
                      {t(
                        'When a reviewer needs an answer from you, it shows up here first.'
                      )}
                    </p>
                  </div>
                  <Link className="btn small" to="/approvals">
                    {t('Approvals')}
                  </Link>
                </div>
              ) : null}
              {rest > 0 && (
                <Link className="home-strip" to="/approvals">
                  <InboxIcon size={16} />
                  <span>
                    <b>
                      {cards.length
                        ? tn(rest, '{n} more item', '{n} more items')
                        : tn(rest, '{n} item', '{n} items')}
                    </b>{' '}
                    {t('waiting in Approvals')}
                    {(approvals.data?.assignedToMe ?? 0) > 0 &&
                      ` · ${tn(
                        approvals.data!.assignedToMe,
                        '{n} assigned to you',
                        '{n} assigned to you'
                      )}`}
                  </span>
                  <ArrowRightIcon size={16} />
                </Link>
              )}
            </>
          )}

          {noRepos && (
            <section className="panel">
              <EmptyState
                picture={<RepoIcon size={24} />}
                title={t('No repositories yet')}
                body={t(
                  'Repositories created by anyone on this instance will show up here.'
                )}
                action={
                  <Link className="btn primary" to="/new">
                    {t('Create repository')}
                  </Link>
                }
              />
            </section>
          )}

          {!stats.data && stats.isError && (
            <LoadError
              what={t('your repositories')}
              error={stats.error}
              onRetry={() => stats.refetch()}
            />
          )}
          {!agents.data && agents.isError && (
            <LoadError
              what={t('the reviewer agents')}
              error={agents.error}
              onRetry={() => agents.refetch()}
            />
          )}

          {top.length > 0 && (
            <>
              <Section title={t('Since last week')}>
                {reports.length === 0 && !healthSettled ? (
                  <div className="home-glance">
                    <div className="sk sk-line w60" />
                    <div className="sk sk-line w50" />
                  </div>
                ) : reports.length === 0 ? (
                  <LoadError
                    what={t('the health report')}
                    error={healths.find((h) => h.isError)?.error}
                    onRetry={() => healths.forEach((h) => h.refetch())}
                  />
                ) : (
                  <div className="home-glance">
                    {lines.map((l, i) => (
                      <Glance key={i} line={l} />
                    ))}
                  </div>
                )}
              </Section>

              <Section
                title={
                  codeRepos > HEALTH_REPOS
                    ? t('Health of your busiest repositories')
                    : t('Health of each repository')
                }
                actions={
                  <Link className="small" to="/repos">
                    {t('All repositories')}
                  </Link>
                }
              >
                <div className="home-proj-list">
                  {top.map((r, i) => (
                    <ProjCard key={r.repo.id} row={r} health={healths[i]} />
                  ))}
                </div>
              </Section>

              <Section title={t('Activity')}>
                {activity.length > 0 ? (
                  <div className="panel">
                    <AuditList
                      events={activity}
                      options={{ scope: 'instance', agentNames }}
                    />
                  </div>
                ) : audits.some((a) => a.isPending) ? (
                  <div className="sk-rows">
                    <div className="sk sk-row" />
                    <div className="sk sk-row" />
                  </div>
                ) : audits.every((a) => a.isError) ? (
                  <LoadError
                    what={t('the activity')}
                    error={audits[0]?.error}
                    onRetry={() => audits.forEach((a) => a.refetch())}
                  />
                ) : (
                  <section className="panel">
                    <EmptyState
                      picture={<HistoryIcon size={20} />}
                      title={t('Nothing has happened yet.')}
                      body={t(
                        'Merges, decisions and changes to these repositories appear here as they happen.'
                      )}
                    />
                  </section>
                )}
              </Section>
            </>
          )}

          {recent.length > 0 && (
            <Section
              title={t('Recently updated')}
              actions={
                <Link className="small" to="/repos">
                  {t('All repositories')}
                </Link>
              }
            >
              <ul className="home-recent panel">
                {recent.map((r) => (
                  <li key={r.repo.id}>
                    {r.agent ? (
                      <AgentAvatar
                        handle={r.repo.name}
                        color={r.agent.color}
                        size={28}
                      />
                    ) : (
                      <Avatar
                        user={r.repo.owner}
                        size={28}
                        square={r.repo.ownerType === 'team'}
                      />
                    )}
                    <div className="home-recent-main">
                      <div className="home-recent-name">
                        <Link to={`/${r.repo.fullName}`}>
                          {r.repo.fullName}
                        </Link>
                        {r.agent ? (
                          <span className="vis">{t('Agent instructions')}</span>
                        ) : (
                          <VisChip repo={r.repo} />
                        )}
                      </div>
                      {r.repo.description && (
                        <span className="home-recent-desc">
                          {r.repo.description}
                        </span>
                      )}
                    </div>
                    <span className="when">
                      {t('Updated {when}', {
                        when: timeAgo(new Date(r.repo.stats.updatedAt)),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {boardLoading && (
            <div className="sk-rows" role="status" aria-label={t('Loading')}>
              <div className="sk sk-row tall" />
              <div className="sk sk-row tall" />
            </div>
          )}
        </div>

        <aside className="col side">
          <section className="panel pad">
            <div className="section-head">
              <h2>{t('Repositories')}</h2>
              <Link className="btn small primary" to="/new">
                <PlusIcon size={14} />
                {t('New')}
              </Link>
            </div>
            <input
              id="home-find"
              className="home-find"
              type="search"
              aria-label={t('Find a repository')}
              placeholder={t('Find a repository…')}
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            {boardLoading ? (
              <div className="sk-rows">
                <div className="sk sk-line w60" />
                <div className="sk sk-line w50" />
                <div className="sk sk-line w60" />
              </div>
            ) : (
              <ul className="plain">
                {foundMine.slice(0, ASIDE_REPOS).map((r) => (
                  <li key={r.repo.id}>
                    <Link className="home-repo" to={`/${r.repo.fullName}`}>
                      <RepoIcon />
                      <span className="mono">{r.repo.fullName}</span>
                    </Link>
                  </li>
                ))}
                {boardFailed && (
                  <li className="muted small">
                    {t('Could not load your repositories.')}
                  </li>
                )}
                {loaded && mine.length === 0 && (
                  <li className="muted small">
                    {t("You don't have any repositories yet.")}
                  </li>
                )}
                {mine.length > 0 && foundMine.length === 0 && (
                  <li className="muted small">{t('No repository matches.')}</li>
                )}
                {foundMine.length > ASIDE_REPOS && (
                  <li className="muted small">
                    {t('{n} more. See all repositories.', {
                      n: foundMine.length - ASIDE_REPOS,
                    })}
                  </li>
                )}
              </ul>
            )}
            <Link className="small" to="/repos">
              {t('All repositories')}
            </Link>
          </section>

          <section className="panel pad">
            <h2>{t('Your crew')}</h2>
            {boardLoading ? (
              <div className="sk sk-line w60" />
            ) : boardFailed ? (
              <p className="muted small">{t('Could not load your crew.')}</p>
            ) : crew.length > 0 ? (
              <div className="crew-stack">
                {crew.map((m) => (
                  <CrewAvatar key={m.handle} member={m} size={44} />
                ))}
              </div>
            ) : (
              <p className="muted small">
                {t('No reviewer agents are on your repositories yet.')}
              </p>
            )}
            <Link className="small" to="/agents">
              {t('Agents')}
            </Link>
          </section>

          {user.role === 'admin' && (
            <section className="panel pad invite-panel">
              <div className="invite-head">
                <PersonAddIcon size={20} />
                <h2>{t('Bring your team')}</h2>
              </div>
              <p className="muted small">
                {t(
                  'Invite members to collaborate on repositories in this instance.'
                )}
              </p>
              <Link className="btn small" to="/admin?invite=1">
                {t('Invite member')}
              </Link>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

/** One decision: the agent that is asking, its plain question, and a way to answer it on its own page. */
function DecisionCard({
  decision,
  me,
  color,
}: {
  decision: Decision;
  me: string | null;
  color: string | undefined;
}) {
  const { item, agent, flag } = decision;
  const handle = agent.agent.username;
  const name = agent.agent.name;
  const n = item.pull.number;
  const assigned = flag.assignee;
  return (
    <div className="home-ask">
      <AgentAvatar
        handle={handle}
        color={agentColor(handle, color)}
        status="needs"
        size={56}
      />
      <div className="home-ask-body">
        <span className="home-ask-from">
          {t('{agent} is asking · {repo}', {
            agent: name,
            repo: item.repo.fullName,
          })}
        </span>
        <strong>{flag.question}</strong>
        {flag.title && flag.title !== flag.question && <p>{flag.title}</p>}
        <span className="home-ask-meta">
          <span>
            <ClockIcon />
            {t('Updated {when}', { when: timeAgo(item.pull.updatedAt) })}
          </span>
          <span>
            <Link to={`/${item.repo.fullName}/pull/${n}`}>
              {t('Pull request #{n}', { n })}
            </Link>
            {item.pull.author && (
              <>&nbsp;{t('by {user}', { user: item.pull.author.username })}</>
            )}
          </span>
          {flag.guarded && (
            <span>
              <ShieldLockIcon />
              {t('Needs your reason to approve')}
            </span>
          )}
          {assigned &&
            (assigned.login === me ? (
              <Chip tone="info">{t('Assigned to you')}</Chip>
            ) : (
              <span>
                {t('Assigned to {who}', {
                  who: assigned.name || assigned.login,
                })}
              </span>
            ))}
        </span>
      </div>
      <Link
        className="btn primary"
        to={`/approvals/${flag.id}`}
        aria-label={t("Answer {agent}'s question about {repo}#{n}", {
          agent: name,
          repo: item.repo.fullName,
          n,
        })}
      >
        {t('Answer')}
      </Link>
    </div>
  );
}

const GLANCE = {
  better: { word: t('Better'), icon: <ArrowUpIcon />, cls: ' good' },
  worse: { word: t('Worse'), icon: <ArrowDownIcon />, cls: ' worse' },
  same: { word: t('Same'), icon: <DotFillIcon />, cls: '' },
} as const;

function Glance({ line }: { line: GlanceLine }) {
  const g = GLANCE[line.trend];
  return (
    <span className={`home-glance-item${g.cls}`}>
      {g.icon}
      <span>
        <b>{g.word}</b>
        {line.text}
      </span>
    </span>
  );
}

/** A repository's health on Home: its verdict, its week in numbers and the reviewers that have something to say. */
function ProjCard({
  row,
  health,
}: {
  row: BoardRow;
  health: UseQueryResult<HealthReport>;
}) {
  const { repo } = row;
  const s = repo.stats;
  const verdict = health.data ? repoVerdict(health.data) : null;
  const busy = s.agents.filter(
    (a) =>
      a.status !== 'idle' &&
      a.status !== 'approved' &&
      a.status !== 'not_needed'
  );
  const quiet = s.agents.length - busy.length;
  return (
    <Link className="home-proj" to={`/${repo.fullName}/health`}>
      <div className="home-proj-head">
        <span className="home-proj-name mono">{repo.fullName}</span>
        {verdict ? (
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
        ) : health.isError ? (
          <Chip tone="off">{t('Health unavailable')}</Chip>
        ) : (
          <span className="sk home-sk-chip" />
        )}
      </div>
      <div className="home-proj-stats">
        <span>{tx('{n} open', { n: <b>{s.pulls.open}</b> })}</span>
        <span>{tx('{n} merged in 7 days', { n: <b>{s.merged7d}</b> })}</span>
        {s.mergedAutomaticallyPct !== null && (
          <span>
            {tx('{n}% with no merge click', {
              n: <b>{s.mergedAutomaticallyPct}</b>,
            })}
          </span>
        )}
      </div>
      <div className="home-proj-crew">
        {busy.map((a) => (
          <Verdict
            key={a.handle}
            handle={a.handle}
            name={a.name}
            color={a.color}
            status={a.status}
          />
        ))}
        <span className="muted small">
          {s.agents.length === 0
            ? t('No reviewer agents yet')
            : quiet === 0
              ? ''
              : tn(
                  quiet,
                  '{n} other reviewer has nothing to flag',
                  '{n} other reviewers have nothing to flag'
                )}
        </span>
      </div>
    </Link>
  );
}
