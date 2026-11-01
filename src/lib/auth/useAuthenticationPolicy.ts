import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from './auth';
import { apiFetch } from '../api/api';
import {
  matchesAuthenticationPolicy,
  subscribeAuthenticationPolicy,
  type BrowserAuthenticationPolicy,
} from './authenticationPolicy';

export const authenticationPolicyKey = (userId?: string, sessionId?: string) =>
  ['authentication-policy', userId ?? null, sessionId ?? null] as const;

/** Policy metadata is session-bound and never substitutes for the server's current authorization check. */
export function useAuthenticationPolicy() {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const sessionId = session?.session.id;
  const client = useQueryClient();
  const key = authenticationPolicyKey(userId, sessionId);
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && !!sessionId,
    queryFn: async ({ signal }) => {
      const state = await apiFetch<BrowserAuthenticationPolicy>(
        '/api/me/authentication-policy',
        {
          cache: 'no-store',
          signal,
        }
      );
      if (!sessionId || !matchesAuthenticationPolicy(state, sessionId))
        throw new Error('The signed-in session changed. Reload and try again.');
      return state;
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  useEffect(
    () =>
      subscribeAuthenticationPolicy((changedSessionId) => {
        if (changedSessionId === sessionId)
          void client.invalidateQueries(
            { queryKey: key, exact: true },
            { cancelRefetch: false }
          );
      }),
    [client, userId, sessionId]
  );
  return query;
}
