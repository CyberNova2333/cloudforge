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

describe('提交信息规则（与 legacy-client 同一标准）', () => {
  it('符合规则的提交信息通过', () => {
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

  it('放行 git 自动生成的信息和顶格独占一行的 [skip-hooks]', () => {
    expect(problems("Merge branch 'x' into main\n")).toEqual([]);
    expect(problems('Revert "feat: x"\n')).toEqual([]);
    expect(problems('fixup! feat(ui): 改按钮\n')).toEqual([]);
    expect(problems('docs: fix a typo\n\n[skip-hooks]\n')).toEqual([]);
    // Indented, as a diff context line of `git commit -v` would be: not a skip.
    expect(problems('docs: fix a typo\n\n [skip-hooks]\n')).not.toEqual([]);
  });

  it('忽略剪刀线之后的 diff，且只在 commit-msg 模式下忽略 git 注释', () => {
    const scissors =
      'docs: fix a typo\n# ------------------------ >8 ------------------------\n[skip-hooks]\n';
    expect(problems(scissors, true)).not.toEqual([]);
    const commented = `# Please enter the commit message\n${OK}`;
    expect(problems(commented, true)).toEqual([]);
    // pre-push reads finished messages: a first line starting with # is the subject.
    expect(problems(commented, false)).not.toEqual([]);
  });
});

describe('pre-push 钩子', () => {
  const hook = resolve(__dirname, '../pre-push.mjs');
  let dir = '';
  afterEach(() => {
    if (!dir) return;
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      // Windows 的 Git 子进程可能延迟释放临时目录；不掩盖实际钩子断言。
      if (
        process.platform !== 'win32' ||
        (error as NodeJS.ErrnoException).code !== 'EPERM'
      ) {
        throw error;
      }
    }
  });

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
  const push = (localSha: string, remoteSha: string, remote = 'origin') =>
    spawnSync(process.execPath, [hook, remote], {
      cwd: dir,
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
      encoding: 'utf8',
    });

  it('只检查远端还没有的提交', () => {
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

  it('首次推送 GitHub 镜像时保留并排除上游原作历史', () => {
    dir = mkdtempSync(join(tmpdir(), 'cf-prepush-mirror-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    const upstream = commit('Crew redesign: original upstream history');
    git('update-ref', 'refs/remotes/upstream/main', upstream);
    const fork = commit(OK);
    expect(push(fork, '0'.repeat(40), 'github').status).toBe(0);
    expect(push(fork, '0'.repeat(40), 'origin').status).toBe(1);
  });
});
