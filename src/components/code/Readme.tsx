// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { BookIcon } from '@primer/octicons-react';
import { t } from '@/lib/i18n/i18n';
import { isMarkdownPath } from '@/lib/repo/codeView';
import type { RepoDetail } from '@/lib/api/uiApi';
import { MarkdownFile } from './MarkdownFile';

/** The directory's README below its files: Markdown rendered, anything else as plain text. */
export function Readme({
  repo,
  refName,
  readme,
}: {
  repo: RepoDetail;
  refName: string;
  readme: { path: string; text: string };
}) {
  return (
    <section className="readme panel" aria-label={t('README')}>
      <div className="readme-head">
        <BookIcon />
        <b>{readme.path.split('/').pop()}</b>
      </div>
      {isMarkdownPath(readme.path) ? (
        <MarkdownFile
          text={readme.text}
          repo={repo}
          refName={refName}
          path={readme.path}
        />
      ) : (
        <pre className="readme-text">{readme.text}</pre>
      )}
    </section>
  );
}
