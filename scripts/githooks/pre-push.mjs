// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// pre-push hook (husky: .husky/pre-push): every commit this push adds to the remote must follow
// scripts/githooks/rules.mjs. The backstop for commits made where the commit-msg hook never ran.
// Only commits the remote doesn't have yet are checked; history already pushed (the upstream's included) isn't.
// Inspection failures block publication, including invalid configured historical proofs.
import { execFileSync, spawnSync } from 'node:child_process';
import { readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { problems, RULES_SOURCE } from './rules.mjs';

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
  const remoteUrl = process.argv[3] || '';
  const buffer = Buffer.alloc(64 * 1024 + 1);
  let length = 0;
  while (length < buffer.length) {
    const read = readSync(0, buffer, length, buffer.length - length, null);
    if (!read) break;
    length += read;
  }
  if (length > 64 * 1024) throw new Error('pre-push 引用输入超过预算');
  const input = buffer.subarray(0, length);
  const validator = fileURLToPath(
    new URL('./history_metadata_proof.py', import.meta.url)
  );
  const python = [['python3'], ['python'], ['py', '-3']].find(
    ([command, ...prefix]) =>
      spawnSync(command, [
        ...prefix,
        '-c',
        'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)',
      ]).status === 0
  );
  if (!python) throw new Error('pre-push 需要 Python 3.10+');
  const [command, ...prefix] = python;
  const proof = JSON.parse(
    execFileSync(
      command,
      [...prefix, '-B', '-X', 'utf8', validator, remote, remoteUrl],
      {
        input,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }
    )
  );
  const historical = new Set(proof.style_exempt_commits);
  const lines = input.toString('utf8').split('\n').filter(Boolean);
  const bad = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (
      fields.length !== 4 ||
      !/^[a-f0-9]{40}$/.test(fields[1]) ||
      !/^[a-f0-9]{40}$/.test(fields[3])
    )
      throw new Error('pre-push 输入不是有效四列引用协议');
    const [, localSha, , remoteSha] = fields;
    if (!localSha || ZERO.test(localSha)) continue; // a deletion
    for (const sha of newCommits(remote, localSha, remoteSha)) {
      if (historical.has(sha)) continue;
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
    '  改正新提交的信息；经审计的导入历史可使用绑定本次引用协议的签名元数据证明。\n\n'
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(
    `\n✘ pre-push: 检查无法完成，推送已阻止：\n${e?.message ?? e}\n`
  );
  process.exitCode = 1;
}
