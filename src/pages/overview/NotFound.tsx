// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { usePageHead, type PageHeadInfo } from '@/components/ui/PageHead';
import { useCurrentUser } from '@/lib/auth/auth';
import { useSignInHref } from '@/lib/auth/signIn';
import { t } from '@/lib/i18n/i18n';

/** The top band for a page that doesn't exist (or that the person can't see). */
export const NOT_FOUND_HEAD: PageHeadInfo = {
  icon: 'alert',
  crumbs: [{ label: t('Page not found') }],
  title: t('Page not found'),
};

/**
 * 404, inside the shell (and inside a repository's header when the repository exists). It is also what a person
 * sees for a page they may not open, so it never says which.
 */
export function NotFound() {
  usePageHead(NOT_FOUND_HEAD);
  const signedIn = !!useCurrentUser();
  const signIn = useSignInHref();
  return (
    <section className="notfound" aria-labelledby="not-found-title">
      <p className="nf-code mono" aria-hidden="true">
        404
      </p>
      <h2 id="not-found-title">{t('This page does not exist')}</h2>
      <p>
        {t(
          'This is not the web page you are looking for. It may have moved, or you may not have access to it.'
        )}
      </p>
      <div className="actions">
        {signedIn ? (
          <>
            <Link to="/" className="btn primary">
              {t('Go home')}
            </Link>
            <Link to="/repos" className="btn">
              {t('Browse repositories')}
            </Link>
          </>
        ) : (
          <>
            {/* Signed out, a private repository looks like this too: signing in may open it. */}
            <Link to={signIn} className="btn primary">
              {t('Sign in')}
            </Link>
            <Link to="/" className="btn">
              {t('Public repositories')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
