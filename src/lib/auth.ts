// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { createAuthClient } from 'better-auth/react';
import {
  adminClient,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { recentAuthenticationFetch } from './recentAuthentication';
import { nativeSignIn } from './signInLock';

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

export const { useSession, signOut } = authClient;
const signInSignal = (args: unknown[]) => {
  const first = args[0] as
    { fetchOptions?: { signal?: AbortSignal } } | undefined;
  return (
    first?.fetchOptions?.signal ??
    (args[1] as { signal?: AbortSignal } | undefined)?.signal
  );
};
export const signIn = {
  email: (...args: Parameters<typeof authClient.signIn.email>) =>
    nativeSignIn(
      () =>
        authClient.signIn.email(
          {
            ...args[0],
            fetchOptions: { ...args[0]?.fetchOptions, customFetchImpl: fetch },
          },
          args[1]
        ),
      signInSignal(args)
    ),
  username: (...args: Parameters<typeof authClient.signIn.username>) =>
    nativeSignIn(
      () =>
        authClient.signIn.username(
          {
            ...args[0],
            fetchOptions: { ...args[0]?.fetchOptions, customFetchImpl: fetch },
          },
          args[1]
        ),
      signInSignal(args)
    ),
};

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
