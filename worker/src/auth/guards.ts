import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../variables';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.banned) return c.json({ error: 'Unauthorized' }, 401);
  await next();
};

/** A repository's pages that stay members-only even on a public repository. */
const MEMBERS_ONLY_REPO_PAGES = new Set(['audit', 'collaborators']);

/**
 * Whether `path` is an /api/repos read that someone without an account may make: the list, or a
 * repository and its pages. `visibleTo` and `loadRepo` then limit both to public repositories.
 */
export function isPublicRepoRead(path: string): boolean {
  if (path === '/api/repos' || path === '/api/repos/') return true;
  const m = path.match(/^\/api\/repos\/[^/]+\/[^/]+(?:\/([^/]+))?/);
  return !!m && !MEMBERS_ONLY_REPO_PAGES.has(m[1] ?? '');
}

/** requireAuth for /api/repos, except reads of public repositories (GET and HEAD only). */
export const requireAuthUnlessPublicRead: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  const user = c.get('user');
  if (user && !user.banned) return next();
  const read = c.req.method === 'GET' || c.req.method === 'HEAD';
  if (!read || !isPublicRepoRead(c.req.path))
    return c.json({ error: 'Unauthorized' }, 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.banned) return c.json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
};
