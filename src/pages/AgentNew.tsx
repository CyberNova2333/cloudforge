import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type Agent,
  type AgentPreset,
  type CrewResult,
  type PresetFacet,
} from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { t, tn, tx } from '@/lib/i18n';
import {
  crewResultText,
  engineText,
  handleProblem,
  listNames,
  presetState,
  wakeText,
} from '@/lib/agentPage';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Avatar } from '@/components/Avatar';
import { AgentCard } from '@/components/agents/AgentCard';
import { useEnter } from '@/components/code/useEnter';
import { LoadError, Notice } from '@/components/Notice';
import { Chip } from '@/components/ui/Chip';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { Section } from '@/components/ui/Section';
import { useToast } from '@/components/ui/Toast';
import { agentColor } from '@/lib/agentLook';

/** What follows creating an agent: its lists, records and presets are stale, and so are the repositories. */
function useRefreshAgents() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.agents }),
      qc.invalidateQueries({ queryKey: qk.repos }),
    ]);
}

/** A preset's card: what the reviewer is for, what it looks at, and (for an admin) a button to create it. */
function PresetCard({
  preset,
  admin,
  handles,
}: {
  preset: AgentPreset;
  admin: boolean;
  handles: ReadonlySet<string>;
}) {
  const refresh = useRefreshAgents();
  const toast = useToast();
  const state = presetState(preset, handles);
  const create = useMutation({
    // A preset's facet is never `other`: those are the seven presets.
    mutationFn: () => api.createAgent({ preset: preset.facet as PresetFacet }),
    onSuccess: async ({ agent }) => {
      await refresh();
      toast(
        t('Created @{handle}. Add it to a repository to start.', {
          handle: agent.username,
        })
      );
    },
  });
  return (
    <div id={`preset-${preset.facet}`} className="preset">
      <AgentCard
        handle={preset.handle}
        color={preset.color}
        name={preset.name}
        subtitle={`@${preset.handle}`}
        bio={preset.bio}
        status={state === 'created' ? 'idle' : 'off'}
        foot={
          <>
            {state === 'created' && <Chip tone="good">{t('Created')}</Chip>}
            {preset.recommended && <Chip tone="info">{t('Recommended')}</Chip>}
            {preset.guarded && (
              <Chip
                tone="warn"
                icon={<ShieldIcon size={12} />}
                title={t(
                  'Its findings are never approved in bulk or by CloudForge AI, and approving one needs a reason'
                )}
              >
                {t('Guarded')}
              </Chip>
            )}
          </>
        }
      >
        <div className="acard-ask">
          <b>{t('What it looks at')}</b>
          {t('Clef asks: {ask}', { ask: preset.triggerAsk })}
        </div>
        <span className="muted small">
          {t('{wake}. {engine}.', {
            wake: wakeText({ above: preset.triggerAbove }),
            engine: engineText(preset.engine),
          })}
        </span>
        <div className="acard-actions">
          {state === 'created' ? (
            <Link className="btn small" to={`/${preset.handle}`}>
              {t('Open profile')}
            </Link>
          ) : state === 'taken' ? (
            <span className="muted small">
              {t('Someone else already uses the handle @{handle}.', {
                handle: preset.handle,
              })}
            </span>
          ) : admin ? (
            <PendingButton
              className="small primary"
              pending={create.isPending}
              pendingLabel={t('Creating…')}
              error={create.isError ? errorMessage(create.error) : null}
              onClick={() => create.mutate()}
            >
              {t('Create {name}', { name: preset.name })}
            </PendingButton>
          ) : (
            <span className="muted small">
              {t('A site admin can create this reviewer.')}
            </span>
          )}
        </div>
      </AgentCard>
    </div>
  );
}

/** "Add the recommended crew": every recommended preset that is not there yet, in one step. */
function CrewPanel({
  presets,
  handles,
}: {
  presets: AgentPreset[];
  handles: ReadonlySet<string>;
}) {
  const refresh = useRefreshAgents();
  const [result, setResult] = useState<CrewResult | null>(null);
  const crew = presets.filter((p) => p.recommended);
  const missing = crew.filter((p) => presetState(p, handles) === 'create');
  const add = useMutation({
    mutationFn: api.createAgentCrew,
    onSuccess: async (r) => {
      setResult(r);
      await refresh();
    },
  });
  const text = result ? crewResultText(result) : null;
  return (
    <>
      <div className="panel ag-crew">
        <div className="ag-crew-faces">
          {crew.map((p) => (
            <AgentAvatar
              key={p.facet}
              handle={p.handle}
              color={p.color}
              status={presetState(p, handles) === 'create' ? 'off' : 'idle'}
              size={40}
            />
          ))}
        </div>
        <div className="ag-crew-text">
          <b>
            {missing.length === 0
              ? t('The recommended crew is all here')
              : missing.length === crew.length
                ? t('Start with the recommended crew')
                : tn(
                    missing.length,
                    '{n} of the recommended crew is missing',
                    '{n} of the recommended crew are missing'
                  )}
          </b>
          <span className="muted small">
            {missing.length === 0
              ? t(
                  'Every recommended reviewer already exists. Invite them to a repository from their profiles.'
                )
              : t(
                  'Adds {names}, each with its own repository of instructions. Run it again later and it adds only the ones still missing.',
                  { names: listNames(missing.map((p) => p.name)) }
                )}
          </span>
        </div>
        {missing.length > 0 && (
          <PendingButton
            className="primary"
            pending={add.isPending}
            pendingLabel={t('Adding…')}
            error={add.isError ? errorMessage(add.error) : null}
            onClick={() => add.mutate()}
          >
            {t('Add the recommended crew')}
          </PendingButton>
        )}
        {missing.length === 0 && (
          <Link className="btn" to="/agents">
            {t('See the agents')}
          </Link>
        )}
      </div>
      {text && (
        <Notice tone={text.added ? 'ok' : 'info'}>
          {text.added ?? t('Nothing was added.')}
          {text.skipped.length > 0 && (
            <>
              {' '}
              {t('Skipped: {list}.', {
                list: text.skipped.join(t('; ')),
              })}
            </>
          )}{' '}
          {text.added && (
            <Link to="/agents">{t('See them on the Agents page.')}</Link>
          )}
        </Notice>
      )}
    </>
  );
}

/** "Start blank": a handle and a name; the agent starts with a general reviewer's AGENT.md to edit. */
function BlankForm() {
  const refresh = useRefreshAgents();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [made, setMade] = useState<Agent | null>(null);
  const problem = handle ? handleProblem(handle) : null;
  const create = useMutation({
    mutationFn: () => api.createAgent({ handle, name: name.trim() }),
    onSuccess: async ({ agent }) => {
      setMade(agent);
      setHandle('');
      setName('');
      await refresh();
    },
  });
  // AGENT.md lives on its repository's default branch; until that is known the link goes to the repository.
  const [madeOwner = '', madeName = ''] = (made?.repository ?? '').split('/');
  const madeRepo = useQuery({
    queryKey: qk.repo(madeOwner, madeName),
    queryFn: () => api.repo(madeOwner, madeName),
    enabled: !!made?.repository,
  });
  const shown = handle || 'handle';
  return (
    <>
      {made && (
        <Notice tone="ok">
          {tx(
            'Created {agent}. Edit AGENT.md in {repo} to say what it reviews, then invite it to a repository.',
            {
              agent: <Link to={`/${made.username}`}>@{made.username}</Link>,
              repo: made.repository ? (
                <Link
                  to={
                    madeRepo.data
                      ? `/${made.repository}/blob/${madeRepo.data.defaultBranch}/AGENT.md`
                      : `/${made.repository}`
                  }
                  className="mono"
                >
                  {made.repository}
                </Link>
              ) : (
                t('its repository')
              ),
            }
          )}
        </Notice>
      )}
      <div className="panel ag-blank">
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            setMade(null);
            create.mutate();
          }}
        >
          <div className="fld">
            <label htmlFor="blank-handle">{t('Handle')}</label>
            <input
              id="blank-handle"
              className="form-control input-monospace"
              required
              maxLength={39}
              placeholder="accessibilityagent"
              value={handle}
              aria-invalid={!!problem}
              aria-describedby="blank-handle-hint"
              onChange={(e) => setHandle(e.target.value.trim())}
            />
            <span
              id="blank-handle-hint"
              className={`hint${problem ? ' attention' : ''}`}
            >
              {problem ?? t('Its username, and the name of its repository.')}
            </span>
          </div>
          <div className="fld">
            <label htmlFor="blank-name">{t('Display name')}</label>
            <input
              id="blank-name"
              className="form-control"
              required
              maxLength={100}
              placeholder="Accessibility"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="small muted">
            {tx(
              'Creates {agent} and its repository {repo} with a starter AGENT.md (a general correctness reviewer), an avatar and a knowledge folder. You become a collaborator on it.',
              {
                agent: `@${shown}`,
                repo: (
                  <code>
                    {shown}/{shown}
                  </code>
                ),
              }
            )}
          </p>
          <div>
            <PendingButton
              type="submit"
              className="primary"
              pending={create.isPending}
              pendingLabel={t('Creating…')}
              disabled={!handle || !name.trim() || !!problem}
              error={create.isError ? errorMessage(create.error) : null}
            >
              {t('Create reviewer')}
            </PendingButton>
          </div>
        </form>
        <div className="ag-blank-side">
          <div className="ag-blank-id">
            <AgentAvatar
              handle={handle || 'reviewer'}
              color={agentColor(handle || 'reviewer')}
              size={72}
            />
            <span>
              <b>{name.trim() || t('New reviewer')}</b>
              <span className="mono muted small">@{shown}</span>
            </span>
          </div>
          <p className="small muted">
            {t(
              'Its colour comes from its handle until AGENT.md names one. Changes to its instructions are pull requests like any other.'
            )}
          </p>
        </div>
      </div>
    </>
  );
}

/** Who to ask when you can't add a reviewer yourself. */
function WhoCanAdd() {
  const members = useQuery({ queryKey: qk.members, queryFn: api.members });
  const admins = (members.data ?? []).filter((m) => m.role === 'admin');
  return (
    <Section title={t('Who can add reviewers')}>
      <div className="panel pad">
        <p>
          {t(
            'Only site admins can create reviewers. Ask one of them to add the reviewer you need; once it exists you can read its profile here.'
          )}
        </p>
        {members.isError ? (
          <LoadError
            what={t('the site admins')}
            error={members.error}
            onRetry={() => void members.refetch()}
          />
        ) : !members.data ? (
          <div
            className="sk-rows"
            role="status"
            aria-busy="true"
            aria-label={t('Loading')}
          >
            <div className="sk sk-row" />
          </div>
        ) : admins.length === 0 ? (
          <p className="muted small">{t('No site admin was found.')}</p>
        ) : (
          <ul className="ag-admins">
            {admins.map((m) => (
              <li key={m.id}>
                <Avatar user={m} size={32} />
                <span>
                  <Link to={`/${m.username}`}>
                    <b>{m.name}</b>
                  </Link>{' '}
                  <span className="muted small">
                    @{m.username}
                    {m.email ? ` · ${m.email}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** New reviewer, `/agents/new`: presets, the recommended crew, or a blank reviewer. Creating is for site admins. */
export default function AgentNew() {
  const me = useCurrentUser();
  const admin = me?.role === 'admin';
  const presets = useQuery({
    queryKey: qk.agentPresets,
    queryFn: api.agentPresets,
  });
  const agents = useQuery({ queryKey: qk.agents, queryFn: api.agents });
  const ready = !!presets.data && !!agents.data;
  const entering = useEnter(ready);
  const handles = new Set(
    (agents.data ?? []).map((a) => a.username.toLowerCase())
  );
  return (
    <div className={`ag-page ${entering}`}>
      <PageHead
        icon="plus"
        crumbs={[
          { label: t('Agents'), to: '/agents' },
          { label: t('New reviewer') },
        ]}
        title={t('New reviewer')}
        lede={t(
          'A reviewer is an account with its own repository of instructions. Clef wakes it when a change concerns it.'
        )}
      />
      {!admin && <WhoCanAdd />}
      {admin && ready && (
        <CrewPanel presets={presets.data!} handles={handles} />
      )}
      <Section title={t('Presets')}>
        {presets.isError || agents.isError ? (
          <LoadError
            what={t('the reviewer presets')}
            error={presets.error ?? agents.error}
            onRetry={() => {
              void presets.refetch();
              void agents.refetch();
            }}
          />
        ) : !ready ? (
          <div
            className="sk-grid"
            role="status"
            aria-busy="true"
            aria-label={t('Loading')}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="sk sk-card" />
            ))}
          </div>
        ) : (
          <div className="agrid">
            {presets.data!.map((p) => (
              <PresetCard
                key={p.facet}
                preset={p}
                admin={admin}
                handles={handles}
              />
            ))}
          </div>
        )}
      </Section>
      {admin && (
        <Section title={t('Start blank')}>
          <BlankForm />
        </Section>
      )}
    </div>
  );
}
