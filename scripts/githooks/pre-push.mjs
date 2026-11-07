// pre-push hook (husky: .husky/pre-push): every commit this push adds to the remote must follow
// scripts/githooks/rules.mjs. The backstop for commits made where the commit-msg hook never ran.
// Only commits the remote doesn't have yet are checked; history already pushed (the upstream's included) isn't.
// Any failure of the check itself lets the push through with a note.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { problems, RULES_SOURCE, SKIP } from './rules.mjs';

const ZERO = /^0+$/;
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function hasObject(sha) {
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** The commits `localSha` brings that the remote doesn't have, oldest first. */
function newCommits(remote, localSha, remoteSha) {
  const firstMirror =
    ZERO.test(remoteSha) &&
    remote === 'github' &&
    hasObject('refs/remotes/upstream/main');
  const range =
    !ZERO.test(remoteSha) && hasObject(remoteSha)
      ? [`${remoteSha}..${localSha}`]
      : firstMirror
        ? [localSha, '^refs/remotes/upstream/main']
        : [localSha, '--not', `--remotes=${remote}`];
  const out = git('rev-list', '--reverse', ...range).trim();
  return out ? out.split('\n') : [];
}

function main() {
  const remote = process.argv[2] || 'origin';
  const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const bad = [];
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (!localSha || ZERO.test(localSha)) continue; // a deletion
    for (const sha of newCommits(remote, localSha, remoteSha)) {
      const found = problems(git('log', '-1', '--format=%B', sha), false);
      if (found.length)
        bad.push({
          sha,
          subject: git('log', '-1', '--format=%s', sha).trim(),
          found,
        });
    }
  }
  if (!bad.length) return 0;
  process.stderr.write(
    `\n✘ 推送被 pre-push 钩子拦下：${bad.length} 个提交的信息不合规范\n\n`
  );
  for (const b of bad) {
    process.stderr.write(`  ${b.sha.slice(0, 9)} ${b.subject.slice(0, 72)}\n`);
    b.found.forEach((p, i) => process.stderr.write(`    ${i + 1}. ${p}\n`));
    process.stderr.write('\n');
  }
  process.stderr.write(`  规则出处: ${RULES_SOURCE}\n`);
  process.stderr.write(
    `  改正: git rebase -i 后用 reword 改写这些提交的信息；确需跳过时在信息里顶格独占一行写 ${SKIP}\n\n`
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(
    `\n⚠ pre-push: 检查自身出错，本次放行。请把下面这段贴给维护者：\n${e?.stack ?? e}\n`
  );
  process.exitCode = 0;
}
