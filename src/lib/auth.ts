// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { createAuthClient } from 'better-auth/react';
import {
  adminClient,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { recentAuthenticationFetch } from './recentAuthentication';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: { customFetchImpl: recentAuthenticationFetch },
  // Sign-in during an OAuth flow carries the signed authorization request.
  // Login keeps the challenge on the same page, preserving the signed OAuth query.
  plugins: [
    adminClient(),
    usernameClient(),
    twoFactorClient(),
    oauthProviderClient(),
  ],
});

export const { useSession, signIn, signOut } = authClient;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  username?: string;
  displayUsername?: string;
  role?: string;
  image?: string | null;
  twoFactorEnabled?: boolean;
};

export function useCurrentUser(): CurrentUser | null {
  const { data } = useSession();
  return (data?.user as CurrentUser) ?? null;
}
