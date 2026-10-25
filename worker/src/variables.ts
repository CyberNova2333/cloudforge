// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { DrizzleDB } from './db/middleware';
import type { createAuth } from './auth';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role?: string | null;
  image?: string | null;
  banned?: boolean | null;
};

export type Variables = {
  db: DrizzleDB;
  auth: ReturnType<typeof createAuth>;
  user?: SessionUser;
  /** Set when `user` came from a personal access token (auth/token-auth.ts) rather than a session. */
  tokenScope?: 'read' | 'write';
};

export type AppEnv = { Bindings: CloudflareBindings; Variables: Variables };
