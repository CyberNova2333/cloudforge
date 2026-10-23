// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { CodeIcon, TriangleDownIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { t, tx } from '@/lib/i18n';
import type { RepoDetail } from '@/lib/uiApi';
import { Seg } from './ui/Seg';
import { AgentPrompt } from './AgentPrompt';
import { Dropdown } from './Dropdown';
import { CopyButton } from './CopyButton';

/** The "Code" button: a menu with the HTTPS clone URL, or a prompt to paste into a coding agent. */
export function CloneButton({ repo }: { repo: RepoDetail }) {
  const url = repo.cloneUrl;
  const [tab, setTab] = useState<'https' | 'agent'>('https');
  return (
    <Dropdown
      align="right"
      width={tab === 'agent' ? 520 : 400}
      className="clone-menu"
      trigger={(open, toggle) => (
        <button
          type="button"
          className="btn primary small"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={toggle}
        >
          <CodeIcon /> {t('Code')} <TriangleDownIcon />
        </button>
      )}
    >
      {() => (
        <div className="clone-body">
          <div className="clone-head">
            <b>{t('Clone')}</b>
            <Seg<'https' | 'agent'>
              label={t('Clone with')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'https', label: 'HTTPS' },
                { value: 'agent', label: t('AI agent') },
              ]}
            />
          </div>
          {tab === 'agent' ? (
            <AgentPrompt repo={repo} compact />
          ) : (
            <>
              <div className="clone-url">
                <input
                  className="form-control input-monospace input-sm"
                  readOnly
                  aria-label={t('HTTPS clone URL')}
                  value={url}
                  onFocus={(e) => e.target.select()}
                />
                <CopyButton
                  text={url}
                  className="btn small"
                  label={t('Copy clone URL')}
                />
              </div>
              {repo.visibility === 'public' ? (
                <p className="small muted">
                  {tx(
                    'Anyone can clone this public repository without a token. To push, use a {token} as your password. Large files use Git LFS.',
                    {
                      token: (
                        <Link to="/settings/tokens">
                          {t('personal access token')}
                        </Link>
                      ),
                    }
                  )}
                </p>
              ) : (
                <p className="small muted">
                  {tx(
                    'Use a {token} as your password. Large files use Git LFS.',
                    {
                      token: (
                        <Link to="/settings/tokens">
                          {t('personal access token')}
                        </Link>
                      ),
                    }
                  )}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Dropdown>
  );
}
