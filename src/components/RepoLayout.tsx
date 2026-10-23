// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RepoIcon } from '@primer/octicons-react';
import { api, qk, type RepoDetail } from '@/lib/uiApi';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLiveRepo } from '@/lib/live';
import { repoBand, repoRest, repoTabOf, repoTabs } from '@/lib/repoNav';
import {
  PageHeadContext,
  usePageHead,
  type PageHeadInfo,
} from '@/components/ui/PageHead';
import { useForgetRepo, useShellRepo } from '@/components/shell/AppShell';
import { PageIcon } from '@/components/shell/icons';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Spinner } from './Spinner';
import { NOT_FOUND_HEAD, NotFound } from '@/pages/NotFound';

export function useRepoParams() {
  const { owner = '', repo = '' } = useParams();
  return { owner, repo };
}

/** The path after `/:owner/:repo/<section>/` (useParams()['*'] clashes with the outer route). */
export function useRepoSubPath(section: string) {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (parts[2] !== section) return '';
  return decodeURIComponent(parts.slice(3).join('/'));
}

export function useRepo() {
  const { owner, repo } = useRepoParams();
  return useQuery({
    queryKey: qk.repo(owner, repo),
    queryFn: () => api.repo(owner, repo),
  });
}

/**
 * The agent whose instructions live in `<handle>/<handle>`, if this is such a repository. Agent repositories
 * always have the owner's name, so other repositories never load the agent list.
 */
export function useRepoAgent(owner: string, repo: string) {
  const isCandidate = owner.toLowerCase() === repo.toLowerCase();
  const agents = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    enabled: isCandidate,
  });
  if (!isCandidate) return null;
  return (
    agents.data?.find(
      (a) => a.username.toLowerCase() === owner.toLowerCase()
    ) ?? null
  );
}

const VISIBILITY_TITLE = {
  private: t('Only you, collaborators, and site admins can see this'),
  internal: t('Every member can see this'),
  public: t('Anyone can see this, even without an account'),
} as const;

const VISIBILITY_TEXT = {
  private: t('Private'),
  internal: t('Internal'),
  public: t('Public'),
} as const;

/**
 * Every repository page: the repository header and its tabs at the top of the work panel, the repository in the
 * top band's trail, and the loaded `RepoDetail` for the page (Outlet context). Pages name themselves with
 * `usePageHead` (crumbs relative to the repository); until they do, the trail comes from the URL (`repoBand`).
 */
export function RepoLayout() {
  const { owner, repo } = useRepoParams();
  const q = useRepo();
  const data = q.data;
  // Subscribe only once the user is known to have access.
  useLiveRepo(data ? owner : '', data ? repo : '');
  const agent = useRepoAgent(owner, repo);
  const { pathname } = useLocation();
  const base = `/${owner}/${repo}`;
  const rest = repoRest(pathname);
  const isAgentRepo = !!agent;

  const missing = q.error instanceof ApiError && q.error.status === 404;

  // What the page published (null: it hasn't, so the trail comes from the URL).
  const [pageHead, setPageHead] = useState<PageHeadInfo | null>(null);
  const fallback = repoBand(rest, base, isAgentRepo);
  const own: PageHeadInfo = pageHead ?? fallback;
  const activeTab = pageHead?.tab ?? repoTabOf(rest, isAgentRepo);
  usePageHead(
    missing
      ? NOT_FOUND_HEAD
      : {
          icon: own.icon ?? fallback.icon,
          crumbs: [
            { label: owner, to: `/${owner}` },
            { label: repo, to: base },
            ...own.crumbs,
          ],
          title: own.title,
          tab: activeTab,
          documentTitle: `${own.documentTitle ?? own.title} · ${owner}/${repo}`,
        }
  );

  const shellRepo = useMemo(
    () =>
      data
        ? {
            fullName: data.fullName,
            defaultBranch: data.defaultBranch,
            branches: data.branches.map((b) => b.name),
            admin: data.permissions.admin,
            agent: agent
              ? {
                  handle: agent.username,
                  color: agent.color,
                }
              : null,
          }
        : null,
    [data, agent]
  );
  useShellRepo(shellRepo);

  const forget = useForgetRepo();
  useEffect(() => {
    if (missing) forget(`${owner}/${repo}`);
  }, [missing, forget, owner, repo]);

  if (missing) return <NotFound />;

  const tabs = repoTabs(isAgentRepo, !!data?.permissions.admin);
  return (
    <>
      <div className="rhead">
        <div className="rhead-row">
          <span className="rhead-name">
            {agent ? (
              <AgentAvatar
                handle={agent.username}
                // Sent since crew redesign B1; typed in uiApi by C0.
                color={(agent as { color?: string | null }).color}
                size={28}
                label={t('{name}, a reviewer agent', { name: agent.name })}
              />
            ) : (
              <RepoIcon />
            )}
            <Link to={`/${owner}`}>{owner}</Link>
            <span className="sep">/</span>
            <Link to={base}>
              <b>{repo}</b>
            </Link>
          </span>
          {data && (
            <span className="vis" title={VISIBILITY_TITLE[data.visibility]}>
              {VISIBILITY_TEXT[data.visibility]}
            </span>
          )}
          {agent && (
            <>
              <span className="vis">{t('Agent instructions')}</span>
              <Link className="rhead-link" to={`/${agent.username}`}>
                {t('{name}’s profile', { name: agent.name })}
              </Link>
            </>
          )}
        </div>
        <nav className="rtabs" aria-label={t('Repository')}>
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              to={tab.path ? `${base}/${tab.path}` : base}
              aria-current={tab.id === activeTab ? 'page' : undefined}
            >
              <PageIcon name={tab.icon} />
              {tab.label}
              {tab.id === 'pulls' && !!data?.openPullCount && (
                <span className="count">{data.openPullCount}</span>
              )}
            </Link>
          ))}
        </nav>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <PageHeadContext.Provider value={setPageHead}>
          <Outlet context={data satisfies RepoDetail} />
        </PageHeadContext.Provider>
      )}
    </>
  );
}
