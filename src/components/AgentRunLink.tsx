// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HubotIcon } from '@primer/octicons-react';
import { t } from '@/lib/i18n';
import { api, qk, type AgentRunKind, type RepoDetail } from '@/lib/uiApi';

/**
 * Link to a pull request's latest agent run of a kind (Actions → Agent), for its AI sections.
 * Refreshed by live updates; nothing until a run exists.
 */
export function AgentRunLink({
  repo,
  number,
  kind,
  className = 'f6',
  label = t('View run'),
}: {
  repo: RepoDetail;
  number: number;
  kind: AgentRunKind;
  className?: string;
  /** The link's words, where several runs are linked side by side. */
  label?: string;
}) {
  const o = repo.owner.username;
  const q = useQuery({
    queryKey: qk.pullAgentRun(o, repo.name, number, kind),
    queryFn: () =>
      api.agentRuns(o, repo.name, { pull: number, kind, limit: 1 }),
  });
  const latest = q.data?.runs[0];
  if (!latest) return null;
  return (
    <Link
      to={`/${repo.fullName}/actions/agent/${encodeURIComponent(latest.id)}`}
      className={`${className} d-inline-flex flex-items-center`}
      style={{ gap: 4 }}
      title={t('{title}: steps, models, tokens, and decisions', {
        title: latest.title,
      })}
    >
      <HubotIcon size={14} /> {label}
    </Link>
  );
}
