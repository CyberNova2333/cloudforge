// The commit message rules (CONTRIBUTING.md「提交信息」), shared by the commit-msg and pre-push hooks: the same
// standard as the MagirecoCN legacy-client repository.
//
//   1. The subject is「type(scope): 中文描述」, a type from TYPES, the description after the prefix in Chinese.
//   2. The body has a「文档:」line: which docs changed, or that none are affected.
//   3. A full `Co-authored-by: Name <email>` trailer.
//
// Messages git writes itself (Merge, Revert, fixup!, squash!) pass, and so does one with a line that is exactly
// [skip-hooks] (flush left: `git commit -v` appends a diff whose context lines start with a space).
//
// Two hooks, one set of rules: commit-msg runs when a commit is made in a clone that has the hooks; pre-push is the
// backstop for commits made elsewhere and pushed in.

export const SKIP = '[skip-hooks]';
const SKIP_LINE = /^\[skip-hooks\][ \t]*$/m;
// The scissors line of `git commit -v` / commit.cleanup=scissors: the diff after it isn't part of the message.
const SCISSORS = /^#?\s*-+\s*>8\s*-+/m;
const AUTO_PREFIXES = ['Merge ', 'Revert ', 'fixup!', 'squash!'];
const CJK = /[一-鿿]/;

export const TYPES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'ci',
  'perf',
  'build',
];
const PREFIX = new RegExp(
  `^(?:${TYPES.join('|')})(?:\\([A-Za-z0-9_./-]+\\))?!?:\\s*`
);
// Looks like a prefix, but the type isn't allowed: a more specific message.
const LIKE_PREFIX = /^([A-Za-z]+)(?:\([^)]*\))?!?:/;
const CO_AUTHOR = /^Co-authored-by:\s*\S[^<>\n]*<[^<>\s]+@[^<>\s]+>/m;
const DOCS_LINE = /^文档[:：]/m;

/**
 * The subject and the body. `dropComments` only for commit-msg, which reads the editor buffer (git drops its `#`
 * lines); pre-push reads finished messages, where a `#` line is content (a Markdown heading).
 */
export function normalize(raw, dropComments) {
  const cut = raw.search(SCISSORS);
  const text = cut >= 0 ? raw.slice(0, cut) : raw;
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  if (dropComments) lines = lines.filter((l) => !l.startsWith('#'));
  const subject = (lines.find((l) => l.trim()) ?? '').trim();
  return { subject, body: lines.join('\n') };
}

/** What is wrong with the message, one explanation each; [] when it follows the rules. */
export function problems(raw, dropComments = false) {
  const { subject, body } = normalize(raw, dropComments);
  if (AUTO_PREFIXES.some((p) => subject.startsWith(p))) return [];
  if (SKIP_LINE.test(body)) return [];

  const out = [];
  const shown = subject.slice(0, 72);
  if (!subject) out.push('提交信息是空的');
  else {
    const m = PREFIX.exec(subject);
    if (!m) {
      const like = LIKE_PREFIX.exec(subject);
      out.push(
        like
          ? `Conventional 类型不在允许表内: ${like[1]}\n      允许的 type: ${TYPES.join(' ')}\n      当前标题: ${shown}`
          : `标题必须是「type(scope): 中文描述」\n      允许的 type: ${TYPES.join(' ')}\n      例如: fix(actions): 修复矩阵展开时的空作业\n      当前标题: ${shown}`
      );
    } else if (!CJK.test(subject.slice(m[0].length))) {
      out.push(`前缀之后的描述必须用**中文**\n      当前标题: ${shown}`);
    }
  }
  if (!CO_AUTHOR.test(body))
    out.push(
      '缺（或格式不对的）Co-authored-by trailer\n' +
        '      必须是完整的 Name <email> 形式，末尾加一行，例如:\n' +
        '        Co-authored-by: Claude <noreply@anthropic.com>\n' +
        '        Co-authored-by: Codex <noreply@openai.com>\n' +
        '      「Co-authored-by: x」这种半截写法不算数。'
    );
  if (!DOCS_LINE.test(body))
    out.push(
      '缺「文档:」交代\n' +
        '      写明对应文档改动，或明确写不影响，例如:\n' +
        '        文档: 已更新 docs/configuration.md 的 Secrets 表\n' +
        '        文档: 纯内部重构，不影响任何文档描述'
    );
  return out;
}

export const RULES_SOURCE = 'CONTRIBUTING.md「提交信息」';
