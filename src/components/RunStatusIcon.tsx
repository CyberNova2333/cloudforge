// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  CheckCircleFillIcon,
  CircleIcon,
  SkipIcon,
  StopIcon,
  XCircleFillIcon,
} from '@primer/octicons-react';
import { t } from '@/lib/i18n';
import type { RunConclusion, RunStatus } from '@/lib/uiApi';

/** The status glyph GitHub uses for runs, jobs, and steps. */
export function RunStatusIcon({
  status,
  conclusion,
  size = 16,
}: {
  status: RunStatus;
  conclusion: RunConclusion;
  size?: number;
}) {
  if (status === 'queued')
    return (
      <span className="color-fg-attention" aria-label={t('Queued')}>
        <CircleIcon size={size} />
      </span>
    );
  if (status === 'in_progress')
    return (
      <span
        className="run-spinner color-fg-attention"
        style={{ width: size, height: size }}
        aria-label={t('In progress')}
      />
    );
  if (conclusion === 'success')
    return (
      <span className="color-fg-success" aria-label={t('Success')}>
        <CheckCircleFillIcon size={size} />
      </span>
    );
  if (conclusion === 'failure')
    return (
      <span className="color-fg-danger" aria-label={t('Failure')}>
        <XCircleFillIcon size={size} />
      </span>
    );
  if (conclusion === 'cancelled')
    return (
      <span className="color-fg-muted" aria-label={t('Cancelled')}>
        <StopIcon size={size} />
      </span>
    );
  return (
    <span className="color-fg-muted" aria-label={t('Skipped')}>
      <SkipIcon size={size} />
    </span>
  );
}

export function runStatusLabel(status: RunStatus, conclusion: RunConclusion) {
  if (status === 'queued') return t('Queued');
  if (status === 'in_progress') return t('In progress');
  return (
    {
      success: t('Success'),
      failure: t('Failure'),
      cancelled: t('Cancelled'),
      skipped: t('Skipped'),
    }[conclusion ?? 'skipped'] ?? t('Completed')
  );
}
