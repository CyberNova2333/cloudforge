import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ClockIcon,
  CpuIcon,
  RepoIcon,
  ShieldIcon,
  ZapIcon,
} from '@primer/octicons-react';
import { api, qk, type Namespace } from '@/lib/uiApi';
import { fullDate, timeAgo } from '@/lib/format';
import { t, tx } from '@/lib/i18n';
import {
  avatarStatusOf,
  engineText,
  overallStatus,
  parseProfileTab,
  PROFILE_TABS,
  wakeText,
  type ProfileTab,
} from '@/lib/agentPage';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentReadme } from '@/components/agents/AgentReadme';
import { AgentRecord } from '@/components/agents/AgentRecord';
import { ConfigTab, ReviewsTab, RulesTab } from '@/components/agents/AgentTabs';
import { WhereItReviews } from '@/components/agents/WhereItReviews';
import { Notice } from '@/components/Notice';
import { CrewIcon } from '@/components/shell/icons';
import { Chip } from '@/components/ui/Chip';

const TAB_LABEL: Record<ProfileTab, string> = {
  overview: t('Overview'),
  reviews: t('Reviews'),
  rules: t('Rules learned'),
  config: t('Configuration'),
};

/**
 * A reviewer agent's profile, at `/<handle>`: a portrait and the facts beside it, then Overview (where it
 * reviews, its AGENT.md, its record and activity), Reviews, Rules learned and Configuration. The tab is in the
 * address (`?tab=reviews`).
 */
export default function AgentProfile({
  agent,
  repositories,
}: {
  agent: NonNullable<Namespace['agent']>;
  repositories: Namespace['repositories'];
}) {
  const handle = agent.username;
  const [params] = useSearchParams();
  const tab = parseProfileTab(params.get('tab'));
  const stats = useQuery({
    queryKey: qk.agentStats(handle),
    queryFn: () => api.agentStats(handle),
  });

  const onRepos = agent.invitedTo.length;
  // What it is doing is known once its record has loaded; an agent on no repository is simply asleep.
  const known = stats.isSuccess || onRepos === 0;
  const status = avatarStatusOf({
    deleted: !!agent.deletedAt,
    repos: onRepos,
    status: overallStatus(stats.data?.repos ?? []),
  });
  // The branch AGENT.md is read from: its repository is the agent's own, so it is in the namespace's list.
  const branch =
    repositories.find(
      (r) => r.fullName.toLowerCase() === agent.repository?.toLowerCase()
    )?.defaultBranch ?? 'main';
  // The tab lists hold only the newest ten; the badges are the record's totals, so they appear once it loads.
  const counts: Partial<Record<ProfileTab, number>> = {
    reviews: stats.data?.reviews,
    rules: stats.data?.rules,
  };

  return (
    <div
      className="profile"
      style={{ '--agent': agent.color } as CSSProperties}
    >
      <aside
        className="pf-side"
        aria-label={t('About {name}', { name: agent.name })}
      >
        <div className="pf-portrait">
          <AgentAvatar
            handle={handle}
            color={agent.color}
            status={status}
            size={168}
          />
        </div>
        <h2 className="pf-name">{agent.name}</h2>
        <p className="pf-handle mono">@{handle}</p>
        <p className="pf-badges">
          <Chip
            tone={agent.deletedAt ? 'off' : 'info'}
            icon={<CrewIcon size={12} />}
          >
            {agent.deletedAt ? t('Deleted agent') : t('Reviewer agent')}
          </Chip>
          {known && !agent.deletedAt && (
            <Chip status={status}>
              {status === 'off' ? t('Not on a repository') : undefined}
            </Chip>
          )}
          {agent.guarded && (
            <Chip
              tone="warn"
              icon={<ShieldIcon size={12} />}
              title={t(
                'Its findings are never approved in bulk or by GitOrange AI, and approving one needs a reason'
              )}
            >
              {t('Guarded')}
            </Chip>
          )}
        </p>
        {agent.bio && <p className="pf-bio">{agent.bio}</p>}
        <ul className="pf-meta">
          <li>
            <RepoIcon />
            {agent.repository ? (
              <span>
                {tx('Defined in {repo}', {
                  repo: (
                    <Link className="mono" to={`/${agent.repository}`}>
                      {agent.repository}
                    </Link>
                  ),
                })}
              </span>
            ) : (
              <span>
                {t('Its repository was deleted, or you can’t read it')}
              </span>
            )}
          </li>
          <li>
            <ZapIcon />
            <span>{wakeText(agent.trigger)}</span>
          </li>
          <li>
            <CpuIcon />
            <span>{engineText(agent.engine)}</span>
          </li>
          <li>
            <ClockIcon />
            <span title={fullDate(agent.createdAt)}>
              {t('Joined {when}', { when: timeAgo(agent.createdAt) })}
            </span>
          </li>
        </ul>
      </aside>

      <div className="pf-main">
        <nav
          className="subtabs"
          aria-label={t('{name} sections', { name: agent.name })}
        >
          {PROFILE_TABS.map((tabKey) => (
            <Link
              key={tabKey}
              to={{ search: tabKey === 'overview' ? '' : `?tab=${tabKey}` }}
              aria-current={tabKey === tab ? 'page' : undefined}
            >
              {TAB_LABEL[tabKey]}
              {counts[tabKey] !== undefined && (
                <span className="count">{counts[tabKey]}</span>
              )}
            </Link>
          ))}
        </nav>

        {agent.deletedAt && (
          <Notice tone="warn">
            {t(
              'This agent was deleted. It is off every repository, and its past reviews keep its name.'
            )}
          </Notice>
        )}
        {agent.configError && (
          <Notice tone="warn">
            {t(
              'AGENT.md has an error, so this shows its last valid version: {error}',
              { error: agent.configError }
            )}
          </Notice>
        )}

        {tab === 'overview' && (
          <>
            <WhereItReviews agent={agent} stats={stats.data} />
            <AgentReadme
              repository={agent.repository}
              branch={branch}
              fallback={agent.bio}
            />
            <AgentRecord stats={stats} color={agent.color} />
          </>
        )}
        {tab === 'reviews' && (
          <ReviewsTab agent={agent} total={stats.data?.reviews} />
        )}
        {tab === 'rules' && (
          <RulesTab agent={agent} rules={stats.data?.rules} />
        )}
        {tab === 'config' && <ConfigTab agent={agent} branch={branch} />}
      </div>
    </div>
  );
}
