import { useState } from 'react';
import { Navigate, useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, qk, type RepoDetail } from '@/lib/uiApi';
import { useCurrentUser } from '@/lib/auth';
import { useSignInHref } from '@/lib/signIn';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { MarkdownEditor } from '@/components/CommentForm';
import { Avatar } from '@/components/Avatar';

/** Opening an issue: a title and a description. Labels and assignees are set on the issue's page. */
export default function IssueNew() {
  const repo = useOutletContext<RepoDetail>();
  const user = useCurrentUser();
  const signIn = useSignInHref();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  if (!user) return <Navigate to={signIn} replace />;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const issue = await api.createIssue(o, repo.name, {
        title: title.trim(),
        body,
      });
      await queryClient.invalidateQueries({ queryKey: qk.repo(o, repo.name) });
      navigate(`${base}/issues/${issue.number}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        icon="issue"
        crumbs={[
          { label: t('Issues'), to: `${base}/issues` },
          { label: t('New issue') },
        ]}
        title={t('New issue')}
        tab="issues"
        lede={t(
          'Say what happened or what is needed, so whoever picks it up can act on it.'
        )}
      />
      <form
        className="panel cmp-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && title.trim()) void create();
        }}
      >
        <span className="cmp-avatar">
          <Avatar
            user={{ username: user.username ?? user.name, image: user.image }}
            size={40}
          />
        </span>
        <div className="cmp-fields">
          {error && (
            <p className="cmp-error" role="alert">
              {error}
            </p>
          )}
          <div className="fld">
            <label htmlFor="issue-title">{t('Add a title')}</label>
            <input
              id="issue-title"
              className="form-control input-lg"
              autoFocus
              maxLength={256}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Title')}
            />
          </div>
          <div className="fld">
            <span className="lbl">{t('Add a description')}</span>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              placeholder={t('Add your description here...')}
              minHeight={200}
            />
          </div>
          <div className="cmp-actions">
            <PendingButton
              type="submit"
              className="primary"
              pending={busy}
              pendingLabel={t('Creating…')}
              disabled={!title.trim()}
            >
              {t('Create issue')}
            </PendingButton>
          </div>
        </div>
      </form>
    </>
  );
}
