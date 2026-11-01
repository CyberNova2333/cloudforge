// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClockIcon, PlayIcon } from '@primer/octicons-react';
import { api, qk, type RepoDetail, type WorkflowRun } from '@/lib/api/uiApi';
import { duration, shortSha, timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import { parseActionsView } from '@/lib/agents/agentRuns';
import { useNow } from '@/lib/utils/useNow';
import { CopyButton } from '@/components/ui/CopyButton';
import { RunStatusIcon } from '@/components/actions/RunStatusIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { Section } from '@/components/ui/Section';
import { FilterLinks, Pager } from '@/components/actions/parts';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { AgentRunList } from '@/pages/agents/AgentRuns';

const STARTER = `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm test
`;

function trigger(run: WorkflowRun) {
  const who = run.actor?.username ?? t('someone');
  if (run.event === 'pull_request')
    return tx('Pull request {pr} by {who}', {
      pr: `#${run.pullRequestNumber}`,
      who: <b>{who}</b>,
    });
  return tx('Commit {sha} pushed by {who}', {
    sha: <span className="mono">{shortSha(run.headSha)}</span>,
    who: <b>{who}</b>,
  });
}

export default function RepoActions() {
  const repo = useOutletContext<RepoDetail>();
  const [params, setParams] = useSearchParams();
  const view = parseActionsView(params);
  const base = `/${repo.fullName}`;

  return (
    <>
      <PageHead
        icon="play"
        crumbs={[{ label: t('Actions') }]}
        title={t('Actions')}
        tab="actions"
        lede={t(
          'Your workflows run on Cloudflare Containers. Every AI process CloudForge runs, such as reviews, rebases and conflict fixes, is listed under Agent runs.'
        )}
      />
      <nav className="act-tabs" aria-label={t('Actions')}>
        <Link
          to={`${base}/actions`}
          aria-current={view.mode === 'workflows' ? 'page' : undefined}
        >
          {t('Workflow runs')}
        </Link>
        <Link
          to={`${base}/actions?agent=all`}
          aria-current={view.mode === 'agents' ? 'page' : undefined}
        >
          {t('Agent runs')}
        </Link>
      </nav>
      {view.mode === 'agents' ? (
        <AgentRunList key={view.kind ?? 'all'} repo={repo} kind={view.kind} />
      ) : (
        <WorkflowRuns
          repo={repo}
          workflow={view.workflow}
          page={view.page}
          setPage={(page) =>
            setParams({
              ...(view.workflow ? { workflow: view.workflow } : {}),
              page: String(page),
            })
          }
        />
      )}
    </>
  );
}

function WorkflowRuns({
  repo,
  workflow,
  page,
  setPage,
}: {
  repo: RepoDetail;
  workflow: string;
  page: number;
  setPage: (page: number) => void;
}) {
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const q = useQuery({
    queryKey: qk.runs(o, repo.name, page, workflow),
    queryFn: () => api.runs(o, repo.name, page, workflow || undefined),
    // Poll while anything on the page is still running.
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => r.status !== 'completed')
        ? 3000
        : false,
  });
  const data = q.data;
  const now = useNow(!!data?.runs.some((r) => r.status === 'in_progress'));

  if (q.isError && !data)
    return (
      <div className="panel">
        <QueryError
          error={q.error}
          onRetry={() => void q.refetch()}
          title={t('Workflow runs did not load')}
          picture={<PlayIcon size={24} />}
        />
      </div>
    );
  if (!data) return <RowsSkeleton />;

  if (!data.configured && data.totalCount === 0)
    return (
      <div className="panel">
        <EmptyState
          picture={<PlayIcon size={24} />}
          title={t("Actions isn't set up on this server")}
          body={t(
            'A site admin can enable Actions by adding the Actions bindings to the deployment. See docs/configuration.md.'
          )}
        />
      </div>
    );

  if (data.totalCount === 0)
    return (
      <section className="panel pad act-starter">
        <h2>{t('Get started with Actions')}</h2>
        <p className="muted">
          {tx(
            'Build and test every push and pull request. Add a workflow file like this one at {path}; it uses the same syntax as GitHub Actions. Jobs run on Linux with Node.js, git and common build tools preinstalled.',
            { path: <code>.github/workflows/ci.yml</code> }
          )}
        </p>
        <div className="act-code">
          <div className="act-code-head">
            <span className="mono small muted">.github/workflows/ci.yml</span>
            <CopyButton
              text={STARTER}
              label={t('Copy workflow')}
              className="btn small quiet"
            />
          </div>
          <pre className="mono">{STARTER}</pre>
        </div>
        <p className="small muted">
          {tx(
            'Supported today: {run} steps, {checkout}, {setup}, {cache}, {artifacts}, JavaScript and composite actions (from GitHub or {local}), {needs}, {if}, matrix builds with include/exclude, expressions, step outputs, and {secrets} and {vars} (Settings → Secrets and variables). Use {runsOn} (up to {max}) for a bigger machine.',
            {
              run: <code>run</code>,
              checkout: <code>actions/checkout</code>,
              setup: <code>actions/setup-node</code>,
              cache: <code>actions/cache</code>,
              artifacts: <code>actions/upload-artifact</code>,
              local: <code>./path</code>,
              secrets: <code>secrets</code>,
              vars: <code>vars</code>,
              needs: <code>needs</code>,
              if: <code>if</code>,
              runsOn: <code>runs-on: cloudforge-standard-2</code>,
              max: <code>standard-4</code>,
            }
          )}
        </p>
      </section>
    );

  const current = data.workflows.find((w) => w.path === workflow);
  const pages = Math.ceil(data.totalCount / 25);
  return (
    <Section
      title={
        <>
          {current?.name ?? t('All workflows')}
          {current && <span className="mono small muted">{current.path}</span>}
        </>
      }
      actions={
        <span className="muted small">
          {tn(data.totalCount, '{n} workflow run', '{n} workflow runs')}
        </span>
      }
    >
      {data.workflows.length > 0 && (
        <FilterLinks
          label={t('Workflows')}
          items={[
            {
              key: '',
              label: t('All workflows'),
              to: `${base}/actions`,
              current: !workflow,
            },
            ...data.workflows.map((w) => ({
              key: w.path,
              label: w.name,
              to: `${base}/actions?workflow=${encodeURIComponent(w.path)}`,
              current: workflow === w.path,
            })),
          ]}
        />
      )}
      {data.runs.length > 0 ? (
        <ul className="act-list panel">
          {data.runs.map((run) => (
            <li key={run.id} className="act-row">
              <span className="act-lead">
                <RunStatusIcon
                  status={run.status}
                  conclusion={run.conclusion}
                  size={18}
                />
              </span>
              <div className="act-main">
                <Link
                  className="act-title"
                  to={`${base}/actions/runs/${run.runNumber}`}
                >
                  {run.displayTitle}
                </Link>
                <p className="small muted">
                  <b className="act-who">{run.name}</b> #{run.runNumber}:{' '}
                  {trigger(run)}
                  {' · '}
                  {run.pullRequestNumber ? (
                    <Link
                      className="mono"
                      to={`${base}/pull/${run.pullRequestNumber}`}
                    >
                      #{run.pullRequestNumber}
                    </Link>
                  ) : (
                    <span className="mono act-branch">{run.refName}</span>
                  )}
                </p>
              </div>
              <div className="act-meta small muted">
                {run.startedAt && (
                  <span className="act-inline">
                    <ClockIcon size={13} />
                    {duration(run.startedAt, run.completedAt, now)}
                  </span>
                )}
                <span>{timeAgo(run.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel">
          <EmptyState title={t('No runs on this page')} />
        </div>
      )}
      {pages > 1 && (
        <Pager
          prevLabel={t('Previous')}
          nextLabel={t('Next')}
          note={t('Page {page} of {pages}', { page, pages })}
          onPrev={page > 1 ? () => setPage(page - 1) : undefined}
          onNext={page < pages ? () => setPage(page + 1) : undefined}
        />
      )}
    </Section>
  );
}
