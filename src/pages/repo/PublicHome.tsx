import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GlobeIcon } from '@primer/octicons-react';
import { useAppName } from '@/lib/utils/appName';
import { timeAgo } from '@/lib/utils/format';
import { useSignInHref } from '@/lib/auth/signIn';
import { api, qk } from '@/lib/api/uiApi';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadError } from '@/components/ui/Notice';
import { t } from '@/lib/i18n/i18n';

/**
 * Home for someone without an account: the instance's public repositories (`GET /api/repos` lists only those
 * without a session), newest activity first, and a way to sign in.
 */
export default function PublicHome() {
  const appName = useAppName();
  const signIn = useSignInHref();
  const repos = useQuery({ queryKey: qk.repos, queryFn: api.repos });

  return (
    <>
      <PageHead
        icon="repo"
        crumbs={[{ label: t('Public repositories') }]}
        title={t('Public repositories')}
        lede={t(
          'Repositories on {name} that anyone can read and clone. Members sign in to see everything shared with them.',
          { name: appName }
        )}
        actions={
          <Link className="btn primary" to={signIn}>
            {t('Sign in')}
          </Link>
        }
      />
      {repos.isError ? (
        <LoadError
          what={t('the repositories')}
          error={repos.error}
          onRetry={() => void repos.refetch()}
        />
      ) : !repos.data ? (
        <div
          className="sk-rows"
          role="status"
          aria-busy="true"
          aria-label={t('Loading repositories')}
        >
          <div className="sk sk-row" />
          <div className="sk sk-row" />
        </div>
      ) : repos.data.length === 0 ? (
        <section className="panel">
          <EmptyState
            picture={<GlobeIcon size={24} />}
            title={t('No public repositories yet')}
            body={t(
              'When a member makes a repository public, it shows up here.'
            )}
          />
        </section>
      ) : (
        <ul className="list">
          {repos.data.map((r) => (
            <li key={r.id}>
              <GlobeIcon size={16} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <Link to={`/${r.fullName}`}>
                  <b>{r.fullName}</b>
                </Link>
                {r.description && (
                  <div className="muted small">{r.description}</div>
                )}
              </div>
              <span className="when">
                {t('Updated {when}', { when: timeAgo(r.updatedAt) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
