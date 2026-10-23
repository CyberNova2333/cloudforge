// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChecklistIcon,
  CommentDiscussionIcon,
  FileDiffIcon,
  GitCommitIcon,
  type Icon,
} from '@primer/octicons-react';
import {
  api,
  qk,
  type FileDiff,
  type PullDetail,
  type QueueTarget,
  type RepoDetail,
} from '@/lib/uiApi';
import { useCurrentUser } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { t, tn, tx } from '@/lib/i18n';
import {
  anchoredReviewer,
  earlierEntries,
  reviewEntries,
  timelineSlots,
} from '@/lib/reviewTimeline';
import {
  pullTab,
  queueSpot,
  type PullTab,
  type QueueSpot,
} from '@/lib/pullPage';
import { CommitList } from '@/components/CommitList';
import { DiffTotals, DiffView } from '@/components/DiffView';
import { ChecksBox, useCommitRuns } from '@/components/Checks';
import { LoadError } from '@/components/code/LoadError';
import { useEnter } from '@/components/code/useEnter';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { EmptyState } from '@/components/ui/EmptyState';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePageHead } from '@/components/ui/PageHead';
import { PullHeader } from '@/components/pull/PullHeader';
import {
  ClosedBox,
  MergedBox,
  OpenBox,
  PausedBanner,
} from '@/components/pull/MergeBox';
import {
  ClefRead,
  FixerSection,
  OrderSection,
  WhySection,
} from '@/components/pull/Sections';
import { Conversation } from '@/components/pull/Conversation';
import { PullSide } from '@/components/pull/PullSide';
import { NOT_FOUND_HEAD, NotFound } from './NotFound';

/** How often the page follows work in progress (inventory: 3s while reviewing or resolving, 5s near merging). */
function pollInterval(d: PullDetail | undefined): number | false {
  if (!d) return false;
  // Follow AI resolving a rebase conflict (a rebase run's push pings the page live).
  if (d.rebase?.status === 'resolving') return 3000;
  // Follow the auto-merge review, and the merge it leads to.
  const review = d.review;
  if (
    review &&
    ((review.status !== null &&
      review.status !== 'done' &&
      review.status !== 'failed') ||
      (review.status === null &&
        review.agentsInvited &&
        d.pull.state === 'open') ||
      review.reviewers.some((r) => r.status === 'reviewing'))
  )
    return 3000;
  if (
    review?.autoMerge.state === 'ready' ||
    review?.autoMerge.state === 'waiting'
  )
    return 5000;
  return false;
}

/** The changed files as a list that jumps to each one's diff. */
function FileJump({ files }: { files: FileDiff[] }) {
  return (
    <div className="table-wrap pr-filejump">
      <table className="table">
        <caption className="sr">{t('Changed files')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('File')}</th>
            <th scope="col">{t('Added')}</th>
            <th scope="col">{t('Removed')}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.path}>
              <td className="mono small">
                <a href={`#diff-${encodeURIComponent(f.path)}`}>{f.path}</a>
              </td>
              <td className="mono ds-add">
                {f.binary ? '' : `+${f.additions}`}
              </td>
              <td className="mono ds-del">
                {f.binary ? '' : `−${f.deletions}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Conversation tab: why, order, what Clef read, Fixer, the conversation itself, and the side panels. */
function ConversationTab({
  repo,
  d,
  spot,
  target,
  queue,
  refresh,
}: {
  repo: RepoDetail;
  d: PullDetail;
  spot: QueueSpot | null;
  target: QueueTarget | null;
  queue: { loading: boolean; error: unknown; retry: () => void };
  refresh: () => Promise<unknown>;
}) {
  // CloudForge's events, and each requested agent's review, between the comments they happened between.
  const slots = timelineSlots(
    d.comments,
    d.events,
    d.review ? reviewEntries(d.review.reviewers) : [],
    d.review ? earlierEntries(d.review.earlier) : []
  );
  // "Review the flags" jumps to the first review with a finding for a person, else to the side panel.
  const anchored = anchoredReviewer(slots);
  return (
    <div className="cols pr-cols">
      <div className="col">
        <WhySection repo={repo} d={d} />
        {d.pull.state === 'open' &&
          (queue.error && !target ? (
            <Section title={t('Order')}>
              <div className="panel">
                <QueryError
                  error={queue.error}
                  title={t('The merge queue did not load')}
                  onRetry={queue.retry}
                />
              </div>
            </Section>
          ) : queue.loading ? (
            <Section title={t('Order')}>
              <div
                className="sk sk-line w50"
                role="status"
                aria-label={t('Loading')}
              />
            </Section>
          ) : (
            <OrderSection repo={repo} d={d} spot={spot} target={target} />
          ))}
        <ClefRead repo={repo} d={d} />
        <FixerSection repo={repo} d={d} />
        <Conversation
          repo={repo}
          d={d}
          slots={slots}
          anchored={anchored}
          refresh={refresh}
        />
      </div>
      <PullSide repo={repo} d={d} anchored={anchored} refresh={refresh} />
    </div>
  );
}

/**
 * A pull request (`/:owner/:repo/pull/:number[/:tab]`): what happens next in plain words, why the change exists, the
 * order it lands in, what Clef read and Fixer did, the conversation with each reviewer agent's review, and the
 * developer's tabs (commits, files, checks).
 */
export default function PullView() {
  const repo = useOutletContext<RepoDetail>();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const { number = '', tab: tabParam } = useParams();
  const num = Number(number);
  const tab = pullTab(tabParam);
  const valid = Number.isInteger(num) && num > 0 && tab !== null;
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const q = useQuery({
    queryKey: qk.pull(o, repo.name, num),
    queryFn: () => api.pull(o, repo.name, num),
    enabled: valid,
    refetchInterval: (query) => pollInterval(query.state.data),
  });
  const d = q.data;
  const open = d?.pull.state === 'open';
  const queue = useQuery({
    queryKey: qk.queue(o, repo.name),
    queryFn: () => api.queue(o, repo.name),
    enabled: open,
  });
  const commits = useQuery({
    queryKey: qk.pullCommits(o, repo.name, num),
    queryFn: () => api.pullCommits(o, repo.name, num),
    enabled: valid && tab === 'commits',
  });
  const files = useQuery({
    queryKey: qk.pullFiles(o, repo.name, num),
    queryFn: () => api.pullFiles(o, repo.name, num),
    enabled: valid && tab === 'files',
  });
  // The head commit's checks: the side panel follows them while open; the Checks tab on any pull request.
  const checks = useCommitRuns(
    repo,
    open || tab === 'checks' ? d?.headSha : null
  );
  const missing =
    !valid || (q.error instanceof ApiError && q.error.status === 404);
  const entering = useEnter(!!d);
  usePageHead(
    missing
      ? NOT_FOUND_HEAD
      : {
          icon: 'pull',
          crumbs: [
            { label: t('Pull requests'), to: `${base}/pulls` },
            { label: `#${num}` },
          ],
          title: `#${num}`,
          tab: 'pulls',
          documentTitle: d ? `${d.pull.title} · #${num}` : `#${num}`,
        }
  );
  if (missing) return <NotFound />;
  if (q.isError && !d)
    return (
      <LoadError
        what={t('this pull request')}
        error={q.error}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  if (!d || !tab) return <Skeleton kind="detail" />;
  const pr = d.pull;
  // Resolves once the pull request itself has reloaded, so callers can show the new state.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.repo(o, repo.name) });
    void qc.invalidateQueries({ queryKey: ['repo', o, repo.name, 'pulls'] });
    // Approving or merging changes the Approvals list and an agent's profile (its recent reviews).
    void qc.invalidateQueries({ queryKey: qk.approvals });
    void qc.invalidateQueries({ queryKey: ['namespace'] });
    return qc.invalidateQueries({ queryKey: qk.pull(o, repo.name, num) });
  };
  const canEdit = d.canMerge || pr.author.id === me?.id;
  const paused = queue.data?.find((qt) => qt.paused)?.paused ?? null;
  const spot = queueSpot(queue.data, num);
  const target = spot
    ? (queue.data?.find((qt) => qt.target === spot.target) ?? null)
    : null;
  const tabs: { id: PullTab; label: string; icon: Icon; count?: number }[] = [
    {
      id: 'conversation',
      label: t('Conversation'),
      icon: CommentDiscussionIcon,
      count: d.comments.length,
    },
    {
      id: 'commits',
      label: t('Commits'),
      icon: GitCommitIcon,
      count: d.commitCount,
    },
    {
      id: 'files',
      label: t('Files changed'),
      icon: FileDiffIcon,
      count: files.data?.length,
    },
    {
      id: 'checks',
      label: t('Checks'),
      icon: ChecklistIcon,
      count: checks.data?.runs.length,
    },
  ];
  const tabHref = (id: PullTab) =>
    `${base}/pull/${num}${id === 'conversation' ? '' : `/${id}`}`;
  return (
    // Route changes start fresh; a new head also clears an open merge confirmation.
    <div key={pr.id} className={`pr-page ${entering}`}>
      <PullHeader repo={repo} d={d} canEdit={canEdit} onSaved={refresh} />
      {open && paused && (
        <PausedBanner repo={repo} paused={paused} onDone={refresh} />
      )}
      {pr.state === 'open' ? (
        <OpenBox
          key={d.headSha}
          repo={repo}
          d={d}
          spot={spot}
          onFilesTab={tab === 'files'}
          onDone={refresh}
        />
      ) : pr.state === 'merged' ? (
        <MergedBox repo={repo} d={d} onDone={refresh} />
      ) : (
        <ClosedBox repo={repo} d={d} canEdit={canEdit} onDone={refresh} />
      )}
      <nav className="pr-tabs" aria-label={t('Pull request')}>
        {tabs.map((tb) => (
          <Link
            key={tb.id}
            to={tabHref(tb.id)}
            aria-current={tab === tb.id ? 'page' : undefined}
          >
            <tb.icon size={16} />
            {tb.label}
            {tb.count !== undefined && (
              <span className="count">{tb.count}</span>
            )}
          </Link>
        ))}
      </nav>
      {tab === 'conversation' && (
        <ConversationTab
          repo={repo}
          d={d}
          spot={spot}
          target={target}
          queue={{
            loading: open && queue.isPending,
            error: queue.error,
            retry: () => void queue.refetch(),
          }}
          refresh={refresh}
        />
      )}
      {tab === 'commits' &&
        (commits.isError && !commits.data ? (
          <div className="panel">
            <QueryError
              error={commits.error}
              title={t('The commits did not load')}
              onRetry={() => void commits.refetch()}
            />
          </div>
        ) : !commits.data ? (
          <RowsSkeleton rows={4} />
        ) : !commits.data.length ? (
          <div className="panel">
            <EmptyState
              picture={<GitCommitIcon size={20} />}
              title={t('No commits to show')}
              body={t('Nothing on {head} is ahead of {base}.', {
                head: pr.headRef,
                base: pr.baseRef,
              })}
            />
          </div>
        ) : (
          <CommitList
            commits={[...commits.data].reverse()}
            base={base}
            repo={repo}
          />
        ))}
      {tab === 'files' &&
        (files.isError && !files.data ? (
          <div className="panel">
            <QueryError
              error={files.error}
              title={t('The changes did not load')}
              onRetry={() => void files.refetch()}
            />
          </div>
        ) : !files.data ? (
          <RowsSkeleton rows={4} />
        ) : (
          <Section
            title={tn(
              files.data.length,
              '{n} file changed',
              '{n} files changed'
            )}
            actions={<DiffTotals files={files.data} />}
          >
            {files.data.length > 1 && <FileJump files={files.data} />}
            <DiffView files={files.data} />
          </Section>
        ))}
      {tab === 'checks' && (
        <Section
          title={t('Checks')}
          actions={
            d.headSha ? (
              <span className="muted small">
                {tx('on {commit}', {
                  commit: (
                    <Link to={`${base}/commit/${d.headSha}`} className="mono">
                      {d.headSha.slice(0, 7)}
                    </Link>
                  ),
                })}
              </span>
            ) : undefined
          }
        >
          <ChecksBox repo={repo} sha={d.headSha} />
        </Section>
      )}
    </div>
  );
}
