/**
 * `#12` in Markdown written in a repository (issues, pull requests, comments) as a link to issue or pull request 12.
 * They share numbers, so every link goes to `issues/<n>`, which forwards to the pull request when it is one. A `#12`
 * inside a word, a URL, an HTML entity, code or another link stays text.
 */
import { Marked, type MarkedExtension, type Tokens } from 'marked';

/** Where the next reference may start: `#` and a digit, after a space, punctuation or the start. */
const START = /(^|[^\w&#/])#\d/;
const REF = /^#(\d{1,9})(?![\w-])/;

type IssueRefToken = Tokens.Generic & { number: number };

/** A marked extension linking `#N` under `base` (`/owner/repo`, already URL-encoded). */
export function issueRefExtension(base: string): MarkedExtension {
  return {
    extensions: [
      {
        name: 'issueRef',
        level: 'inline',
        start(src: string) {
          const m = START.exec(src);
          return m ? m.index + m[1].length : undefined;
        },
        tokenizer(src: string): IssueRefToken | undefined {
          // A link's text is already a link.
          if (this.lexer.state.inLink) return undefined;
          const m = REF.exec(src);
          if (!m || !Number(m[1])) return undefined;
          return { type: 'issueRef', raw: m[0], number: Number(m[1]) };
        },
        renderer(token) {
          const n = (token as IssueRefToken).number;
          return `<a href="${base}/issues/${n}" data-repo-link="">#${n}</a>`;
        },
      },
    ],
  };
}

const cache = new Map<string, Marked>();

/** A Markdown renderer with the default options plus `#N` links under `base`; one per repository. */
export function markedWithRefs(base: string): Marked {
  let m = cache.get(base);
  if (!m) {
    m = new Marked({ gfm: true, breaks: false }, issueRefExtension(base));
    cache.set(base, m);
  }
  return m;
}
