import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module, no types
import { problems } from '../rules.mjs';

const OK = `feat(actions): 新增 Secrets 与 Variables

工作流可以读取仓库级和实例级的值。

文档: 已更新 docs/configuration.md 的 Secrets 表

Co-authored-by: Claude <noreply@anthropic.com>
`;

describe('commit message rules (legacy-client standard)', () => {
  it('passes a message that follows them', () => {
    expect(problems(OK)).toEqual([]);
    // A full-width colon, a breaking-change mark and no scope are fine too.
    expect(
      problems(
        OK.replace('feat(actions):', 'refactor!:').replace('文档:', '文档：')
      )
    ).toEqual([]);
  });

  it.each([
    [
      'an English subject',
      OK.replace('新增 Secrets 与 Variables', 'add secrets'),
      /必须用\*\*中文\*\*/,
    ],
    [
      'no prefix',
      OK.replace('feat(actions): ', ''),
      /标题必须是「type\(scope\): 中文描述」/,
    ],
    [
      'a type not in the list',
      OK.replace('feat(actions)', 'feature(actions)'),
      /类型不在允许表内: feature/,
    ],
    [
      'no 文档 line',
      OK.replace('文档: 已更新 docs/configuration.md 的 Secrets 表\n', ''),
      /缺「文档:」交代/,
    ],
    [
      'no Co-authored-by',
      OK.replace('Co-authored-by: Claude <noreply@anthropic.com>\n', ''),
      /Co-authored-by trailer/,
    ],
    [
      'a half Co-authored-by',
      OK.replace('Claude <noreply@anthropic.com>', 'Claude'),
      /Co-authored-by trailer/,
    ],
  ])('stops %s', (_, raw, message) => {
    const found = problems(raw);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(message);
  });

  it('lets through what git writes itself, and a flush-left [skip-hooks]', () => {
    expect(problems("Merge branch 'x' into main\n")).toEqual([]);
    expect(problems('Revert "feat: x"\n')).toEqual([]);
    expect(problems('fixup! feat(ui): 改按钮\n')).toEqual([]);
    expect(problems('docs: fix a typo\n\n[skip-hooks]\n')).toEqual([]);
    // Indented, as a diff context line of `git commit -v` would be: not a skip.
    expect(problems('docs: fix a typo\n\n [skip-hooks]\n')).not.toEqual([]);
  });

  it('ignores the diff after the scissors line, and git comments only in commit-msg mode', () => {
    const scissors =
      'docs: fix a typo\n# ------------------------ >8 ------------------------\n[skip-hooks]\n';
    expect(problems(scissors, true)).not.toEqual([]);
    const commented = `# Please enter the commit message\n${OK}`;
    expect(problems(commented, true)).toEqual([]);
    // pre-push reads finished messages: a first line starting with # is the subject.
    expect(problems(commented, false)).not.toEqual([]);
  });
});

describe('the pre-push hook', () => {
  const hook = resolve(__dirname, '../pre-push.mjs');
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (message: string) => {
    writeFileSync(join(dir, 'f'), message);
    git('add', 'f');
    git(
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      message
    );
    return git('rev-parse', 'HEAD');
  };
  const push = (localSha: string, remoteSha: string) =>
    spawnSync('node', [hook, 'origin'], {
      cwd: dir,
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
      encoding: 'utf8',
    });

  it('checks only the commits the remote does not have', () => {
    dir = mkdtempSync(join(tmpdir(), 'cf-prepush-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    const old = commit('an old English commit already on the remote');
    const good = commit(OK);
    expect(push(good, old).status).toBe(0);
    const bad = commit('fix: forgot everything');
    const r = push(bad, old);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('fix: forgot everything');
    expect(r.stderr).not.toContain('an old English commit');
    // A deletion pushes no commits.
    expect(push('0'.repeat(40), bad).status).toBe(0);
  });
});
