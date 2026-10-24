// Adapter for Codex's documented hook payloads. Policies remain shared with Claude.
// Do not read transcript_path or persist prompts, commands, tool results or payloads.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHookInput } from '../../.claude/hooks/_lib.mjs';
import { patchFiles } from './patch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(script, payload) {
  const result = spawnSync(
    process.execPath,
    [join(root, '.claude/hooks', script)],
    {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: script === 'typecheck.mjs' ? 310_000 : 45_000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.error?.message ||
        `${script} 退出状态：${result.status}`
    );
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout.trim()) return JSON.parse(result.stdout);
  return {};
}

try {
  const input = await readHookInput({ strict: true });
  const event = input?.hook_event_name;
  if (!['PreToolUse', 'PostToolUse', 'Stop'].includes(event))
    throw new Error('钩子输入缺少受支持的 hook_event_name。');
  if (event === 'Stop' && input.stop_hook_active) {
    process.stdout.write('{}');
    process.exit(0);
  }
  const config = JSON.parse(
    readFileSync(join(root, '.claude/hooks/hooks.config.json'), 'utf8')
  );
  if (event === 'Stop') {
    if (!config.typecheck) throw new Error('钩子配置缺少 typecheck 命令。');
    run('typecheck.mjs', input);
  } else if (event === 'PreToolUse' || event === 'PostToolUse') {
    if (event === 'PreToolUse' && !Array.isArray(config.protected))
      throw new Error('钩子配置缺少 protected 规则数组。');
    const failures = [];
    for (const file of patchFiles(input, root)) {
      const payload = { ...input, tool_input: { file_path: join(root, file) } };
      if (event === 'PreToolUse') {
        const result = run('guard-protected.mjs', payload);
        if (result.hookSpecificOutput?.permissionDecision === 'deny') {
          process.stdout.write(JSON.stringify(result));
          process.exit(0);
        }
      } else {
        for (const script of ['format-file.mjs', 'focused-tests.mjs']) {
          try {
            run(script, payload);
          } catch (error) {
            failures.push(error.message);
          }
        }
      }
    }
    if (failures.length) throw new Error(failures.join('\n\n'));
  }
  // Stop requires JSON, not plain text. An empty object is a successful no-op.
  process.stdout.write('{}');
} catch (error) {
  process.stderr.write(`CloudForge 钩子检查未通过：${error.message}\n`);
  process.exitCode = 2;
}
