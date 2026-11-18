// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qk } from '../api/uiApi';

const DEFAULT_NAME = 'CloudForge';

/** The instance's display name (`APP_NAME`), from the setup status query. */
export function useAppName(): string {
  const q = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  return q.data?.appName || DEFAULT_NAME;
}

/** Keeps the browser tab title in step with the page (`Pull requests · o/r · CloudForge`) and the instance name. */
export function useDocumentTitle(page?: string | null) {
  const name = useAppName();
  useEffect(() => {
    document.title = page ? `${page} · ${name}` : name;
  }, [page, name]);
}
