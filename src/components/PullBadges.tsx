// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { AlertIcon, SparkleFillIcon } from '@primer/octicons-react';
import type { Pull } from '@/lib/uiApi';
import { t, tn } from '@/lib/i18n';

const AI_LABEL: Record<NonNullable<Pull['aiResolution']>, string> = {
  running: t('Resolving a rebase conflict with AI…'),
  failed: t('Rebase conflict needs the author'),
};

/** AI resolving a rebase conflict next to a listed PR's title: spinner while it runs, like checks. */
export function AiResolutionBadge({ state }: { state: Pull['aiResolution'] }) {
  if (!state) return null;
  const label = AI_LABEL[state];
  return (
    <span
      className="d-inline-flex flex-items-center v-align-middle"
      style={{ gap: 2 }}
      title={label}
      aria-label={label}
      role="img"
    >
      {state === 'failed' ? (
        <span className="color-fg-attention d-inline-flex">
          <AlertIcon size={14} />
        </span>
      ) : (
        <span className="d-inline-flex color-fg-attention">
          <SparkleFillIcon size={14} />
        </span>
      )}
      {state === 'running' && (
        <span
          className="run-spinner color-fg-attention"
          style={{ width: 12, height: 12 }}
        />
      )}
    </span>
  );
}

type ReviewState = NonNullable<Pull['review']>['state'];

const REVIEW_LABEL: Record<ReviewState, string> = {
  reviewing: t('Reviewing…'),
  review_required: t('Review required'),
  approved: t('Approved'),
  failed: t('Review failed'),
  changes_requested: t('Changes requested'),
  needs_approval: t('Needs approval'),
};

const REVIEW_CLASS: Record<ReviewState, string> = {
  reviewing: 'color-fg-muted',
  review_required: 'color-fg-muted',
  approved: 'color-fg-success',
  failed: 'color-fg-danger',
  changes_requested: 'color-fg-danger',
  needs_approval: 'color-fg-attention',
};

/** The head commit's review in a listed PR's meta line, as GitHub shows "Review required". */
export function ReviewLabel({
  review,
  to,
}: {
  review: Pull['review'];
  to: string;
}) {
  if (!review) return null;
  const flags =
    review.state === 'review_required' && review.flags > 0
      ? tn(review.flags, ' · {n} flag', ' · {n} flags')
      : '';
  return (
    <>
      {' • '}
      <Link
        to={to}
        className={`${REVIEW_CLASS[review.state]} d-inline-flex flex-items-center`}
        style={{ gap: 4, verticalAlign: 'bottom' }}
      >
        {review.state === 'reviewing' && (
          <span className="run-spinner" style={{ width: 10, height: 10 }} />
        )}
        {REVIEW_LABEL[review.state]}
        {flags}
      </Link>
    </>
  );
}
