// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '../auth/auth';
import { api, qk } from '../api/uiApi';

/** How many things wait on the current user, for the header's badge (a one-item page carries `count`). */
export function useApprovalCount() {
  // Signed out (a public repository): nothing waits on nobody.
  const signedIn = !!useCurrentUser();
  return useQuery({
    queryKey: [...qk.approvals, 'count'],
    queryFn: () => api.approvals({ limit: 1 }),
    select: (page) => page.count,
    enabled: signedIn,
  });
}

/** Every page, loaded one at a time, for the Approvals page. Under the same `qk.approvals` prefix,
 * so live updates and actions refresh it. */
export function useApprovalPages() {
  return useInfiniteQuery({
    queryKey: [...qk.approvals, 'pages'],
    queryFn: ({ pageParam }) =>
      api.approvals({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
