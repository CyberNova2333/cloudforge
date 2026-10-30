// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let directory: string;
const notice =
  '// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).';
const generated = '/* eslint-disable */\ninterface Generated {}\n';
const script = fileURLToPath(new URL('../cf-typegen.mjs', import.meta.url));
const original =
  '// local configuration stays byte-for-byte intact\r\n{"local":true}\r\n';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cloudforge typegen '));
  writeFileSync(join(directory, 'wrangler.jsonc'), original);
  writeFileSync(join(directory, 'wrangler.jsonc.ci'), '{"ci":true}\n');
  writeFileSync(
    join(directory, 'fake-yarn.cjs'),
    `const fs = require('node:fs');
fs.writeFileSync('trace.json', JSON.stringify(process.argv.slice(2)));
const code = Number(process.env.TYPEGEN_TEST_EXIT || 0);
if (!code && !process.env.TYPEGEN_TEST_MISSING) {
  fs.mkdirSync('worker', { recursive: true });
  fs.writeFileSync('worker/worker-configuration.d.ts', process.env.TYPEGEN_TEST_PREFIX ? ${JSON.stringify(notice + '\n' + generated)} : ${JSON.stringify(generated)});
}
process.exit(code);`
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function run(extra: Record<string, string> = {}) {
  // Windows environment keys are case-insensitive; remove Yarn's upper-case aliases before replacing values.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        ![
          'npm_config_user_agent',
          'npm_execpath',
          'typegen_test_exit',
          'typegen_test_missing',
          'typegen_test_prefix',
        ].includes(key.toLowerCase())
    )
  );
  return spawnSync(process.execPath, [script], {
    cwd: directory,
    env: {
      ...inherited,
      npm_config_user_agent: 'yarn/1.22.22',
      npm_execpath: join(directory, 'fake-yarn.cjs'),
      ...extra,
    },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
}
function preserved() {
  expect(readFileSync(join(directory, 'wrangler.jsonc'), 'utf8')).toBe(
    original
  );
  expect(existsSync(join(directory, '.wrangler.jsonc.local-backup'))).toBe(
    false
  );
}
describe('绑定类型生成的跨平台执行与本地配置保护', () => {
  it('通过实际Yarn生命周期JS入口传递类型参数，不执行临时cmd文本', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8'))
    ).toEqual([
      'wrangler',
      'types',
      'worker/worker-configuration.d.ts',
      '--env-interface',
      'CloudflareBindings',
    ]);
    preserved();
    expect(
      readFileSync(join(directory, 'worker/worker-configuration.d.ts'), 'utf8')
    ).toBe(notice + '\n' + generated);
  });
  it('重新生成带已有版权头的产物时不重复添加', () => {
    expect(run({ TYPEGEN_TEST_PREFIX: '1' }).status).toBe(0);
    expect(
      readFileSync(join(directory, 'worker/worker-configuration.d.ts'), 'utf8')
    ).toBe(notice + '\n' + generated);
    preserved();
  });
  it('工具零退出但未写出类型文件时不能报告生成成功，仍恢复配置', () => {
    expect(run({ TYPEGEN_TEST_MISSING: '1' }).status).not.toBe(0);
    preserved();
  });
  it('工具返回失败仍还原本地配置并传播真实失败码', () => {
    expect(run({ TYPEGEN_TEST_EXIT: '7' }).status).toBe(7);
    preserved();
  });
  it('拒绝不可用生命周期入口，配置交换后异常仍恢复原文件', () => {
    expect(
      run({ npm_execpath: join(directory, 'missing.cjs') }).status
    ).not.toBe(0);
    expect(existsSync(join(directory, 'trace.json'))).toBe(false);
    preserved();
  });
  it('发现旧备份先拒绝，既不覆盖备份也不调用工具', () => {
    writeFileSync(
      join(directory, '.wrangler.jsonc.local-backup'),
      'retained backup'
    );
    expect(run().status).toBe(1);
    expect(
      readFileSync(join(directory, '.wrangler.jsonc.local-backup'), 'utf8')
    ).toBe('retained backup');
    expect(readFileSync(join(directory, 'wrangler.jsonc'), 'utf8')).toBe(
      original
    );
    expect(existsSync(join(directory, 'trace.json'))).toBe(false);
  });
  it('没有手写配置时，完成后清除临时CI配置', () => {
    rmSync(join(directory, 'wrangler.jsonc'));
    expect(run().status).toBe(0);
    expect(existsSync(join(directory, 'wrangler.jsonc'))).toBe(false);
    expect(existsSync(join(directory, '.wrangler.jsonc.local-backup'))).toBe(
      false
    );
  });
});
