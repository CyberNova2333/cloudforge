// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { t } from '@/lib/i18n';
import type { Visibility } from '@/lib/uiApi';

const LABEL: Record<Visibility, { text: string; title: string }> = {
  private: {
    text: t('Private'),
    title: t('Only you, collaborators, and site admins can see this'),
  },
  internal: { text: t('Internal'), title: t('Every member can see this') },
  public: {
    text: t('Public'),
    title: t('Anyone can see this, even without an account'),
  },
};

export function VisibilityLabel({
  visibility,
  className = '',
}: {
  visibility: Visibility;
  className?: string;
}) {
  return (
    <span
      className={`Label Label--secondary ${className}`}
      title={LABEL[visibility].title}
    >
      {LABEL[visibility].text}
    </span>
  );
}
