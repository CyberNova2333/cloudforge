// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DependabotIcon, GearIcon, PeopleIcon } from '@primer/octicons-react';
import { api, qk, type RepoDetail, type Visibility } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { t, tx } from '@/lib/i18n';
import { Avatar } from '@/components/Avatar';
import { NotFound } from './NotFound';

/** One pattern per line or comma-separated: `release/*`, `develop`, `hotfix/**`. */
const protectedPatterns = (text: string) =>
  text
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);

const VISIBILITY_DESCRIPTION: Record<Visibility, string> = {
  private: t(
    'Private: only you, collaborators, and site admins can see this repository.'
  ),
  internal: t(
    'Internal: every member of this instance can see this repository.'
  ),
  public: t(
    'Public: anyone can see this repository and clone it, even without an account. Only you and collaborators can push.'
  ),
};

/** What the page says once the visibility has changed. */
const VISIBILITY_FLASH: Record<Visibility, string> = {
  private: t('This repository is now private.'),
  internal: t('This repository is now internal.'),
  public: t('This repository is now public.'),
};

export default function RepoSettings() {
  const repo = useOutletContext<RepoDetail>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const o = repo.owner.username;
  const [name, setName] = useState(repo.name);
  const [description, setDescription] = useState(repo.description ?? '');
  const [defaultBranch, setDefaultBranch] = useState(repo.defaultBranch);
  const [protectedBranches, setProtectedBranches] = useState(
    (repo.protectedBranches ?? []).join('\n')
  );
  const [flash, setFlash] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [collabName, setCollabName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const collabs = useQuery({
    queryKey: qk.collaborators(o, repo.name),
    queryFn: () => api.collaborators(o, repo.name),
  });
  const members = useQuery({ queryKey: qk.members, queryFn: api.members });
  const agents = useQuery({ queryKey: qk.agents, queryFn: api.agents });
  const repoAgents = useQuery({
    queryKey: qk.repoAgents(o, repo.name),
    queryFn: () => api.repoAgents(o, repo.name),
  });
  const [agentName, setAgentName] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.updateRepo(o, repo.name, {
        name,
        description,
        defaultBranch,
        protectedBranches: protectedPatterns(protectedBranches),
      }),
    onSuccess: async (r) => {
      setFlash({ kind: 'success', text: t('Repository settings saved.') });
      await qc.invalidateQueries({ queryKey: ['repo', o] });
      await qc.invalidateQueries({ queryKey: qk.repos });
      if (r.name !== repo.name) navigate(`/${o}/${r.name}/settings`);
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });
  const changeVisibility = useMutation({
    mutationFn: (visibility: Visibility) =>
      api.updateRepo(o, repo.name, { visibility }),
    onSuccess: async (r) => {
      setFlash({ kind: 'success', text: VISIBILITY_FLASH[r.visibility] });
      await qc.invalidateQueries({ queryKey: ['repo', o] });
      await qc.invalidateQueries({ queryKey: qk.repos });
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });
  const addCollab = useMutation({
    mutationFn: (u: string) => api.addCollaborator(o, repo.name, u),
    onSuccess: () => {
      setCollabName('');
      qc.invalidateQueries({ queryKey: qk.collaborators(o, repo.name) });
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });
  const removeCollab = useMutation({
    mutationFn: (u: string) => api.removeCollaborator(o, repo.name, u),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.collaborators(o, repo.name) }),
  });
  const inviteAgent = useMutation({
    mutationFn: (handle: string) => {
      setFlash(null);
      return api.inviteAgent(o, repo.name, handle);
    },
    onSuccess: (_r, handle) => {
      qc.invalidateQueries({ queryKey: qk.namespace(handle) });
      setAgentName('');
      qc.invalidateQueries({ queryKey: qk.repoAgents(o, repo.name) });
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });
  const removeAgent = useMutation({
    mutationFn: (handle: string) => {
      setFlash(null);
      return api.removeAgent(o, repo.name, handle);
    },
    onSuccess: (_r, handle) => {
      qc.invalidateQueries({ queryKey: qk.repoAgents(o, repo.name) });
      qc.invalidateQueries({ queryKey: qk.namespace(handle) });
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteRepo(o, repo.name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.repos });
      navigate('/');
    },
    onError: (e) => setFlash({ kind: 'error', text: errorMessage(e) }),
  });

  if (!repo.permissions.admin) return <NotFound />;
  const existing = new Set([
    repo.owner.id,
    ...(collabs.data ?? []).map((c) => c.id),
  ]);
  const candidates = (members.data ?? []).filter((m) => !existing.has(m.id));
  const invited = new Set((repoAgents.data ?? []).map((a) => a.id));
  const agentCandidates = (agents.data ?? []).filter((a) => !invited.has(a.id));

  return (
    <div
      className="container-xl px-3 px-md-4 px-lg-5 pb-6 d-flex flex-column flex-md-row"
      style={{ gap: 24 }}
    >
      <nav className="menu col-md-3" style={{ height: 'fit-content' }}>
        <a
          href="#general"
          className="menu-item selected d-flex flex-items-center"
          style={{ gap: 8 }}
        >
          <GearIcon /> {t('General')}
        </a>
        <a
          href="#access"
          className="menu-item d-flex flex-items-center"
          style={{ gap: 8 }}
        >
          <PeopleIcon /> {t('Collaborators')}
        </a>
        <a
          href="#agents"
          className="menu-item d-flex flex-items-center"
          style={{ gap: 8 }}
        >
          <DependabotIcon /> {t('Agents')}
        </a>
      </nav>
      <div className="flex-1">
        {flash && (
          <div className={`flash flash-${flash.kind} mb-3`}>{flash.text}</div>
        )}
        <div className="Subhead" id="general">
          <h2 className="Subhead-heading">{t('General')}</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFlash(null);
            save.mutate();
          }}
        >
          <label className="d-block text-bold f6 mb-1">
            {t('Repository name')}
          </label>
          <div className="d-flex mb-3" style={{ gap: 8 }}>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <label className="d-block text-bold f6 mb-1">
            {t('Description')}
          </label>
          <input
            className="form-control width-full mb-3"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="d-block text-bold f6 mb-1">
            {t('Default branch')}
          </label>
          <select
            className="form-select mb-3"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            disabled={!repo.branches.length}
          >
            {repo.branches.length === 0 && (
              <option>{repo.defaultBranch}</option>
            )}
            {repo.branches.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
          <label
            className="d-block text-bold f6 mb-1"
            htmlFor="protected-branches"
          >
            {t('Protected branches')}
          </label>
          <p className="note mt-0 mb-1">
            {t(
              'CloudForge never rebases these branches. The default branch is always protected.'
            )}
          </p>
          <textarea
            id="protected-branches"
            className="form-control width-full mb-3 text-mono f6"
            rows={3}
            placeholder={'release/*\ndevelop\nhotfix/**'}
            value={protectedBranches}
            onChange={(e) => setProtectedBranches(e.target.value)}
            style={{ minHeight: 0 }}
          />
          <div>
            <button className="btn" disabled={save.isPending}>
              {t('Save changes')}
            </button>
          </div>
        </form>

        <div className="Subhead mt-6" id="access">
          <h2 className="Subhead-heading">{t('Collaborators')}</h2>
          <div className="Subhead-description">
            {repo.visibility === 'private'
              ? t(
                  'Collaborators can see this private repository, push branches, and merge pull requests.'
                )
              : t(
                  'Every member can read this repository. Collaborators can also push branches and merge pull requests.'
                )}
          </div>
        </div>
        <div className="Box mb-3">
          <div className="Box-row d-flex flex-items-center" style={{ gap: 12 }}>
            <Avatar user={repo.owner} size={32} />
            <Link to={`/${o}`} className="text-bold flex-1">
              {o}
            </Link>
            <span className="Label">{t('Owner')}</span>
          </div>
          {(collabs.data ?? []).map((u) => (
            <div
              key={u.id}
              className="Box-row d-flex flex-items-center"
              style={{ gap: 12 }}
            >
              <Avatar user={u} size={32} />
              <Link to={`/${u.username}`} className="text-bold flex-1">
                {u.username}
              </Link>
              <span className="Label">{t('Write')}</span>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => removeCollab.mutate(u.username)}
              >
                {t('Remove')}
              </button>
            </div>
          ))}
        </div>
        <form
          className="d-flex mb-6"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (collabName) addCollab.mutate(collabName);
          }}
        >
          <select
            className="form-select flex-1"
            value={collabName}
            onChange={(e) => setCollabName(e.target.value)}
          >
            <option value="">{t('Select a member…')}</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.username}>
                {m.username} — {m.name}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!collabName}>
            {t('Add collaborator')}
          </button>
        </form>

        <div className="Subhead mt-6" id="agents">
          <h2 className="Subhead-heading">{t('Agents')}</h2>
          <div className="Subhead-description">
            {t(
              "Reviewer agents invited to this repository. Each agent's AGENT.md says what it reviews."
            )}
          </div>
        </div>
        <div className="Box mb-3">
          {(repoAgents.data ?? []).length === 0 && (
            <div className="Box-row color-fg-muted">
              {t('No agents invited.')}
            </div>
          )}
          {(repoAgents.data ?? []).map((a) => (
            <div
              key={a.id}
              className="Box-row d-flex flex-items-center"
              style={{ gap: 12 }}
            >
              <Avatar user={a} size={32} />
              <div className="flex-1" style={{ minWidth: 0 }}>
                <Link to={`/${a.username}`} className="text-bold">
                  {a.username}
                </Link>
                <span className="color-fg-muted ml-2">{a.name}</span>
                {a.bio && <div className="f6 color-fg-muted">{a.bio}</div>}
              </div>
              <button
                className="btn btn-sm btn-danger"
                disabled={removeAgent.isPending}
                onClick={() => removeAgent.mutate(a.username)}
              >
                {t('Remove')}
              </button>
            </div>
          ))}
        </div>
        <form
          className="d-flex mb-6"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (agentName) inviteAgent.mutate(agentName);
          }}
        >
          <select
            className="form-select flex-1"
            aria-label={t('Agent to invite')}
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
          >
            <option value="">{t('Select an agent…')}</option>
            {agentCandidates.map((a) => (
              <option key={a.id} value={a.username}>
                {a.username} — {a.name}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!agentName}>
            {t('Invite agent')}
          </button>
        </form>

        <div className="Subhead mt-6" id="visibility">
          <h2 className="Subhead-heading">{t('Visibility')}</h2>
          <div className="Subhead-description">
            {VISIBILITY_DESCRIPTION[repo.visibility]}
            {repo.ownerType === 'team' && (
              <> {t('Team repositories are always visible to every member.')}</>
            )}
          </div>
        </div>
        <div className="mb-6 d-flex flex-wrap" style={{ gap: 8 }}>
          {(repo.ownerType === 'team'
            ? (['internal', 'public'] as const)
            : (['private', 'internal', 'public'] as const)
          )
            .filter((v) => v !== repo.visibility)
            .map((v) => (
              <button
                key={v}
                className="btn"
                disabled={changeVisibility.isPending}
                onClick={() => {
                  if (
                    v === 'public' &&
                    !window.confirm(
                      t(
                        'Make {repo} public? Anyone on the internet will be able to see its code, pull requests and Actions logs, and clone it without an account.',
                        { repo: repo.fullName }
                      )
                    )
                  )
                    return;
                  changeVisibility.mutate(v);
                }}
              >
                {v === 'private'
                  ? t('Make private')
                  : v === 'internal'
                    ? t('Make internal')
                    : t('Make public')}
              </button>
            ))}
        </div>

        <div className="Subhead">
          <h2 className="Subhead-heading color-fg-danger">
            {t('Danger Zone')}
          </h2>
        </div>
        <div className="Box color-border-danger">
          <div className="Box-row">
            <div className="text-bold">{t('Delete this repository')}</div>
            <p className="f6 color-fg-muted mb-2">
              {tx(
                'Once you delete a repository, there is no going back. Type {name} to confirm.',
                { name: <strong>{repo.fullName}</strong> }
              )}
            </p>
            <div className="d-flex flex-column flex-sm-row" style={{ gap: 8 }}>
              <input
                className="form-control flex-1"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <button
                className="btn btn-danger"
                disabled={confirmName !== repo.fullName || del.isPending}
                onClick={() => del.mutate()}
              >
                {t('Delete this repository')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
