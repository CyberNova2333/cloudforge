// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SparkleFillIcon } from '@primer/octicons-react';
import { t, tx } from '@/lib/i18n';
import type { RepoDetail } from '@/lib/uiApi';
import { AgentPrompt } from '@/components/AgentPrompt';
import { CopyButton } from '@/components/CopyButton';
import { Seg } from '@/components/ui/Seg';

/** A command block with its copy button. */
function Commands({ lines }: { lines: string[] }) {
  const text = lines.join('\n');
  return (
    <div className="codeblock">
      <pre>{text}</pre>
      <CopyButton
        text={text}
        className="btn small quiet"
        label={t('Copy these commands')}
      />
    </div>
  );
}

/**
 * What an empty repository shows instead of files: a prompt for a coding agent (a new project, or an import from
 * GitHub), then the same steps on the command line. Large files go through Git LFS.
 */
export function QuickSetup({ repo }: { repo: RepoDetail }) {
  const url = repo.cloneUrl;
  const [kind, setKind] = useState<'work' | 'import'>('work');
  return (
    <div className="setup-steps">
      <section className="panel setup-step setup-agent">
        <h2>
          <SparkleFillIcon /> {t('Set up with an AI agent')}
        </h2>
        <Seg<'work' | 'import'>
          label={t('What to set up')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'work', label: t('Start a new project') },
            { value: 'import', label: t('Import from GitHub') },
          ]}
        />
        <AgentPrompt repo={repo} kind={kind} />
      </section>
      <section className="panel setup-step">
        <h2>{t("Quick setup — if you've done this kind of thing before")}</h2>
        <div className="clone-url">
          <span className="chip">HTTPS</span>
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
        <p className="small muted">
          {tx(
            'Authenticate with your username and a {token} as the password.',
            {
              token: (
                <Link to="/settings/tokens">{t('personal access token')}</Link>
              ),
            }
          )}
        </p>
      </section>
      <section className="panel setup-step">
        <h2>{t('…or create a new repository on the command line')}</h2>
        <Commands
          lines={[
            `echo "# ${repo.name}" >> README.md`,
            'git init',
            'git lfs install',
            'git lfs track "*.psd" "*.zip" "*.mp4"   # large files you plan to commit',
            'git add .gitattributes README.md',
            'git commit -m "first commit"',
            'git branch -M main',
            `git remote add origin ${url}`,
            'git push -u origin main',
          ]}
        />
      </section>
      <section className="panel setup-step">
        <h2>{t('…or push an existing repository from the command line')}</h2>
        <Commands
          lines={[
            `git remote add origin ${url}`,
            'git branch -M main',
            'git push -u origin main',
          ]}
        />
      </section>
      <section className="panel setup-step">
        <h2>{t('…or import a repository from GitHub on the command line')}</h2>
        <Commands
          lines={[
            'git clone --mirror https://github.com/OWNER/REPO.git github-mirror.git',
            'cd github-mirror.git',
            'git lfs fetch --all',
            `git push --all ${url}`,
            `git push --tags ${url}`,
            `git lfs push --all ${url}`,
          ]}
        />
        <p className="small muted">
          {tx(
            'Copies every branch, tag, and Git LFS file. To sync again later, run {fetch} and {lfsFetch} in the same folder, then the three push commands.',
            {
              fetch: <code>git fetch --prune origin</code>,
              lfsFetch: <code>git lfs fetch --all origin</code>,
            }
          )}
        </p>
      </section>
      <section className="panel setup-step">
        <h2>{t('…and store large files with Git LFS')}</h2>
        <Commands
          lines={[
            'git lfs install',
            'git lfs track "*.psd"',
            'git add .gitattributes',
            'git commit -m "Track large files with Git LFS"',
            'git push',
          ]}
        />
        <p className="small muted">
          {tx(
            'Tracked files are stored outside the repository (up to 5 GB each) and shown here with their real size. Requires {lfs}.',
            {
              lfs: (
                <a href="https://git-lfs.com" target="_blank" rel="noreferrer">
                  Git LFS
                </a>
              ),
            }
          )}
        </p>
      </section>
    </div>
  );
}
