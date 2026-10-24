// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { AlertIcon } from '@primer/octicons-react';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';

/** What a page says when its request failed: what was being loaded, why, and a way to try again. */
export function LoadError({
  what,
  error,
  onRetry,
  retrying,
}: {
  what: string;
  error: unknown;
  onRetry(): void;
  retrying?: boolean;
}) {
  return (
    <div className="panel" role="alert">
      <EmptyState
        picture={<AlertIcon size={20} />}
        title={t("We couldn't load {what}", { what })}
        body={errorMessage(error)}
        action={
          <button
            type="button"
            className="btn small"
            onClick={onRetry}
            disabled={retrying}
          >
            {t('Retry')}
          </button>
        }
      />
    </div>
  );
}
