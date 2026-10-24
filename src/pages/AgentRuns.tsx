// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CpuIcon,
  GitPullRequestIcon,
  HubotIcon,
  PlayIcon,
} from '@primer/octicons-react';
import {
  api,
  qk,
  type AgentRun,
  type AgentRunKind,
  type AgentRunStatus,
  type AgentStep,
  type RepoDetail,
} from '@/lib/uiApi';
import { duration, timeAgo } from '@/lib/format';
import { t, tn } from '@/lib/i18n';
import {
  actorRole,
  agentKindLabel,
  formatCost,
  formatTokens,
  modelsOf,
  runAvatarStatus,
  runOutcome,
  runStatusLook,
} from '@/lib/agentRuns';
import { useNow } from '@/lib/useNow';
import { AgentAvatar } from '@/components/AgentAvatar';
import { CopyButton } from '@/components/CopyButton';
import { RunStatusIcon } from '@/components/RunStatusIcon';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePageHead } from '@/components/ui/PageHead';
import { Pager, RunHeader, KindFilter } from '@/components/actions/parts';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import {
  resolveActor,
  useAgentDirectory,
  type ActorLook,
} from '@/components/actions/RunActor';

/** An agent run's status as the CI glyph's status and conclusion. */
function glyph(status: AgentRunStatus) {
  return status === 'running'
    ? ({ status: 'in_progress', conclusion: null } as const)
    : ({
        status: 'completed',
        conclusion: status === 'succeeded' ? 'success' : 'failure',
      } as const);
}

function RunStatusChip({ status }: { status: AgentRunStatus }) {
  const look = runStatusLook(status);
  return (
    <Chip
      tone={look.tone}
      icon={
        status === 'running' ? (
          <span className="spinner" aria-hidden="true" />
        ) : undefined
      }
    >
      {look.label}
    </Chip>
  );
}

/** The agent's robot, or a plain glyph for a run that names no agent. */
function ActorMark({
  actor,
  status,
  size,
}: {
  actor: ActorLook | null;
  status: AgentRunStatus;
  size: number;
}) {
  return actor ? (
    <AgentAvatar
      handle={actor.handle}
      color={actor.color}
      status={runAvatarStatus(status)}
      size={size}
    />
  ) : (
    <span className="act-glyph" style={{ width: size, height: size }}>
      <HubotIcon size={Math.round(size / 2)} />
    </span>
  );
}

/**
 * One kind's runs (or every kind), newest first, a page at a time. Give it `key={kind}` so the page position
 * starts over when the kind changes.
 */
export function AgentRunList({
  repo,
  kind,
}: {
  repo: RepoDetail;
  kind: AgentRunKind | null;
}) {
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  // Cursors of the pages before this one, for "Newer".
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1] ?? '';
  const q = useQuery({
    queryKey: qk.agentRuns(o, repo.name, kind ?? 'all', cursor),
    queryFn: () =>
      api.agentRuns(o, repo.name, {
        kind: kind ?? undefined,
        cursor: cursor || undefined,
        limit: 25,
      }),
    // Live updates refetch on changes; poll as well while a run is going.
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => r.status === 'running') ? 5000 : false,
  });
  const now = useNow(!!q.data?.runs.some((r) => r.status === 'running'));
  const lookup = useAgentDirectory();
  const label = kind ? agentKindLabel(kind) : t('All');

  return (
    <>
      <Section
        title={kind ? label : t('All agent runs')}
        actions={
          kind ? <span className="muted small">{t('Agent runs')}</span> : null
        }
      >
        <KindFilter base={base} current={kind} />
        {q.isError && !q.data ? (
          <div className="panel">
            <QueryError
              error={q.error}
              onRetry={() => void q.refetch()}
              title={t('Agent runs did not load')}
            />
          </div>
        ) : !q.data ? (
          <RowsSkeleton />
        ) : !q.data.runs.length && !cursor ? (
          <div className="panel">
            <EmptyState
              picture={<HubotIcon size={24} />}
              title={
                kind
                  ? t('No {kind} runs yet', { kind: label.toLowerCase() })
                  : t('No agent runs yet')
              }
              body={t(
                "Each time CloudForge's AI works on this repository, the run shows here with its steps, models, tokens and decisions."
              )}
            />
          </div>
        ) : (
          <>
            <ul className="act-list panel">
              {q.data.runs.map((run) => (
                <AgentRunRow
                  key={run.id}
                  repo={repo}
                  run={run}
                  now={now}
                  actor={resolveActor(run, lookup)}
                />
              ))}
            </ul>
            {(cursors.length > 0 || q.data.nextCursor) && (
              <Pager
                prevLabel={t('Newer')}
                nextLabel={t('Older')}
                onPrev={
                  cursors.length > 0
                    ? () => setCursors((c) => c.slice(0, -1))
                    : undefined
                }
                onNext={
                  q.data.nextCursor
                    ? () => setCursors((c) => [...c, q.data!.nextCursor!])
                    : undefined
                }
              />
            )}
          </>
        )}
      </Section>
      <p className="small muted">
        {t(
          'Costs are estimates at Cloudflare list prices. Prompts, diffs and model output are not kept; only metadata and short decisions.'
        )}{' '}
        <Link to={`${base}/actions`}>{t('Back to workflows')}</Link>
      </p>
    </>
  );
}

function AgentRunRow({
  repo,
  run,
  now,
  actor,
}: {
  repo: RepoDetail;
  run: AgentRun;
  now: number;
  actor: ActorLook | null;
}) {
  const base = `/${repo.fullName}`;
  return (
    <li className="act-row">
      <span className="act-lead">
        <ActorMark actor={actor} status={run.status} size={32} />
      </span>
      <div className="act-main">
        <Link
          className="act-title"
          to={`${base}/actions/agent/${encodeURIComponent(run.id)}`}
        >
          {run.title}
        </Link>
        <p className="small muted">
          {actor && <b className="act-who">{actor.name}</b>}
          {actor && ' · '}
          {agentKindLabel(run.kind)}
          {run.pullRequest && (
            <>
              {' · '}
              <Link to={`${base}/pull/${run.pullRequest.number}`}>
                #{run.pullRequest.number} {run.pullRequest.title}
              </Link>
            </>
          )}
        </p>
        {run.error && <p className="small act-err">{run.error}</p>}
      </div>
      <div className="act-meta small muted">
        <RunStatusChip status={run.status} />
        <span>
          {duration(run.startedAt, run.finishedAt, now)} ·{' '}
          {timeAgo(run.startedAt)}
        </span>
      </div>
    </li>
  );
}

function StepRow({
  step,
  index,
  now,
}: {
  step: AgentStep;
  index: number;
  now: number;
}) {
  const tokens =
    step.tokensIn !== null || step.tokensOut !== null
      ? t('{in} in · {out} out', {
          in: formatTokens(step.tokensIn ?? 0),
          out: formatTokens(step.tokensOut ?? 0),
        })
      : null;
  return (
    <li className={`act-step ${step.status}`}>
      <span className="act-step-n mono muted small">{index + 1}</span>
      <span className="act-step-ic">
        <RunStatusIcon {...glyph(step.status)} size={14} />
      </span>
      <div className="act-step-body">
        <div className="act-step-head">
          <b title={step.name}>{step.displayName}</b>
          {step.attempts > 1 && (
            <Chip tone="warn">
              {tn(step.attempts, '{n} attempt', '{n} attempts')}
            </Chip>
          )}
          <span className="act-step-time small muted">
            {duration(step.startedAt, step.finishedAt, now)}
          </span>
        </div>
        {step.model && (
          <p className="small muted act-step-model">
            <span className="act-inline">
              <CpuIcon size={14} />
              <code>{step.model.replace(/@cf\//g, '')}</code>
            </span>
            {tokens && <span>{tokens}</span>}
            {step.costEstimate !== null && (
              <span title={t('Estimate at Cloudflare list prices')}>
                {formatCost(step.costEstimate)}
              </span>
            )}
          </p>
        )}
        {step.decision && <p className="small act-decision">{step.decision}</p>}
        {step.error && <p className="small act-err">{step.error}</p>}
      </div>
    </li>
  );
}

/** One agent run: who did it, how it went, and each step with its model, tokens, cost and decision. */
export default function AgentRunView() {
  const repo = useOutletContext<RepoDetail>();
  const { id = '' } = useParams();
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const q = useQuery({
    queryKey: qk.agentRun(o, repo.name, id),
    queryFn: () => api.agentRun(o, repo.name, id),
    refetchInterval: (query) =>
      query.state.data?.run.status === 'running' ? 3000 : false,
  });
  const running = q.data?.run.status === 'running';
  const now = useNow(running);
  const lookup = useAgentDirectory();
  const run = q.data?.run;

  usePageHead({
    icon: 'crew',
    crumbs: [
      { label: t('Actions'), to: `${base}/actions` },
      {
        label: run
          ? t('{kind} runs', { kind: agentKindLabel(run.kind) })
          : t('Agent runs'),
        to: `${base}/actions?agent=${run?.kind ?? 'all'}`,
      },
      { label: run?.title ?? t('Agent run') },
    ],
    title: run?.title ?? t('Agent run'),
    tab: 'actions',
    documentTitle: t('Agent run'),
  });

  if (q.isError && !q.data)
    return (
      <QueryError
        error={q.error}
        onRetry={() => void q.refetch()}
        title={t('This agent run did not load')}
      />
    );
  if (!q.data || !run) return <Skeleton kind="detail" />;
  const { steps } = q.data;
  const actor = resolveActor(run, lookup);
  const models = modelsOf(steps);
  // A run error is already shown above the steps; don't say it twice.
  const outcome =
    run.status === 'failed' && run.error ? null : runOutcome(run, steps);
  const look = runStatusLook(run.status);

  return (
    <>
      <RunHeader
        lead={<ActorMark actor={actor} status={run.status} size={56} />}
        title={run.title}
        lede={
          <>
            {actor ? `${actor.name} · ` : ''}
            {actorRole(run)} · {agentKindLabel(run.kind)} ·{' '}
            {t('started {when}', { when: timeAgo(run.startedAt) })} ·{' '}
            {duration(run.startedAt, run.finishedAt, now)}
          </>
        }
        actions={<RunStatusChip status={run.status} />}
      />
      <KindFilter base={base} current={run.kind} />
      {run.error && (
        <div className="act-error" role="alert">
          {run.error}
        </div>
      )}
      <div className="cols">
        <div className="col">
          <section className="section">
            <div className="section-head">
              <h2>{t('Steps')}</h2>
              <span className="muted small">
                {tn(steps.length, '{n} step', '{n} steps')}
              </span>
            </div>
            {steps.length ? (
              <ol className="act-steps panel">
                {steps.map((s, i) => (
                  <StepRow key={s.id} step={s} index={i} now={now} />
                ))}
              </ol>
            ) : (
              <div className="panel">
                <EmptyState
                  title={
                    running ? t('Starting…') : t('No steps were recorded.')
                  }
                />
              </div>
            )}
          </section>
        </div>
        <aside className="col side">
          <section className="panel pad">
            <h2>{t('Outcome')}</h2>
            <RunStatusChip status={run.status} />
            {outcome && (
              <p
                className={run.status === 'failed' ? 'small act-err' : 'small'}
              >
                {outcome}
              </p>
            )}
            <div className="act-links">
              {actor && (
                <Link className="btn small" to={actor.href}>
                  {t('About {name}', { name: actor.name })}
                </Link>
              )}
              {run.pullRequest && (
                <Link
                  className="btn small"
                  to={`${base}/pull/${run.pullRequest.number}`}
                >
                  <GitPullRequestIcon size={14} />#{run.pullRequest.number}{' '}
                  {run.pullRequest.title}
                </Link>
              )}
            </div>
          </section>
          <section className="panel pad">
            <h2>{t('Model usage')}</h2>
            <dl className="act-facts">
              <div>
                <dt>{t('Tokens')}</dt>
                <dd>
                  {t('{in} in · {out} out', {
                    in: formatTokens(run.tokensIn),
                    out: formatTokens(run.tokensOut),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('Estimated cost')}</dt>
                <dd title={t('Estimate at Cloudflare list prices')}>
                  {run.costEstimate === null
                    ? '–'
                    : formatCost(run.costEstimate)}
                </dd>
              </div>
              {models.length > 0 && (
                <div>
                  <dt>{t('Models')}</dt>
                  <dd>
                    {models.map((m) => (
                      <code key={m} className="act-model">
                        {m}
                      </code>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>
          <section className="panel pad">
            <h2>{t('Details')}</h2>
            <dl className="act-facts">
              <div>
                <dt>{t('Started')}</dt>
                <dd>{timeAgo(run.startedAt)}</dd>
              </div>
              <div>
                <dt>{t('Status')}</dt>
                <dd>{look.label}</dd>
              </div>
              <div>
                <dt>{t('Total duration')}</dt>
                <dd>{duration(run.startedAt, run.finishedAt, now)}</dd>
              </div>
              <div>
                <dt>{t('Workflow instance')}</dt>
                <dd className="act-instance">
                  <code>{run.id}</code>
                  <CopyButton
                    text={run.id}
                    label={t('Copy workflow instance id')}
                    className="btn small quiet"
                  />
                </dd>
              </div>
            </dl>
            <Link className="small" to={`${base}/actions?agent=${run.kind}`}>
              <PlayIcon size={12} />{' '}
              {t('All {kind} runs', { kind: agentKindLabel(run.kind) })}
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
