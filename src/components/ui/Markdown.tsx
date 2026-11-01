// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  repoImageSrc,
  repoLinkHref,
  type RepoMarkdownContext,
} from '@/lib/repo/repoUrls';
import { t } from '@/lib/i18n/i18n';
import { renderMermaid } from '@/lib/ui/mermaid';
import { markedWithRefs } from '@/lib/issues/issueRefs';

marked.setOptions({ gfm: true, breaks: false });

/**
 * DOMPurify for user Markdown (READMEs, pull requests, comments): on top of its defaults (no scripts), nothing that
 * can restyle or cover the page or pass for the app's own UI: no `<style>` or `style`, no forms or form controls but
 * a task list's read-only checkbox, and only the `language-*` classes Markdown gives code blocks (the app's utility
 * classes could pin a fake page over the real one). Its own instance: the hooks stay off Mermaid's SVG sanitizer.
 */
const purify = DOMPurify(window);
purify.setConfig({
  FORBID_TAGS: [
    'style',
    'form',
    'button',
    'textarea',
    'select',
    'option',
    'optgroup',
    'datalist',
    'fieldset',
    'output',
  ],
  FORBID_ATTR: ['style', 'action', 'formaction', 'form'],
});
purify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  if (node.hasAttribute('class')) {
    const kept = [...node.classList].filter((c) =>
      /^language-[\w+#.-]+$/.test(c)
    );
    if (kept.length) node.setAttribute('class', kept.join(' '));
    else node.removeAttribute('class');
  }
  if (node.tagName === 'INPUT') {
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

/** Renders ```mermaid blocks in `root`; unparseable blocks stay as source with a note. */
async function renderDiagrams(root: HTMLElement) {
  const blocks = [
    ...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  ];
  if (!blocks.length) return;
  for (const code of blocks) {
    const pre = code.parentElement!;
    if (!pre.isConnected) continue;
    const source = code.textContent ?? '';
    try {
      const svg = await renderMermaid(source);
      const figure = document.createElement('div');
      figure.className = 'mermaid-diagram';
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch {
      const note = document.createElement('div');
      note.className = 'f6 color-fg-muted mt-n2 mb-3';
      note.textContent = t(
        "This diagram couldn't be drawn; showing its source."
      );
      pre.after(note);
    }
  }
}

/** Colors the lines of ```diff blocks: additions green, removals red. */
function colorDiffs(root: HTMLElement) {
  for (const code of root.querySelectorAll<HTMLElement>(
    'pre > code.language-diff:not([data-colored])'
  )) {
    const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n');
    code.textContent = '';
    for (const line of lines) {
      const span = document.createElement('span');
      span.className =
        line[0] === '+'
          ? 'diff-line diff-line-add'
          : line[0] === '-'
            ? 'diff-line diff-line-del'
            : 'diff-line';
      span.textContent = line;
      code.append(span);
    }
    code.dataset.colored = 'true';
  }
}

/** Resolves relative images and links inside an inert <template>, before anything loads. */
function rewriteRepoUrls(html: string, repo: RepoMarkdownContext): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src = repoImageSrc(repo, img.getAttribute('src')!);
    if (src) img.setAttribute('src', src);
  }
  for (const a of tpl.content.querySelectorAll('a[href]')) {
    const href = repoLinkHref(repo, a.getAttribute('href')!);
    if (!href) continue;
    a.setAttribute('href', href);
    a.setAttribute('data-repo-link', '');
  }
  return tpl.innerHTML;
}

export function Markdown({
  source,
  className = '',
  repo,
  refs,
}: {
  source: string;
  className?: string;
  /** Set for a Markdown file in a repository: resolves its relative links and images. */
  repo?: RepoMarkdownContext;
  /** Set where `#12` means an issue or pull request of this repository (`/owner/repo`): links them. */
  refs?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { owner, repo: name, ref: gitRef, dir } = repo ?? {};
  const html = useMemo(() => {
    const clean = purify.sanitize(
      (refs ? markedWithRefs(refs) : marked).parse(source, {
        async: false,
      }) as string
    );
    return owner !== undefined
      ? rewriteRepoUrls(clean, { owner, repo: name!, ref: gitRef!, dir: dir! })
      : clean;
  }, [source, owner, name, gitRef, dir, refs]);
  useEffect(() => {
    if (!ref.current) return;
    colorDiffs(ref.current);
    void renderDiagrams(ref.current);
  }, [html]);
  // Links into the repository navigate inside the app instead of reloading the page.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as HTMLElement).closest('a[data-repo-link]');
    if (!a || a.getAttribute('target')) return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
  };
  return (
    <div
      ref={ref}
      className={`markdown-body ${className}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
