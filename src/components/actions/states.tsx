// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { ReactNode } from 'react';
import { AlertIcon } from '@primer/octicons-react';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/EmptyState';

/** Placeholder rows for a list's first load (the page header is already on screen). */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="sk-rows"
      role="status"
      aria-busy="true"
      aria-label={t('Loading')}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk sk-row" />
      ))}
    </div>
  );
}

/** Placeholder for a page of stat tiles and panels. */
export function StatsSkeleton() {
  return (
    <div
      className="sk-page"
      role="status"
      aria-busy="true"
      aria-label={t('Loading')}
    >
      <div className="sk-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="sk sk-card" />
        ))}
      </div>
      <div className="sk sk-block" />
      <div className="sk sk-block short" />
    </div>
  );
}

/** A failed query, in words, with a way to try again. */
export function QueryError({
  error,
  onRetry,
  title = t('This did not load'),
  picture,
}: {
  error: unknown;
  onRetry(): void;
  title?: ReactNode;
  picture?: ReactNode;
}) {
  return (
    <EmptyState
      role="alert"
      picture={picture ?? <AlertIcon size={24} />}
      title={title}
      body={errorMessage(error)}
      action={
        <button type="button" className="btn small" onClick={onRetry}>
          {t('Retry')}
        </button>
      }
    />
  );
}
