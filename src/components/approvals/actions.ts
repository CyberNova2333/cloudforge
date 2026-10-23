// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { qk } from '@/lib/uiApi';

/** After any decision: the repository's pages and everything under Approvals (the list, findings, Claude's log). */
export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(
    async (owner: string, name: string) => {
      void qc.invalidateQueries({ queryKey: ['repo', owner, name] });
      await qc.invalidateQueries({ queryKey: qk.approvals });
    },
    [qc]
  );
}

/** A refusal in words. A 409 on a request for changes means the note never reached anyone. */
export function failure(e: unknown, opts: { sendingNote?: boolean } = {}) {
  const message = errorMessage(e);
  return e instanceof ApiError && e.status === 409 && opts.sendingNote
    ? t('{error} Your note was not sent.', { error: message })
    : message;
}
