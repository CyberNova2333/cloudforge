import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CommentIcon,
  IssueOpenedIcon,
  SearchIcon,
  TagIcon,
} from '@primer/octicons-react';
import { api, qk, type Issue, type RepoDetail } from '@/lib/api/uiApi';
import { useCurrentUser } from '@/lib/auth/auth';
import { timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import {
  ISSUES_PAGE_SIZE,
  issuesHref,
  parseIssuesView,
  type IssuesParams,
} from '@/lib/issues/issuesView';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/actions/parts';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { Avatar } from '@/components/ui/Avatar';
import { IssueStateIcon, LabelChip } from '@/components/issue/IssueParts';

function Row({ issue, base }: { issue: Issue; base: string }) {
  const author = (
    <Link to={`/${issue.author.username}`} className="prow-author">
      {issue.author.username}
    </Link>
  );
  return (
    <li className="prow">
      <span className="prow-icon">
        <IssueStateIcon issue={issue} />
      </span>
      <div className="prow-main">
        <div className="prow-title">
          <Link to={`${base}/issues/${issue.number}`} className="prow-open">
            {issue.title}
          </Link>
          {issue.labels.map((l) => (
            <Link
              key={l.id}
              to={issuesHref(base, { label: l.name })}
              className="label-link"
            >
              <LabelChip label={l} />
            </Link>
          ))}
        </div>
        <div className="prow-meta">
          <span className="mono">#{issue.number}</span>
          <span>
            {issue.state === 'open'
              ? tx('opened {when} by {author}', {
                  when: timeAgo(issue.createdAt),
                  author,
                })
              : tx('by {author} was closed {when}', {
                  author,
                  when: timeAgo(issue.closedAt ?? issue.updatedAt),
                })}
          </span>
        </div>
      </div>
      <div className="prow-side">
        {!!issue.assignees.length && (
          <span
            className="issue-assignees"
            aria-label={t('Assigned to {people}', {
              people: issue.assignees.map((u) => u.username).join(', '),
            })}
          >
            {issue.assignees.slice(0, 3).map((u) => (
              <Avatar key={u.id} user={u} size={20} />
            ))}
          </span>
        )}
        {issue.commentCount > 0 && (
          <Link
            to={`${base}/issues/${issue.number}`}
            className="prow-comments muted"
            aria-label={tn(issue.commentCount, '{n} comment', '{n} comments')}
          >
            <CommentIcon size={14} />
            {issue.commentCount}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * A repository's issues: open or closed (`?state=`), filtered by label (`?label=`) and assignee (`?assignee=`, a
 * username or `none`), searched (`?q=`) and paged (`?page=`) on the server.
 */
export default function Issues() {
  const repo = useOutletContext<RepoDetail>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const params = parseIssuesView(search);
  const { state, q, label, assignee, page } = params;
  const query = useQuery({
    queryKey: qk.issues(o, repo.name, { state, q, label, assignee, page }),
    queryFn: () =>
      api.issues(o, repo.name, {
        state,
        q,
        label,
        assignee,
        page,
        limit: ISSUES_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const labels = useQuery({
    queryKey: qk.labels(o, repo.name),
    queryFn: () => api.labels(o, repo.name),
  });
  const go = (next: Partial<IssuesParams>, replace = false) =>
    navigate(issuesHref(base, { ...params, ...next }), { replace });

  // The box keeps what was typed; the address follows once typing pauses.
  const [draft, setDraft] = useState(q);
  useEffect(() => {
    setDraft((d) => (d.trim() === q ? d : q));
  }, [q]);
  const typing = useRef<number>();
  useEffect(() => () => window.clearTimeout(typing.current), []);
  const onSearch = (text: string) => {
    setDraft(text);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(
      () => go({ q: text, page: 1 }, true),
      250
    );
  };

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ISSUES_PAGE_SIZE));
  const filtered = !!(q || label || assignee);
  const tab = (to: IssuesParams['state'], text: string, n?: number) => (
    <Link
      to={issuesHref(base, { ...params, state: to, page: 1 })}
      className="pl-tab"
      aria-current={state === to ? 'page' : undefined}
    >
      {text}
      {n !== undefined && <span className="count">{n}</span>}
    </Link>
  );

  let body;
  if (query.isError && !query.data)
    body = (
      <div className="panel">
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          title={t('Issues did not load')}
        />
      </div>
    );
  else if (!query.data) body = <RowsSkeleton />;
  else if (!query.data.issues.length)
    body = (
      <div className="panel">
        <EmptyState
          picture={<IssueOpenedIcon size={24} />}
          title={
            filtered
              ? t('No issues match these filters')
              : state === 'closed'
                ? t("There aren't any closed issues.")
                : t("There aren't any open issues.")
          }
          body={
            filtered ? (
              <Link to={issuesHref(base, { state })}>
                {t('Clear the filters')}
              </Link>
            ) : me ? (
              t(
                'Issues track bugs, ideas and work to do. Write “Fixes #12” in a pull request to close issue 12 when it merges.'
              )
            ) : undefined
          }
        />
      </div>
    );
  else
    body = (
      <>
        <ul className="prows panel">
          {query.data.issues.map((i) => (
            <Row key={i.id} issue={i} base={base} />
          ))}
        </ul>
        {pages > 1 && (
          <Pager
            prevLabel={t('Previous')}
            nextLabel={t('Next')}
            onPrev={page > 1 ? () => go({ page: page - 1 }) : undefined}
            onNext={page < pages ? () => go({ page: page + 1 }) : undefined}
            note={t('Page {page} of {pages} · {total} issues', {
              page,
              pages,
              total,
            })}
          />
        )}
      </>
    );

  return (
    <>
      <PageHead
        icon="issue"
        crumbs={[{ label: t('Issues') }]}
        title={t('Issues')}
        tab="issues"
        lede={t('Bugs, ideas and work to do in this repository.')}
        actions={
          <>
            <Link to={`${base}/labels`} className="btn">
              <TagIcon size={14} />
              {t('Labels')}
            </Link>
            {me && (
              <Link to={`${base}/issues/new`} className="btn primary">
                {t('New issue')}
              </Link>
            )}
          </>
        }
      />
      <div className="plist">
        <div className="pl-bar">
          <nav className="pl-tabs" aria-label={t('Issue state')}>
            {tab('open', t('Open'), query.data?.openCount)}
            {tab('closed', t('Closed'), query.data?.closedCount)}
            {tab('all', t('All'))}
          </nav>
          <div className="pl-tools">
            <select
              className="pl-select"
              aria-label={t('Filter by label')}
              value={label}
              onChange={(e) => go({ label: e.target.value, page: 1 })}
            >
              <option value="">{t('Any label')}</option>
              {(labels.data ?? []).map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
              {label && !(labels.data ?? []).some((l) => l.name === label) && (
                <option value={label}>{label}</option>
              )}
            </select>
            <select
              className="pl-select"
              aria-label={t('Filter by assignee')}
              value={assignee}
              onChange={(e) => go({ assignee: e.target.value, page: 1 })}
            >
              <option value="">{t('Anyone')}</option>
              {me?.username && (
                <option value={me.username}>{t('Assigned to me')}</option>
              )}
              <option value="none">{t('Nobody')}</option>
              {assignee && assignee !== 'none' && assignee !== me?.username && (
                <option value={assignee}>{assignee}</option>
              )}
            </select>
            <label className="pl-search">
              <SearchIcon size={14} />
              <input
                type="search"
                value={draft}
                placeholder={t('Search issues')}
                aria-label={t('Search issues')}
                onChange={(e) => onSearch(e.target.value)}
              />
            </label>
          </div>
        </div>
        {body}
      </div>
    </>
  );
}
