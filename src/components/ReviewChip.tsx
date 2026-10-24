// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { Pull } from '@/lib/uiApi';
import type { Tone } from '@/lib/agentLook';
import { Chip } from '@/components/ui/Chip';
import { t, tn } from '@/lib/i18n';

type Review = NonNullable<Pull['review']>;

const REVIEW: Record<Review['state'], { label: string; tone: Tone }> = {
  reviewing: { label: t('Reviewing…'), tone: 'info' },
  review_required: { label: t('Review required'), tone: 'warn' },
  approved: { label: t('Approved'), tone: 'good' },
  failed: { label: t('Review failed'), tone: 'critical' },
  changes_requested: { label: t('Changes requested'), tone: 'serious' },
  needs_approval: { label: t('Needs approval'), tone: 'warn' },
};

/** The head commit's review in a word: Reviewing…, Review required (with its flags), Approved, and so on. */
export function ReviewChip({ review }: { review: Pull['review'] }) {
  if (!review) return null;
  const { label, tone } = REVIEW[review.state];
  const flags =
    review.state === 'review_required' && review.flags > 0
      ? ` · ${tn(review.flags, '{n} flag', '{n} flags')}`
      : '';
  return (
    <Chip tone={tone}>
      {label}
      {flags}
    </Chip>
  );
}
