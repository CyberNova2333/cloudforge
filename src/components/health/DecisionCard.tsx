// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { ClockIcon, PersonIcon } from '@primer/octicons-react';
import { useApprovalPages } from '@/lib/approvals/approvals';
import { decisionCopy, pickDecision } from '@/lib/repo/health';
import { timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { useAgentDirectory } from '@/components/actions/RunActor';

/** What waits on the owner when there is no finding to show: some pull request needs a person. */
function WaitingCard({ count }: { count: number }) {
  return (
    <div className="hl-ask">
      <span className="hl-ask-icon" aria-hidden="true">
        <PersonIcon size={24} />
      </span>
      <div className="hl-ask-body">
        <span className="hl-ask-from">{t('Waiting for a person')}</span>
        <strong>
          {tn(count, '1 decision needs you', '{n} decisions need you')}
        </strong>
        <p>
          {t(
            'Pull requests here are waiting for someone to approve or answer.'
          )}
        </p>
      </div>
      <Link className="btn primary" to="/approvals">
        {t('Open approvals')}
      </Link>
    </div>
  );
}

/**
 * The decision waiting on the owner, first on the page: the reviewer that asked, its question, the pull request it
 * is on and a button to answer. `waiting` is the report's count; a finding for this repository comes from the
 * Approvals inbox. While that loads there is a placeholder; if it fails, or the waiting item is not a finding, the
 * card says how many wait and links to Approvals. Mounted only when something waits.
 */
export function DecisionSlot({
  fullName,
  waiting,
}: {
  fullName: string;
  waiting: number;
}) {
  const q = useApprovalPages();
  const lookup = useAgentDirectory();
  if (q.isPending)
    return (
      <div
        className="sk sk-block short"
        role="status"
        aria-busy="true"
        aria-label={t('Loading the decision')}
      />
    );
  const row = q.data
    ? pickDecision(
        q.data.pages.flatMap((p) => p.items),
        fullName
      )
    : null;
  if (!row) return <WaitingCard count={waiting} />;

  const copy = decisionCopy(row);
  const agent = lookup(row.agent.username);
  const more = waiting - 1;
  const assignee = row.flag.assignee;
  return (
    <div className="hl-ask-wrap">
      <div className="hl-ask">
        <AgentAvatar
          handle={row.agent.username}
          color={agent.color}
          status="needs"
          size={56}
          label={t('{name}, waiting for you', { name: agent.name })}
        />
        <div className="hl-ask-body">
          <span className="hl-ask-from">{copy.from}</span>
          <strong>{copy.title}</strong>
          {copy.body && <p>{copy.body}</p>}
          <span className="hl-ask-meta">
            <ClockIcon size={14} />
            <span>
              {tx('On {pr}, updated {time}', {
                pr: (
                  <Link to={row.prUrl}>
                    #{row.pull.number} {row.pull.title}
                  </Link>
                ),
                time: timeAgo(row.pull.updatedAt),
              })}
              {assignee &&
                t(' · Assigned to {name}', {
                  name: assignee.name ?? assignee.login,
                })}
            </span>
          </span>
        </div>
        <Link className="btn primary" to={`/approvals/${row.flag.id}`}>
          {row.flag.question ? t('Answer') : t('Decide')}
        </Link>
      </div>
      {more > 0 && (
        <p className="hl-more small">
          <Link to="/approvals">
            {tn(
              more,
              '1 more decision is waiting for you',
              '{n} more decisions are waiting for you'
            )}
          </Link>
        </p>
      )}
    </div>
  );
}
