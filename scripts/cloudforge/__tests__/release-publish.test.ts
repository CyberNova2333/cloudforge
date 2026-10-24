// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  checkTag,
  missingCommands,
  packageSmoke,
  preflight,
  worktreeAddArgs,
} from '../release-publish.ts';
import type { Runner } from '../runner.ts';

const SHA = 'a'.repeat(40);
function runner(o: { tag?: boolean; onMain?: boolean; revFails?: boolean }) {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const r: Runner = {
    async run(cmd, args, opts) {
      calls.push({ cmd, args, cwd: opts?.cwd });
      const sub = args[2];
      const out = (code: number, stdout = '') => ({
        code,
        stdout,
        stderr: '',
      });
      if (sub === 'ls-remote')
        return out(0, o.tag === false ? '' : `${SHA}\trefs/tags/v1.2.3\n`);
      if (sub === 'merge-base') return out(o.onMain === false ? 1 : 0);
      if (sub === 'rev-parse')
        return o.revFails ? out(128) : out(0, `${SHA}\n`);
      return out(0);
    },
  };
  return { r, calls };
}
const npmStatus = (npm: number) =>
  (async () => new Response('{}', { status: npm })) as unknown as typeof fetch;
const base = { tag: 'v1.2.3', repo: '/repo' };

describe('checkTag：检查标签', () => {
  it('拒绝格式错误的标签', () => {
    for (const t of ['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'main', ''])
      expect(() => checkTag(t)).toThrow('Usage: yarn release:publish vX.Y.Z');
  });
  it('返回版本', () => expect(checkTag('v1.2.3')).toBe('1.2.3'));
});

describe('preflight：发布预检', () => {
  it('origin 缺少标签', async () => {
    const { r } = runner({ tag: false });
    await expect(
      preflight({ ...base, runner: r, fetchImpl: npmStatus(404) })
    ).rejects.toThrow('missing on origin');
  });
  it('标签不在 main 上', async () => {
    const { r } = runner({ onMain: false });
    await expect(
      preflight({ ...base, runner: r, fetchImpl: npmStatus(404) })
    ).rejects.toThrow('Tag v1.2.3 is not on main; publish only releases cut');
  });
  it('版本已发布到 npm', async () => {
    const { r } = runner({});
    await expect(
      preflight({ ...base, runner: r, fetchImpl: npmStatus(200) })
    ).rejects.toThrow('already on npm');
  });
  it('标签位于 main 上时通过', async () => {
    const { r } = runner({});
    expect(
      await preflight({ ...base, runner: r, fetchImpl: npmStatus(404) })
    ).toEqual({ commit: SHA });
  });
  it('从不读取工作副本', async () => {
    const { r, calls } = runner({});
    await preflight({ ...base, runner: r, fetchImpl: npmStatus(404) });
    for (const c of calls) {
      expect(c.cmd).toBe('git');
      expect(c.args.slice(0, 2)).toEqual(['-C', '/repo']);
      expect(c.cwd).toBeUndefined();
      expect(c.args.join(' ')).not.toMatch(/checkout|reset|merge |pull|stash/);
    }
  });
});

describe('worktreeAddArgs：工作树参数', () => {
  it('构建已验证的提交而非标签', () =>
    expect(worktreeAddArgs('/repo', '/tmp/x', SHA)).toEqual([
      '-C',
      '/repo',
      'worktree',
      'add',
      '--detach',
      '/tmp/x',
      SHA,
    ]));
});

describe('preflight：解析提交', () => {
  it('无法解析提交时拒绝', async () => {
    const { r } = runner({ revFails: true });
    await expect(
      preflight({ ...base, runner: r, fetchImpl: npmStatus(404) })
    ).rejects.toThrow('Could not resolve');
  });
});

describe('packageSmoke：软件包冒烟检查', () => {
  const o = {
    worktree: '/wt',
    pkgDir: '/wt/build/npm',
    scratch: '/s',
    name: '@cybernova2333/cloudforge',
    version: '1.2.3',
    node: '/usr/bin/node',
  };

  it('以参数数组运行 CI 软件包检查，并使用工作树的 wrangler', () => {
    const p = packageSmoke(o);
    expect(p.tarball).toBe('/s/pkg/cybernova2333-cloudforge-1.2.3.tgz');
    expect(p.steps).toEqual([
      {
        cmd: 'npm',
        args: ['pack', '/wt/build/npm', '--pack-destination', '/s/pkg'],
        cwd: '/wt',
      },
      {
        cmd: '/usr/bin/node',
        args: [
          'scripts/cloudforge/smoke-config.ts',
          '/wt/build/npm',
          '/s/smoke',
        ],
        cwd: '/wt',
      },
      {
        cmd: '/usr/bin/node',
        args: [
          '/wt/node_modules/wrangler/bin/wrangler.js',
          'deploy',
          '--dry-run',
          '--containers-rollout=none',
          '--outdir',
          '/s/o',
          '--config',
          '/s/smoke/wrangler.jsonc',
        ],
        cwd: '/wt',
      },
      { cmd: 'npm', args: ['init', '-y'], cwd: '/s/app' },
      {
        cmd: 'npm',
        args: ['install', '/s/pkg/cybernova2333-cloudforge-1.2.3.tgz'],
        cwd: '/s/app',
      },
    ]);
    expect(p.help).toEqual({
      cmd: '/s/app/node_modules/.bin/cloudforge',
      args: ['--help'],
      cwd: '/s/app',
    });
  });
});

describe('missingCommands：缺失命令', () => {
  it('列出 --help 中未出现的命令', () => {
    const help =
      'Usage: cloudforge <command>\n\n  install  Install\n  status   Show\n';
    expect(missingCommands(help)).toEqual(['upgrade', 'adopt']);
    expect(
      missingCommands('  install  a\n  upgrade  b\n  adopt  c\n  status  d\n')
    ).toEqual([]);
  });
});
