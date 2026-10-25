import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../variables';

/**
 * Cross-site request forgery: the API authenticates by the session cookie alone, and SameSite=Lax still sends it from
 * pages of the same site (a sibling subdomain of a custom domain). So a signed-in request that changes something (any
 * method but GET/HEAD/OPTIONS, or a WebSocket upgrade) must come from this instance's own pages. Browsers say where a
 * request comes from (`Origin`, else `Sec-Fetch-Site`); a client that sends neither isn't a browser a page can steer.
 * better-auth's routes (`/api/auth/*`) check origins themselves.
 */
export const CROSS_SITE_REFUSED =
  'This request came from another site. Open CloudForge itself and try again.';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether `req` came from a page of another origin than this instance (its own address or BASE_URL's). */
export function fromAnotherSite(req: Request, baseUrl?: string): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null) {
    const own = new Set([new URL(req.url).origin]);
    try {
      if (baseUrl) own.add(new URL(baseUrl).origin);
    } catch {
      // A malformed BASE_URL adds nothing.
    }
    return !own.has(origin);
  }
  const site = req.headers.get('sec-fetch-site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

export const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user') || c.req.path.startsWith('/api/auth/')) return next();
  const upgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
  if (SAFE.has(c.req.method) && !upgrade) return next();
  if (fromAnotherSite(c.req.raw, c.env.BASE_URL))
    return c.json({ error: CROSS_SITE_REFUSED }, 403);
  return next();
};
