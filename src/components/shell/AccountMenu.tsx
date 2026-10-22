import { Link, useNavigate } from 'react-router-dom';
import { ChevronDownIcon } from '@primer/octicons-react';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/components/ThemeProvider';
import { Seg } from '@/components/ui/Seg';
import { signOut, useCurrentUser } from '@/lib/auth';
import { lang, setLang, t, type Lang } from '@/lib/i18n';
import { THEMES, type Mode } from '@/lib/theme';
import { api } from '@/lib/uiApi';
import type { ShellMenu } from './AppShell';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'system', label: t('System') },
  { value: 'light', label: t('Light') },
  { value: 'dark', label: t('Dark') },
];

/** Each language in its own name, so it can be found whichever is showing. */
export const LANGUAGES: readonly { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

/**
 * The account button (avatar and username) and its menu: who is signed in, the theme grid (every theme, picked the
 * same way), appearance, the person's pages, Site admin for admins, and Sign out.
 */
export function AccountMenu({
  open,
  setMenu,
}: {
  open: boolean;
  setMenu(menu: ShellMenu): void;
}) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { theme, mode, setTheme, setMode } = useTheme();
  if (!user) return null;
  const login = user.username ?? user.name;
  const close = () => setMenu(null);
  return (
    <span className="tool-wrap" data-menu-root="acct">
      <button
        type="button"
        className="acct-btn"
        data-menu-trigger="acct"
        aria-expanded={open}
        aria-label={t('Account and theme')}
        onClick={() => setMenu(open ? null : 'acct')}
      >
        <Avatar user={{ username: login, image: user.image }} size={28} />
        <span className="acct-name">{user.displayUsername ?? login}</span>
        <ChevronDownIcon className="chev" />
      </button>
      {open && (
        <div className="ws-menu right acct-menu">
          <div className="acct-head">
            <Avatar user={{ username: login, image: user.image }} size={36} />
            <span>
              <b>{user.name}</b>
              <span className="sub mono">{user.displayUsername ?? login}</span>
            </span>
          </div>
          <div className="dd-sep" />
          <div className="dd-label" id="acct-theme-label">
            {t('Theme')}
          </div>
          <div
            className="theme-grid"
            role="group"
            aria-labelledby="acct-theme-label"
          >
            {THEMES.map((th) => (
              <button
                key={th.id}
                type="button"
                className="theme-opt"
                aria-pressed={th.id === theme}
                onClick={() => setTheme(th.id)}
              >
                <span
                  className="theme-sw"
                  style={
                    {
                      '--a': th.swatch[0],
                      '--b': th.swatch[1],
                    } as React.CSSProperties
                  }
                />
                {th.label}
              </button>
            ))}
          </div>
          <div className="dd-label">{t('Appearance')}</div>
          <Seg
            label={t('Appearance')}
            options={MODES}
            value={mode}
            onChange={setMode}
          />
          <div className="dd-label">Language · 语言</div>
          <Seg
            label="Language · 语言"
            options={LANGUAGES}
            value={lang}
            onChange={async (next) => {
              if (next === lang) return;
              // Kept with the account too, so it follows the person to other browsers.
              await api.savePreferences({ language: next }).catch(() => {});
              setLang(next);
            }}
          />
          <div className="dd-sep" />
          <Link className="ws-item" to={`/${login}`} onClick={close}>
            <span>
              <b>{t('Your profile')}</b>
            </span>
          </Link>
          <Link className="ws-item" to="/repos" onClick={close}>
            <span>
              <b>{t('Your repositories')}</b>
            </span>
          </Link>
          <Link className="ws-item" to="/settings/tokens" onClick={close}>
            <span>
              <b>{t('Settings')}</b>
              <span className="sub">{t('Tokens, MCP server, emails')}</span>
            </span>
          </Link>
          {user.role === 'admin' && (
            <Link className="ws-item" to="/admin" onClick={close}>
              <span>
                <b>{t('Site admin')}</b>
              </span>
            </Link>
          )}
          <div className="dd-sep" />
          <button
            type="button"
            className="ws-item"
            onClick={async () => {
              close();
              await signOut();
              navigate('/login');
            }}
          >
            <span>
              <b>{t('Sign out')}</b>
            </span>
          </button>
        </div>
      )}
    </span>
  );
}
