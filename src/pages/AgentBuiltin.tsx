import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClockIcon, GlobeIcon } from '@primer/octicons-react';
import { api, qk } from '@/lib/uiApi';
import { t, tServer, tx } from '@/lib/i18n';
import { agentColor } from '@/lib/agentLook';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useEnter } from '@/components/code/useEnter';
import { LoadError } from '@/components/Notice';
import { CrewIcon } from '@/components/shell/icons';
import { Chip } from '@/components/ui/Chip';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePageHead } from '@/components/ui/PageHead';
import { NOT_FOUND_HEAD, NotFound } from './NotFound';

/** What each built-in agent does, in the words of the pull request's own flow. */
const ABOUT = {
  clef: [
    t(
      'Clef decides which reviewers and which tests a change concerns. It reads a one-line summary of each changed file, asks every invited reviewer’s question about the change, and wakes the ones whose answer is yes with enough probability.'
    ),
    t(
      'When it is unsure, it wakes the reviewer: a reviewer that isn’t needed costs a little; one that is missed costs more.'
    ),
  ],
  fixer: [
    t(
      'Fixer untangles changes that collide. When the target branch moves, it rebases the pull request itself, one commit at a time, and resolves conflicts as it goes.'
    ),
    t(
      'When it can’t combine the changes safely, it hands the pull request back to its author with both intents, rather than guessing.'
    ),
  ],
} as const;

/** Clef or Fixer, at `/agents/clef` and `/agents/fixer`: built into GitOrange, with no account or repository. */
export default function AgentBuiltin() {
  const { id = '' } = useParams();
  const known = id === 'clef' || id === 'fixer' ? id : null;
  const q = useQuery({
    queryKey: qk.agentsBuiltin,
    queryFn: api.agentsBuiltin,
    enabled: !!known,
  });
  const agent = q.data?.find((a) => a.id === known);
  usePageHead(
    !known
      ? NOT_FOUND_HEAD
      : {
          icon: 'crew',
          crumbs: [
            { label: t('Agents'), to: '/agents' },
            { label: agent?.name ?? (known === 'clef' ? 'Clef' : 'Fixer') },
          ],
          title: agent?.name ?? (known === 'clef' ? 'Clef' : 'Fixer'),
        }
  );
  const entering = useEnter(!!agent);
  if (!known) return <NotFound />;
  if (q.isError && !agent)
    return (
      <LoadError
        what={t('this agent')}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  if (!agent) return <Skeleton kind="detail" />;
  const color = agentColor(known);
  return (
    <div className={entering}>
      <div className="profile" style={{ '--agent': color } as CSSProperties}>
        <aside
          className="pf-side"
          aria-label={t('About {name}', { name: agent.name })}
        >
          <div className="pf-portrait">
            <AgentAvatar handle={agent.id} color={color} size={168} />
          </div>
          <h2 className="pf-name">{agent.name}</h2>
          <p className="pf-handle mono">{t('Built in')}</p>
          <p className="pf-badges">
            <Chip tone="info" icon={<CrewIcon size={12} />}>
              {t('Built-in agent')}
            </Chip>
          </p>
          <p className="pf-bio">{tServer(agent.job)}</p>
          <ul className="pf-meta">
            <li>
              <GlobeIcon />
              <span>{t('Works on every repository')}</span>
            </li>
            <li>
              <ClockIcon />
              <span>{t('Numbers cover the last seven days')}</span>
            </li>
          </ul>
        </aside>
        <div className="pf-main">
          <Section title={t('What it does')}>
            <div className="panel pad">
              {ABOUT[known].map((p) => (
                <p key={p}>{p}</p>
              ))}
              <p className="muted small">
                {tx(
                  'Built into GitOrange. It has no account and no instruction repository; reviewers are the agents you can add and change. See {link}.',
                  { link: <Link to="/agents">{t('all agents')}</Link> }
                )}
              </p>
            </div>
          </Section>
          <Section title={t('Last seven days')}>
            <div className="stats">
              {agent.stats.map((s) => (
                <div className="stat" key={s.label}>
                  <b>{s.value}</b>
                  <span>{tServer(s.label)}</span>
                </div>
              ))}
            </div>
            <p className="muted small">
              {t('Counts only repositories you can see.')}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
