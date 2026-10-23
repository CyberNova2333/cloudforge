// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import type { ReactNode } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GraphIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type RepoDetail,
  type RepoInsights as Insights,
} from '@/lib/uiApi';
import {
  barWidths,
  of,
  parsePeriod,
  pct,
  PERIOD_OPTIONS,
  rangeText,
  span,
} from '@/lib/insights';
import { t, tn } from '@/lib/i18n';
import { AgentAvatar } from '@/components/AgentAvatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { Section } from '@/components/ui/Section';
import { Seg } from '@/components/ui/Seg';
import { QueryError, StatsSkeleton } from '@/components/actions/states';
import { useAgentDirectory } from '@/components/actions/RunActor';

/** A headline number: its value, what it is, and what it is out of. */
function Stat({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
      <span className="ins-detail">{detail}</span>
    </div>
  );
}

/** One line of a panel: what it counts, an optional hint, and the number. */
function Row({
  label,
  hint,
  value,
  children,
}: {
  label: ReactNode;
  hint?: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="ins-row">
      <div className="ins-row-main">
        <span className="ins-label">
          {label}
          {hint && <span className="small muted">{hint}</span>}
        </span>
        <b className="ins-value">{value}</b>
      </div>
      {children}
    </div>
  );
}

/** Merged pull requests split into auto-merged and merged by a person. */
function MergeSplit({ data }: { data: Insights }) {
  const { merged, autoMerged, mergedByPerson } = data.pulls;
  if (!merged) return null;
  return (
    <>
      <span
        className="ins-split"
        role="img"
        aria-label={t('{auto} auto-merged, {person} merged by a person', {
          auto: autoMerged,
          person: mergedByPerson,
        })}
      >
        <span
          className="ins-split-auto"
          style={{ width: `${(autoMerged / merged) * 100}%` }}
        />
        <span
          className="ins-split-person"
          style={{ width: `${(mergedByPerson / merged) * 100}%` }}
        />
      </span>
      <div className="ins-legend small muted">
        <span>
          <i className="ins-key auto" />{' '}
          {t('Auto-merged {n}', { n: autoMerged })}
        </span>
        <span>
          <i className="ins-key person" />{' '}
          {t('By a person {n}', { n: mergedByPerson })}
        </span>
      </div>
    </>
  );
}

function Report({
  data,
  base,
  stale,
}: {
  data: Insights;
  base: string;
  stale: boolean;
}) {
  const { pulls, reviews, flags, resolutions, ci, timeToMerge, learning } =
    data;
  const lookup = useAgentDirectory();
  const ciFinished = ci.succeeded + ci.failed;
  const quiet =
    pulls.opened +
      pulls.merged +
      pulls.openNow +
      reviews.runs +
      flags.raised +
      flags.pendingNow +
      resolutions.attempts +
      learning.length +
      ci.runs ===
    0;
  if (quiet)
    return (
      <div className="panel">
        <EmptyState
          picture={<GraphIcon size={24} />}
          title={t('Nothing happened in this period')}
          body={t(
            'No pull requests, reviews or test runs. Try a longer period.'
          )}
        />
      </div>
    );
  const busiest = Math.max(0, ...flags.byKind.map((f) => f.raised));

  return (
    <div className={stale ? 'ins-report is-stale' : 'ins-report'}>
      <div className="stats">
        <Stat
          value={String(pulls.merged)}
          label={t('pull requests merged')}
          detail={t('{opened} opened · {open} open now', {
            opened: pulls.opened,
            open: pulls.openNow,
          })}
        />
        <Stat
          value={pct(pulls.autoMergeShare)}
          label={t('auto-merged')}
          detail={t('{auto} of {merged} merged', {
            auto: pulls.autoMerged,
            merged: pulls.merged,
          })}
        />
        <Stat
          value={pct(of(reviews.pullsNeedingHuman, reviews.pullsReviewed))}
          label={t('needed a person')}
          detail={t('{needing} of {reviewed} reviewed', {
            needing: reviews.pullsNeedingHuman,
            reviewed: reviews.pullsReviewed,
          })}
        />
        <Stat
          value={pct(ci.passRate)}
          label={t('CI pass rate')}
          detail={t('{passed} of {finished} finished runs', {
            passed: ci.succeeded,
            finished: ciFinished,
          })}
        />
      </div>

      <Section
        title={t('Flags by kind')}
        actions={
          <span className="muted small">
            {t(
              'Findings raised by each reviewer; the darker part a person approved'
            )}
          </span>
        }
      >
        {flags.byKind.length ? (
          <ul className="panel pad ins-bars">
            {flags.byKind.map((f) => {
              const who = lookup(f.key);
              const w = barWidths(f.raised, f.approved, busiest);
              return (
                <li
                  key={f.key}
                  className="ins-bar-row"
                  style={{ '--agent': who.color } as React.CSSProperties}
                >
                  <Link className="ins-agent" to={`/${f.key}`}>
                    <AgentAvatar
                      handle={f.key}
                      color={who.color}
                      status="idle"
                      size={28}
                    />
                    <span className="ins-agent-name">
                      <b>{who.name === f.key ? f.title : who.name}</b>
                      {who.name !== f.key && (
                        <span className="small muted">{f.title}</span>
                      )}
                    </span>
                  </Link>
                  <span className="ins-track" aria-hidden="true">
                    <span className="ins-bar" style={{ width: `${w.raised}%` }}>
                      <span
                        className="ins-bar-in"
                        style={{ width: `${w.approved}%` }}
                      />
                    </span>
                  </span>
                  <span className="ins-val mono">
                    {t('{raised} raised · {approved} approved', {
                      raised: f.raised,
                      approved: f.approved,
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="panel">
            <EmptyState title={t('No flags raised in this period.')} />
          </div>
        )}
      </Section>

      <div className="ins-grid">
        <Section title={t('Pull requests')}>
          <div className="panel ins-rows">
            <Row label={t('Opened')} value={pulls.opened} />
            <Row label={t('Merged')} value={pulls.merged}>
              <MergeSplit data={data} />
            </Row>
            <Row
              label={t('Merged with no one involved')}
              hint={t(
                'Auto-merged, and the review never asked a person anything'
              )}
              value={pulls.mergedHandsOff}
            />
            <Row
              label={t('Merged after human review')}
              hint={t('The review raised at least one flag for a person')}
              value={pulls.mergedAfterHumanReview}
            />
            <Row
              label={t('Closed without merging')}
              value={pulls.closedUnmerged}
            />
            <Row
              label={<Link to={`${base}/pulls`}>{t('Open now')}</Link>}
              value={pulls.openNow}
            />
            <Row
              label={t('Median time to merge')}
              value={span(timeToMerge.all)}
            />
            <Row
              label={t('… when auto-merged')}
              value={span(timeToMerge.auto)}
            />
            <Row
              label={t('… when merged by a person')}
              value={span(timeToMerge.person)}
            />
          </div>
        </Section>

        <Section title={t('Auto-merge review')}>
          <div className="panel ins-rows">
            <Row
              label={t('Reviews run')}
              hint={t('One per head commit')}
              value={reviews.runs}
            />
            <Row
              label={t('Cleared for auto-merge')}
              value={reviews.autoVerdicts}
            />
            <Row label={t('Asked a person')} value={reviews.humanVerdicts} />
            <Row label={t('Failed')} value={reviews.failed} />
            <Row
              label={t('Pull requests that needed human review')}
              value={t('{needing} of {reviewed}', {
                needing: reviews.pullsNeedingHuman,
                reviewed: reviews.pullsReviewed,
              })}
            />
            <Row label={t('Flags raised')} value={flags.raised} />
            <Row label={t('Flags approved')} value={flags.approved} />
            <Row
              label={t('Median time to approval')}
              hint={t('From a flag being raised to a person approving it')}
              value={span(flags.medianTimeToApproval)}
            />
            <Row
              label={
                <Link to="/approvals">{t('Waiting on a person now')}</Link>
              }
              hint={
                flags.pendingNow
                  ? tn(
                      flags.pendingPullsNow,
                      'On {n} open pull request',
                      'On {n} open pull requests'
                    )
                  : undefined
              }
              value={flags.pendingNow}
            />
          </div>
        </Section>

        <Section title={t('Agents learning')}>
          {learning.length ? (
            <div className="table-wrap">
              <table className="table ins-learning">
                <thead>
                  <tr>
                    <th scope="col">{t('Agent')}</th>
                    <th scope="col" className="ins-num">
                      {t('Dismissed')}
                    </th>
                    <th scope="col" className="ins-num">
                      {t('Lessons')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {learning.map((a) => {
                    const who = lookup(a.handle);
                    return (
                      <tr key={a.handle}>
                        <th scope="row">
                          <Link className="ins-agent" to={`/${a.handle}`}>
                            <AgentAvatar
                              handle={a.handle}
                              color={who.color}
                              status="idle"
                              size={28}
                            />
                            <span className="ins-agent-name">
                              <b>
                                {who.name === a.handle
                                  ? `@${a.handle}`
                                  : who.name}
                              </b>
                              {who.name !== a.handle && (
                                <span className="small muted">@{a.handle}</span>
                              )}
                            </span>
                          </Link>
                        </th>
                        <td className="ins-num">
                          <b>{a.dismissed}</b>
                        </td>
                        <td className="ins-num">{a.lessonsCommitted}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel">
              <EmptyState
                title={t('No change requests were dismissed in this period.')}
              />
            </div>
          )}
        </Section>

        <Section
          title={
            <>
              <AgentAvatar handle="fixer" status="idle" size={24} />
              {t('AI conflict resolution')}
            </>
          }
        >
          <div className="panel ins-rows">
            <Row label={t('Attempts')} value={resolutions.attempts} />
            <Row
              label={t('Resolved')}
              hint={t('Proposed a resolution, or it was merged')}
              value={t('{n} ({pct})', {
                n: resolutions.succeeded,
                pct: pct(of(resolutions.succeeded, resolutions.attempts)),
              })}
            />
            <Row
              label={t('Merged with the resolution')}
              value={resolutions.applied}
            />
            <Row label={t('Failed')} value={resolutions.failed} />
            <Row label={t('Discarded')} value={resolutions.rejected} />
            {resolutions.inProgress > 0 && (
              <Row label={t('Running')} value={resolutions.inProgress} />
            )}
            <Row
              label={t('Pull requests with conflicts')}
              value={resolutions.pulls}
            />
          </div>
        </Section>

        <Section title={t('CI on pull requests')}>
          <div className="panel ins-rows">
            <Row
              label={<Link to={`${base}/actions`}>{t('Runs')}</Link>}
              value={ci.runs}
            />
            <Row label={t('Passed')} value={ci.succeeded} />
            <Row label={t('Failed')} value={ci.failed} />
            <Row label={t('Cancelled')} value={ci.cancelled} />
            <Row
              label={t('Pass rate')}
              hint={t('Of runs that passed or failed')}
              value={pct(ci.passRate)}
            />
            <Row
              label={t('Median time to green')}
              hint={t('From opening a pull request to its first passing run')}
              value={span(ci.medianTimeToGreen)}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

export default function RepoInsights() {
  const repo = useOutletContext<RepoDetail>();
  const [params, setParams] = useSearchParams();
  const days = parsePeriod(params.get('days'));
  const o = repo.owner.username;
  const q = useQuery({
    queryKey: qk.insights(o, repo.name, days),
    queryFn: () => api.insights(o, repo.name, days),
    // Keep the last period on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
  const range = rangeText(q.data?.since, q.data?.until);

  return (
    <>
      <PageHead
        icon="graph"
        crumbs={[{ label: t('Insights') }]}
        title={t('Insights')}
        tab="insights"
        lede={
          range
            ? t('How well agents land changes in {repo}. {range}', {
                repo: repo.fullName,
                range,
              })
            : t('How well agents land changes in {repo}.', {
                repo: repo.fullName,
              })
        }
        actions={
          <Seg
            label={t('Period')}
            options={PERIOD_OPTIONS}
            value={String(days)}
            onChange={(v) =>
              setParams(v === '30' ? {} : { days: v }, { replace: true })
            }
          />
        }
      />
      {q.isError && !q.data ? (
        <div className="panel">
          <QueryError
            error={q.error}
            onRetry={() => void q.refetch()}
            title={t('Insights did not load')}
            picture={<GraphIcon size={24} />}
          />
        </div>
      ) : !q.data ? (
        <StatsSkeleton />
      ) : (
        <Report
          data={q.data}
          base={`/${repo.fullName}`}
          stale={q.isPlaceholderData}
        />
      )}
    </>
  );
}
