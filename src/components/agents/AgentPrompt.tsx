// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { SparkleFillIcon } from '@primer/octicons-react';
import type { RepoDetail } from '@/lib/api/uiApi';
import { agentPrompt, importFromGitHubPrompt } from '@/lib/agents/agentPrompt';
import { CopyButton } from '@/components/ui/CopyButton';
import { useAppName } from '@/lib/utils/appName';
import { t, tx } from '@/lib/i18n/i18n';

const claudeLink = (
  <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
    Claude Code
  </a>
);

/** Copy-paste coding-agent prompt: `work` on the repository, or `import` one from GitHub. */
export function AgentPrompt({
  repo,
  compact = false,
  kind = 'work',
}: {
  repo: RepoDetail;
  compact?: boolean;
  kind?: 'work' | 'import';
}) {
  const appName = useAppName();
  const origin = window.location.origin;
  const prompt =
    kind === 'import'
      ? importFromGitHubPrompt(repo, origin, appName)
      : agentPrompt(repo, origin, appName);
  return (
    <div className="agent-prompt">
      {!compact && (
        <p className="small muted">
          {kind === 'import'
            ? tx(
                'No command line needed. Paste this into {claude} or another coding agent, and it will copy your GitHub repository here — every branch, tag, and Git LFS file — then either keep it in sync with GitHub or switch your everyday work over.',
                { claude: claudeLink }
              )
            : tx(
                'No command line needed. Paste this into {claude} or another coding agent, and it will set up the repository on your computer, including Git LFS for large files, then help you make changes and open pull requests.',
                { claude: claudeLink }
              )}
        </p>
      )}
      <div className="promptbox">
        <div className="promptbox-head">
          <span className="small muted mono">{t('Prompt')}</span>
          <CopyButton
            text={prompt}
            label={t('Copy prompt')}
            className="btn small quiet"
          />
        </div>
        <pre
          className={compact ? 'promptbox-text compact' : 'promptbox-text'}
          tabIndex={0}
        >
          {prompt}
        </pre>
      </div>
      {compact && (
        <p className="small muted agent-prompt-hint">
          <SparkleFillIcon size={12} />{' '}
          {t('Paste into Claude Code or another coding agent.')}
        </p>
      )}
    </div>
  );
}
