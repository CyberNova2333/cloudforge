// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { ReactNode } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { usePageHead } from '@/components/ui/PageHead';
import { Notice } from '@/components/Notice';
import { RowsSkeleton } from '@/components/SetFrame';
import { lang, setLang } from '@/lib/i18n';
import { LANGUAGES } from '@/components/shell/AccountMenu';

/** The brand mark and name that open every page without the shell. */
function Brand() {
  return (
    <div className="auth-brand">
      <img src="/cloudforge-mark.svg" width={32} height={32} alt="" />
      <span className="brand-wordmark">CloudForge</span>
    </div>
  );
}

/** Switches to the other language: signed-out pages have no account menu to do it from. */
function LanguageLink() {
  const other = LANGUAGES.find((l) => l.value !== lang)!;
  return (
    <p className="auth-foot plain">
      <button
        type="button"
        className="btn-link"
        lang={other.value === 'zh' ? 'zh-CN' : 'en'}
        onClick={() => setLang(other.value)}
      >
        {other.label}
      </button>
    </p>
  );
}

/**
 * The frame of every page outside the app shell (setup, sign in, invitation, authorization): one card, centred on
 * the chrome colour of the chosen theme, as HQ's sign-in is. `title` is the card's `<h1>`; `docTitle` names the
 * browser tab ("Sign in" becomes "Sign in · <instance>").
 */
export function AuthShell({
  title,
  docTitle,
  lede,
  children,
  wide = false,
  hideBrand = false,
}: {
  title: ReactNode;
  docTitle: string;
  lede?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** For a page that draws its own heading mark (the authorization page shows two logos). */
  hideBrand?: boolean;
}) {
  const { chrome } = useTheme();
  usePageHead({ crumbs: [{ label: docTitle }], title: docTitle });
  return (
    <div className="app auth-page" data-chrome={chrome}>
      <main className={wide ? 'auth-card wide' : 'auth-card'}>
        {!hideBrand && <Brand />}
        <h1 className="auth-title">{title}</h1>
        {lede && <p className="auth-lede">{lede}</p>}
        {children}
        <LanguageLink />
      </main>
    </div>
  );
}

/** The card while what it needs loads: the same frame, a few quiet rows. */
export function AuthLoading() {
  const { chrome } = useTheme();
  return (
    <div className="app auth-page" data-chrome={chrome}>
      <main className="auth-card" aria-busy="true">
        <Brand />
        <RowsSkeleton rows={3} />
      </main>
    </div>
  );
}

/** What went wrong, above the form it belongs to. */
export function FlashError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Notice tone="bad">{message}</Notice>;
}
