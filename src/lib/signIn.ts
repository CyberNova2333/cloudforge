import { useLocation } from 'react-router-dom';

/** The sign-in page, returning to the page the person is on. */
export function useSignInHref() {
  const { pathname, search } = useLocation();
  return `/login?return_to=${encodeURIComponent(pathname + search)}`;
}

/** First segments of the app's own pages: a path starting with one is never `/<owner>/<repo>`. */
const APP_PAGES = new Set([
  'repos',
  'agents',
  'new',
  'approvals',
  'settings',
  'admin',
  'oauth',
  'setup',
  'login',
  'signup',
  'invite',
]);

/**
 * Pages someone without an account may open: home (the public repositories) and a repository's pages, which the
 * API serves only for public repositories (anything else is a 404 that offers to sign in).
 */
export function openWithoutAccount(pathname: string): boolean {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (first === undefined) return true;
  return second !== undefined && !APP_PAGES.has(first);
}
