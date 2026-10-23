// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkoutSource, packageSource } from '../source.ts';
import { fakePackage, fakeRunner } from './fakes.ts';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'source-')));

describe('checkoutSource：源码来源', () => {
  const s = checkoutSource('/r');
  it('通过 Yarn 运行 wrangler', () => {
    expect(s.wrangler(['secret', 'list'], '/r')).toEqual({
      cmd: 'yarn',
      args: ['-s', 'wrangler', 'secret', 'list'],
    });
    expect(s.wranglerCommand('d1 list')).toBe('yarn wrangler d1 list');
    expect(s.wranglerBare(['auth', 'token'])).toEqual({
      cmd: 'yarn',
      args: ['-s', 'wrangler', 'auth', 'token'],
    });
  });
  it('部署', () => {
    expect(s.deploy('/r', null)).toEqual({
      cmd: 'yarn',
      args: ['-s', 'deploy'],
    });
    expect(s.deploy('/r', '/tmp/s.json').args).toEqual([
      '-s',
      'deploy',
      '--secrets-file',
      '/tmp/s.json',
    ]);
  });
  it('命令及为空的软件包字段', () => {
    expect(s.command('install --resume --name acme')).toBe(
      'yarn cloudforge install --resume --name acme'
    );
    expect(s.commit).toBeNull();
    expect(s.build).toBeNull();
  });
  it('版本使用短 SHA，有改动时附加 -dirty', async () => {
    const runner = fakeRunner({
      'git rev-parse': () => ({
        code: 0,
        stdout: 'abc123def456\n',
        stderr: '',
      }),
      'git status': () => ({ code: 0, stdout: ' M x\n', stderr: '' }),
    });
    expect(await s.version(runner)).toBe('abc123def456-dirty');
  });
});

describe.each(['nested', 'hoisted'] as const)(
  'packageSource：软件包来源（%s）',
  (layout) => {
    const setup = () => {
      const root = fakePackage(tmp(), {
        version: '1.2.0',
        commit: 'abc123def456',
        wranglerLayout: layout,
      });
      return { root, s: packageSource(root) };
    };
    const binOf = (root: string) =>
      layout === 'nested'
        ? join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
        : join(root, '..', 'wrangler', 'bin', 'wrangler.js');

    it('wrangler 运行自带可执行文件', () => {
      const { root, s } = setup();
      expect(
        s.wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], '/home/x')
      ).toEqual({
        cmd: process.execPath,
        args: [
          realpathSync(binOf(root)),
          'd1',
          'migrations',
          'apply',
          'DB',
          '--remote',
          '--config',
          '/home/x/wrangler.jsonc',
        ],
      });
      expect(s.wranglerCommand('tail')).toBe('npx wrangler@4.127.0 tail');
    });
    it('wranglerBare 运行自带可执行文件且不传 --config', () => {
      const { root, s } = setup();
      expect(s.wranglerBare(['auth', 'token'])).toEqual({
        cmd: process.execPath,
        args: [realpathSync(binOf(root)), 'auth', 'token'],
      });
    });
    it('部署', () => {
      const { root, s } = setup();
      const bin = realpathSync(binOf(root));
      expect(s.deploy('/home/x', null)).toEqual({
        cmd: process.execPath,
        args: [bin, 'deploy', '--config', '/home/x/wrangler.jsonc'],
      });
      expect(s.deploy('/home/x', '/tmp/s.json').args).toEqual([
        bin,
        'deploy',
        '--config',
        '/home/x/wrangler.jsonc',
        '--secrets-file',
        '/tmp/s.json',
      ]);
    });
    it('版本、提交和构建', async () => {
      const { root, s } = setup();
      const runner = fakeRunner({});
      expect(await s.version(runner)).toBe('1.2.0');
      expect(runner.calls).toHaveLength(0);
      expect(s.commit).toBe('abc123def456');
      expect(s.build?.main).toBe(join(root, 'worker', 'index.js'));
      expect(s.build?.assetsDir).toBe(join(root, 'client'));
      expect(s.build?.moduleConfig.no_bundle).toBe(true);
      expect(s.templatePath).toBe(join(root, 'wrangler.jsonc.example'));
      expect(s.migrationsDir).toBe(join(root, 'migrations'));
    });
    it('软件包构建包含运行器 Dockerfile', () => {
      const { root, s } = setup();
      expect(s.build?.runnerDockerfile).toBe(
        join(root, 'actions', 'runner', 'Dockerfile')
      );
    });
    it('moduleConfig 移除以路径为值的键（base_dir）', () => {
      const { root } = setup();
      writeFileSync(
        join(root, 'worker', 'build.json'),
        JSON.stringify({ no_bundle: true, base_dir: '/build/worker' })
      );
      const s = packageSource(root);
      expect(s.build?.moduleConfig).toEqual({ no_bundle: true });
    });
    it('命令', () => {
      expect(setup().s.command('install --resume --name acme')).toBe(
        'npx @cybernova2333/cloudforge@1.2.0 install --resume --name acme'
      );
    });
  }
);
