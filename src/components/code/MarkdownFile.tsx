// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useMemo } from 'react';
import { t } from '@/lib/i18n/i18n';
import { Markdown } from '@/components/ui/Markdown';
import { dirOf, type RepoMarkdownContext } from '@/lib/repo/repoUrls';
import { splitFrontmatter } from '@/lib/repo/codeView';
import type { RepoDetail } from '@/lib/api/uiApi';

/** Lets a repository Markdown file resolve its relative links and images. */
export const markdownContext = (
  repo: RepoDetail,
  ref: string,
  path: string
): RepoMarkdownContext => ({
  owner: repo.owner.username,
  repo: repo.name,
  ref,
  dir: dirOf(path),
});

/**
 * A repository Markdown file, rendered. A leading YAML block (an agent's AGENT.md starts with its settings) is
 * shown as a quiet block of its own above the text, not as Markdown.
 */
export function MarkdownFile({
  text,
  repo,
  refName,
  path,
}: {
  text: string;
  repo: RepoDetail;
  refName: string;
  path: string;
}) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(text), [text]);
  return (
    <div className="md">
      {frontmatter !== null && (
        <details className="frontmatter" open>
          <summary>{t('Front matter')}</summary>
          <pre>{frontmatter}</pre>
        </details>
      )}
      <Markdown source={body} repo={markdownContext(repo, refName, path)} />
    </div>
  );
}
