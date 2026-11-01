// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LockIcon,
  MailIcon,
  OrganizationIcon,
  PeopleIcon,
} from '@primer/octicons-react';
import { api, qk } from '@/lib/api/uiApi';
import { errorMessage } from '@/lib/api/api';
import { fullDate, timeAgo } from '@/lib/utils/format';
import { t, tx } from '@/lib/i18n/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { PendingButton } from '@/components/ui/PendingButton';
import { Section } from '@/components/ui/Section';
import { Avatar } from '@/components/ui/Avatar';
import { CopyButton } from '@/components/ui/CopyButton';
import { InlineConfirm } from '@/components/ui/InlineConfirm';
import { LoadError, Notice } from '@/components/ui/Notice';
import { AdminFrame, RowsSkeleton } from '@/components/shell/SetFrame';
import { AdminSetup } from '@/components/admin/AdminSetup';
import { AdminSettings } from '@/components/admin/AdminSettings';
import { ActionsVariables } from '@/components/actions/ActionsVariables';

export default function Admin() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const members = useQuery({ queryKey: qk.members, queryFn: api.members });
  const invites = useQuery({
    queryKey: qk.invitations,
    queryFn: api.invitations,
  });
  const team = useQuery({ queryKey: qk.team, queryFn: api.team });
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const signup = status.data?.signup;

  // `?invite=1` (the create menu's "Invite member") opens the form, also when this page is already open.
  const wantInvite = params.get('invite') === '1';
  const [showInvite, setShowInvite] = useState(wantInvite);
  const inviteRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (wantInvite) setShowInvite(true);
  }, [wantInvite]);
  useEffect(() => {
    if (showInvite && wantInvite)
      inviteRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showInvite, wantInvite]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [result, setResult] = useState<{
    url: string;
    emailed: boolean;
    email: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.invite({ email, role }),
    onSuccess: (r) => {
      setResult({
        url: r.inviteUrl,
        emailed: r.emailed,
        email: r.invitation.email,
      });
      setEmail('');
      return qc.invalidateQueries({ queryKey: qk.invitations });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invitations }),
  });
  // A member who forgot their password: a one-time link to hand over (emailed too when email is set up).
  const [resetFor, setResetFor] = useState<{
    username: string;
    url: string;
    emailed: boolean;
    expiresAt: string;
  } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetLink = useMutation({
    mutationFn: (username: string) => api.passwordResetLink(username),
    onSuccess: (r, username) => {
      setResetError(null);
      setResetFor({ username, ...r });
    },
    onError: (e) => {
      setResetFor(null);
      setResetError(errorMessage(e));
    },
  });

  const [teamForm, setTeamForm] = useState<{
    name: string;
    slug: string;
  } | null>(null);
  const [teamMsg, setTeamMsg] = useState<{
    kind: 'ok' | 'bad';
    text: string;
  } | null>(null);
  const saveTeam = useMutation({
    mutationFn: () => api.saveTeam(teamForm!),
    onSuccess: (r) => {
      setTeamMsg({
        kind: 'ok',
        text: t('Saved. Team repositories live at /{slug}/<repo>.', {
          slug: r.team.slug,
        }),
      });
      setTeamForm(null);
      qc.invalidateQueries({ queryKey: qk.team });
      qc.invalidateQueries({ queryKey: qk.repos });
    },
    onError: (e) => setTeamMsg({ kind: 'bad', text: errorMessage(e) }),
  });
  const pending = (invites.data ?? []).filter(
    (i) => !i.acceptedAt && new Date(i.expiresAt) > new Date()
  );

  return (
    <>
      <PageHead
        icon="shield"
        crumbs={[{ label: t('Site admin') }]}
        title={t('Site admin')}
        lede={t(
          'Who can sign in, whether this deployment is set up properly, and the settings every repository shares.'
        )}
      />
      <AdminFrame>
        <div id="people" className="adm-people">
          <Section
            title={
              <>
                <OrganizationIcon size={16} /> {t('Team')}
              </>
            }
          >
            <p className="small muted">
              {tx(
                'The one shared team. Its repositories are visible to every member, and live at {path}.',
                {
                  path: (
                    <code>
                      /{team.data?.team?.slug ?? '<team>'}/&lt;repo&gt;
                    </code>
                  ),
                }
              )}
            </p>
            {teamMsg && <Notice tone={teamMsg.kind}>{teamMsg.text}</Notice>}
            {team.isPending ? (
              <RowsSkeleton rows={1} />
            ) : team.isError ? (
              <LoadError
                what={t('the team')}
                error={team.error}
                onRetry={() => team.refetch()}
              />
            ) : teamForm ? (
              <form
                className="panel formpad"
                onSubmit={(e) => {
                  e.preventDefault();
                  setTeamMsg(null);
                  saveTeam.mutate();
                }}
              >
                <div className="frow">
                  <div className="fld grow2">
                    <label htmlFor="team-name">{t('Team name')}</label>
                    <input
                      id="team-name"
                      className="form-control"
                      required
                      placeholder="XY Space"
                      value={teamForm.name}
                      onChange={(e) =>
                        setTeamForm({ ...teamForm, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="fld grow2">
                    <label htmlFor="team-slug">{t('URL name')}</label>
                    <input
                      id="team-slug"
                      className="form-control mono"
                      required
                      placeholder="acme"
                      value={teamForm.slug}
                      onChange={(e) =>
                        setTeamForm({ ...teamForm, slug: e.target.value })
                      }
                    />
                  </div>
                </div>
                {team.data.team && teamForm.slug !== team.data.team.slug && (
                  <Notice tone="warn">
                    {t(
                      "Changing the URL name changes every team repository's URL and clone address."
                    )}
                  </Notice>
                )}
                <div className="actions">
                  <PendingButton
                    type="submit"
                    className="primary"
                    pending={saveTeam.isPending}
                    pendingLabel={t('Saving…')}
                  >
                    {t('Save team')}
                  </PendingButton>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setTeamForm(null)}
                  >
                    {t('Cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="panel">
                {team.data.team ? (
                  <ul className="rowlist">
                    <li>
                      <Avatar
                        user={{ username: team.data.team.slug }}
                        size={32}
                        square
                      />
                      <div className="grow">
                        <Link to={`/${team.data.team.slug}`}>
                          <b>{team.data.team.name}</b>
                        </Link>
                        <span className="mono muted small">
                          /{team.data.team.slug}
                        </span>
                      </div>
                      <div className="ctl">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() =>
                            setTeamForm({
                              name: team.data.team!.name,
                              slug: team.data.team!.slug,
                            })
                          }
                        >
                          {t('Rename')}
                        </button>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <EmptyState
                    picture={<OrganizationIcon size={20} />}
                    title={t('No team yet.')}
                    body={t('Create it to allow team repositories.')}
                    action={
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => setTeamForm({ name: '', slug: '' })}
                      >
                        {t('Create team')}
                      </button>
                    }
                  />
                )}
              </div>
            )}
          </Section>

          <Section
            title={
              <>
                <PeopleIcon size={16} /> {t('Members')}
                {members.data && (
                  <span className="num">{members.data.length}</span>
                )}
              </>
            }
            actions={
              <button
                type="button"
                className="btn small primary"
                aria-expanded={showInvite}
                onClick={() => setShowInvite(!showInvite)}
              >
                {t('Invite member')}
              </button>
            }
          >
            <p className="small muted">
              {signup?.enabled
                ? signup.domains.length
                  ? t(
                      'Self sign-up is on for {domains}; anyone else joins by invitation.',
                      { domains: signup.domains.join(', ') }
                    )
                  : t(
                      'Self sign-up is on: anyone who can reach this instance can create an account.'
                    )
                : t('Self sign-up is off. People join by invitation.')}{' '}
              {tx('Change it in {settings}.', {
                settings: <a href="#settings">{t('Instance settings')}</a>,
              })}{' '}
              {t(
                "Members can't be removed and roles can't be changed from here."
              )}
            </p>
            {showInvite && (
              <form
                ref={inviteRef}
                className="panel formpad"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  setResult(null);
                  invite.mutate();
                }}
              >
                <h3 className="formtitle">{t('Invite a member')}</h3>
                <p className="small muted">
                  {t(
                    "They'll receive an email with a link to create their account. The link expires in 7 days."
                  )}
                </p>
                {error && <Notice tone="bad">{error}</Notice>}
                {result && (
                  <Notice tone={result.emailed ? 'ok' : 'warn'}>
                    <p>
                      {result.emailed
                        ? t(
                            'Invitation sent to {email}. You can also share this link directly:',
                            { email: result.email }
                          )
                        : t(
                            "We couldn't send the email to {email}. Share this link with them instead:",
                            { email: result.email }
                          )}
                    </p>
                    <div className="copyrow">
                      <input
                        className="form-control mono"
                        readOnly
                        value={result.url}
                        aria-label={t('Invitation link')}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <CopyButton
                        text={result.url}
                        className="btn small"
                        label={t('Copy the invitation link')}
                      />
                    </div>
                  </Notice>
                )}
                <div className="frow">
                  <div className="fld grow2">
                    <label htmlFor="invite-email">{t('Email address')}</label>
                    <input
                      id="invite-email"
                      type="email"
                      required
                      className="form-control"
                      placeholder="teammate@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="fld">
                    <label htmlFor="invite-role">{t('Role')}</label>
                    <select
                      id="invite-role"
                      className="form-select"
                      value={role}
                      onChange={(e) =>
                        setRole(e.target.value as 'user' | 'admin')
                      }
                    >
                      <option value="user">{t('Member')}</option>
                      <option value="admin">{t('Site admin')}</option>
                    </select>
                  </div>
                  <PendingButton
                    type="submit"
                    className="primary"
                    pending={invite.isPending}
                    pendingLabel={t('Sending…')}
                  >
                    {t('Send invitation')}
                  </PendingButton>
                </div>
              </form>
            )}
            <div className="panel">
              {members.isPending ? (
                <div className="pad">
                  <RowsSkeleton rows={3} />
                </div>
              ) : members.isError ? (
                <div className="pad">
                  <LoadError
                    what={t('the members')}
                    error={members.error}
                    onRetry={() => members.refetch()}
                  />
                </div>
              ) : (
                <>
                  {resetError && <Notice tone="warn">{resetError}</Notice>}
                  {resetFor && (
                    <Notice tone="ok">
                      <p>
                        {resetFor.emailed
                          ? t(
                              'A one-time link to choose a new password was emailed to @{username}. You can also hand it over directly:',
                              { username: resetFor.username }
                            )
                          : t(
                              'Hand this one-time link to @{username} to choose a new password:',
                              { username: resetFor.username }
                            )}
                      </p>
                      <div className="copyrow">
                        <input
                          className="form-control mono"
                          readOnly
                          value={resetFor.url}
                          aria-label={t('Password reset link')}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <CopyButton
                          text={resetFor.url}
                          className="btn small"
                          label={t('Copy the password reset link')}
                        />
                      </div>
                      <p className="muted small">
                        {t(
                          'It works once, until {date}. Using it signs out their other sessions.',
                          { date: fullDate(resetFor.expiresAt) }
                        )}
                      </p>
                    </Notice>
                  )}
                  <ul className="rowlist">
                    {members.data.map((m) => (
                      <li key={m.id}>
                        <Avatar user={m} size={32} />
                        <div className="grow">
                          <span className="wrap">
                            <Link to={`/${m.username}`}>
                              <b>{m.username}</b>
                            </Link>{' '}
                            <span className="muted">{m.name}</span>
                          </span>
                          <span className="muted small wrap">{m.email}</span>
                        </div>
                        <div className="ctl stack">
                          {m.role === 'admin' && (
                            <Chip tone="info">{t('Site admin')}</Chip>
                          )}
                          <button
                            type="button"
                            className="btn small"
                            disabled={resetLink.isPending}
                            onClick={() => resetLink.mutate(m.username)}
                          >
                            {t('Reset password')}
                          </button>
                          <span className="when">
                            {t('Joined {when}', { when: timeAgo(m.createdAt) })}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Section>

          <Section
            title={
              <>
                <MailIcon size={16} /> {t('Pending invitations')}
              </>
            }
          >
            {invites.isPending ? (
              <RowsSkeleton rows={1} />
            ) : invites.isError ? (
              <LoadError
                what={t('the invitations')}
                error={invites.error}
                onRetry={() => invites.refetch()}
              />
            ) : pending.length === 0 ? (
              <div className="panel">
                <EmptyState
                  picture={<MailIcon size={20} />}
                  title={t('No pending invitations.')}
                />
              </div>
            ) : (
              <div className="panel">
                <ul className="rowlist">
                  {pending.map((i) => (
                    <li key={i.id}>
                      <MailIcon className="ic" />
                      <div className="grow">
                        <b className="wrap">{i.email}</b>
                        <span className="muted small">
                          {t('Invited {when} · expires {expires}', {
                            when: timeAgo(i.createdAt),
                            expires: timeAgo(i.expiresAt),
                          })}
                        </span>
                      </div>
                      <div className="ctl">
                        <Chip tone="off">
                          {i.role === 'admin' ? t('Site admin') : t('Member')}
                        </Chip>
                        <InlineConfirm
                          label={t('Revoke')}
                          confirmLabel={t('Revoke invitation')}
                          pendingLabel={t('Revoking…')}
                          accessibleName={t(
                            'Revoke the invitation to {email}',
                            {
                              email: i.email,
                            }
                          )}
                          pending={
                            revoke.isPending && revoke.variables === i.id
                          }
                          error={
                            revoke.isError && revoke.variables === i.id
                              ? errorMessage(revoke.error)
                              : null
                          }
                          onConfirm={() => revoke.mutate(i.id)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </div>

        <AdminSetup />
        <AdminSettings />
        <div id="actions">
          <Section
            title={
              <>
                <LockIcon size={16} /> {t('Actions secrets and variables')}
              </>
            }
          >
            <p className="muted small">
              {t(
                "Available to every repository's workflows. A repository's own secret or variable of the same name wins."
              )}
            </p>
            <ActionsVariables scope={null} />
          </Section>
        </div>
      </AdminFrame>
    </>
  );
}
