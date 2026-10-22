import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileIcon, GitBranchIcon, RepoIcon } from '@primer/octicons-react';
import { api, qk, type Repo, type RepoStats } from '@/lib/uiApi';
import {
  dayLabels,
  flightSegments,
  languageColor,
  pullChip,
  type BoardRow,
  type CrewMember,
} from '@/lib/board';
import { agentColor, agentState, STATE_LOOK } from '@/lib/agentLook';
import { timeAgo } from '@/lib/format';
import { t, tn } from '@/lib/i18n';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Chip } from '@/components/ui/Chip';
import { Spark } from '@/components/ui/Spark';

/** "Private", "Internal", or "Team · internal" (team repositories are always internal), with what that means on hover. */
export function VisChip({
  repo,
}: {
  repo: Pick<Repo, 'visibility' | 'ownerType'>;
}) {
  const team = repo.ownerType === 'team';
  return (
    <span
      className="vis"
      title={
        repo.visibility === 'private'
          ? t('Only you, collaborators, and site admins can see this')
          : t('Every member can see this')
      }
    >
      {team
        ? t('Team · internal')
        : repo.visibility === 'private'
          ? t('Private')
          : t('Internal')}
    </span>
  );
}

/** "In flight": one segment per bucket of open pull requests, with a key (words as well as colour). */
export function FlightBar({ pulls }: { pulls: RepoStats['pulls'] }) {
  const segments = flightSegments(pulls);
  if (!segments.length) return null;
  return (
    <>
      <div
        className="flight-bar"
        role="img"
        aria-label={segments.map((s) => `${s.count} ${s.label}`).join(t(', '))}
      >
        {segments.map((s) => (
          <i
            key={s.key}
            className={`fl-${s.key}`}
            style={{ flex: s.count }}
            title={`${s.count} ${s.label}`}
          />
        ))}
      </div>
      <div className="flight-key">
        {segments.map((s) => (
          <span key={s.key}>
            <i className={`fl-${s.key}`} />
            {s.count} {s.label}
          </span>
        ))}
      </div>
    </>
  );
}

/** A reviewer's avatar as a link to its profile, with its name and state for hover and assistive tech. */
export function CrewAvatar({
  member,
  size,
}: {
  member: CrewMember;
  size: number;
}) {
  const state = STATE_LOOK[agentState(member.status)].label;
  return (
    <Link
      to={`/${member.handle}`}
      title={`${member.name}: ${state}`}
      aria-label={`${member.name}: ${state}`}
    >
      <AgentAvatar
        handle={member.handle}
        color={member.color}
        status={member.status}
        size={size}
      />
    </Link>
  );
}

/** One code repository on the board: what it is, what is in flight, what merged, who reviews it, what needs a look. */
export function CodeRow({ row }: { row: BoardRow }) {
  const { repo } = row;
  const s = repo.stats;
  const chip = pullChip(s.pulls);
  const days = dayLabels(7, Date.now());
  const [owner, name] = repo.fullName.split('/');
  return (
    <li className="board-row">
      <div className="board-id">
        <div className="board-title">
          <Link className="board-name" to={`/${repo.fullName}`}>
            <RepoIcon size={16} />
            <span>
              <span className="mono">{owner}/</span>
              <b>{name}</b>
            </span>
          </Link>
          <VisChip repo={repo} />
        </div>
        {repo.description && <p className="muted">{repo.description}</p>}
        <p className="board-meta">
          {s.language && (
            <span>
              <i
                className="board-lang"
                style={{ '--lc': languageColor(s.language) } as CSSProperties}
              />
              {s.language}
            </span>
          )}
          {s.branchCount !== null && (
            <span>
              <GitBranchIcon />
              {tn(s.branchCount, '{n} branch', '{n} branches')}
            </span>
          )}
          <span>
            {t('Updated {when}', { when: timeAgo(new Date(s.updatedAt)) })}
          </span>
        </p>
        <div className="board-crew">
          {s.agents.map((a) => (
            <CrewAvatar key={a.handle} member={a} size={40} />
          ))}
          <span className="muted small">
            {s.agents.length
              ? tn(s.agents.length, '{n} reviewer', '{n} reviewers')
              : t('No reviewer agents yet')}
          </span>
        </div>
      </div>
      <div className="board-flow">
        <span className="eyebrow">{t('In flight')}</span>
        <b className="board-big">
          {tn(s.pulls.open, '{n} open pull request', '{n} open pull requests')}
        </b>
        <FlightBar pulls={s.pulls} />
      </div>
      <div className="board-week">
        <span className="eyebrow">{t('Merged, last 7 days')}</span>
        <b className="board-big">
          {tn(s.merged7d, '{n} pull request', '{n} pull requests')}
        </b>
        {s.merged7d > 0 && (
          <Spark
            values={s.mergedByDay}
            width={150}
            height={34}
            label={t('Pull requests merged per day, last 7 days')}
            labels={days}
            unit={t(' merged')}
            trend="better"
          />
        )}
        <span className="muted small">
          {s.mergedAutomaticallyPct === null
            ? t('Nothing merged this week')
            : t('{pct}% merged with no merge click', {
                pct: s.mergedAutomaticallyPct,
              })}
        </span>
      </div>
      <div className="board-health">
        <Chip tone={chip.tone}>{chip.label}</Chip>
        {s.pulls.needsPerson > 0 && (
          <Link
            className="small"
            to="/approvals"
            aria-label={t('Decide in Approvals: {repo}', {
              repo: repo.fullName,
            })}
          >
            {t('Decide in Approvals')}
          </Link>
        )}
        <span className="board-actions">
          <Link
            className="btn small primary"
            to={`/${repo.fullName}`}
            aria-label={t('Open {repo}', { repo: repo.fullName })}
          >
            {t('Open')}
          </Link>
        </span>
      </div>
    </li>
  );
}

/** A reviewer agent's instruction repository: the agent, what it reviews and what it has learned. */
export function AgentRow({
  row,
  status,
  repos,
}: {
  row: BoardRow;
  /** What it is doing across the repositories it reviews. */
  status: CrewMember['status'];
  /** The repositories it reviews. */
  repos: string[];
}) {
  const { repo, agent } = row;
  const handle = repo.name;
  const record = useQuery({
    queryKey: qk.agentStats(handle),
    queryFn: () => api.agentStats(handle),
    staleTime: 60_000,
  });
  const r = record.data;
  const color = agentColor(handle, agent?.color);
  const onDuty = repos.length > 0;
  return (
    <li className="board-row" style={{ '--agent': color } as CSSProperties}>
      <div className="board-id board-agent">
        <Link
          to={`/${handle}`}
          aria-label={t('{name}’s profile', { name: agent?.name ?? handle })}
        >
          <AgentAvatar
            handle={handle}
            color={color}
            status={onDuty ? status : 'off'}
            size={56}
          />
        </Link>
        <span>
          <span className="board-title">
            <Link className="board-name" to={`/${repo.fullName}`}>
              <span>
                <span className="mono">{handle}/</span>
                <b>{handle}</b>
              </span>
            </Link>
            <span className="vis">{t('Agent instructions')}</span>
          </span>
          {(agent?.bio || repo.description) && (
            <p className="muted">{agent?.bio || repo.description}</p>
          )}
          <p className="board-meta">
            <span>
              <FileIcon />
              {t('AGENT.md and knowledge/')}
            </span>
            <span>
              {t('Updated {when}', {
                when: timeAgo(new Date(repo.stats.updatedAt)),
              })}
            </span>
          </p>
        </span>
      </div>
      <div className="board-flow">
        <span className="eyebrow">{t('Reviews')}</span>
        {record.isPending ? (
          <>
            <div className="sk sk-line w50" />
            <div className="sk sk-line w60" />
          </>
        ) : r ? (
          <>
            <b className="board-big">
              {tn(r.raised, '{n} finding raised', '{n} findings raised')}
            </b>
            <span className="small">
              {r.keptPct === null
                ? r.raised
                  ? t('None decided yet')
                  : t('No reviews yet')
                : t('{pct}% kept · {n} dismissed', {
                    pct: r.keptPct,
                    n: r.dismissed,
                  })}
            </span>
          </>
        ) : (
          <span className="small muted">
            {t('Its record is not available.')}
          </span>
        )}
        <span className="small muted">
          {repos.length
            ? t('On {repos}', { repos: repos.join(t(', ')) })
            : t('Not on a repository')}
        </span>
      </div>
      <div className="board-week">
        <span className="eyebrow">{t('Learned')}</span>
        {r ? (
          <>
            <b className="board-big">{tn(r.rules, '{n} rule', '{n} rules')}</b>
            <span className="small">
              {r.rules
                ? t('Saved from requests a person dismissed.')
                : t(
                    'Nothing yet. Rules appear when a person dismisses a request.'
                  )}
            </span>
          </>
        ) : (
          record.isPending && <div className="sk sk-line w50" />
        )}
      </div>
      <div className="board-health">
        {onDuty ? (
          <Chip tone="good">{t('On duty')}</Chip>
        ) : (
          <Chip tone="off">{t('Off')}</Chip>
        )}
        <span className="board-actions">
          <Link
            className="btn small"
            to={`/${handle}`}
            aria-label={t('{name}’s profile', { name: agent?.name ?? handle })}
          >
            {t('Profile')}
          </Link>
          <Link
            className="btn small primary"
            to={`/${repo.fullName}`}
            aria-label={t('Open {repo}', { repo: repo.fullName })}
          >
            {t('Open')}
          </Link>
        </span>
      </div>
    </li>
  );
}
