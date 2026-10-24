// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloudflareError } from '../cloudflare.ts';
import { preflight } from '../preflight.ts';
import { checkoutSource, packageSource } from '../source.ts';
import { fakeCloudflare, fakePackage, fakeRunner } from './fakes.ts';

const table = (rows: [string, string, string][]) =>
  [
    '┌──────────────┬──────────────────┬─────────┬──────────┐',
    '│ zone         │ name             │ enabled │ tag      │',
    ...rows.flatMap(([z, n, e]) => [
      '├──────────────┼──────────────────┼─────────┼──────────┤',
      `│ ${z} │ ${n} │ ${e} │ abc123   │`,
    ]),
    '└──────────────┴──────────────────┴─────────┴──────────┘',
  ].join('\n');

const okRunner = (
  emailOut = table([['example.com', 'mail.example.com', 'yes']])
) =>
  fakeRunner({
    docker: () => ({ code: 0, stdout: '27.0\n', stderr: '' }),
    yarn: () => ({ code: 0, stdout: emailOut, stderr: '' }),
  });

const input = {
  accountId: 'acc',
  hostname: null,
  workersDev: true,
  fromEmail: 'noreply@mail.example.com',
  workerName: 'cloudforge',
  source: checkoutSource('/repo'),
};

describe('preflight：预检', () => {
  it('通过并计算 workers.dev 基础 URL', async () => {
    const r = await preflight(
      fakeCloudflare({ subdomain: 'me' }),
      okRunner(),
      input
    );
    expect(r.failures).toEqual([]);
    expect(r.baseUrl).toBe('https://cloudforge.me.workers.dev');
    expect(r.zoneId).toBeNull();
  });

  it('将 Artifacts 10004 报告为一项 Artifacts 失败', async () => {
    const cf = fakeCloudflare({ subdomain: 'me' });
    cf.failNext(
      'listArtifactsNamespaces',
      new CloudflareError('no', 400, [10004], '/x')
    );
    const r = await preflight(cf, okRunner(), input);
    expect(r.failures.map((f) => f.check)).toEqual(['artifacts']);
    expect(r.failures[0].fix).toContain('Workers Paid');
    expect(r.failures[0].fix).toContain(
      'https://dash.cloudflare.com/?to=/:account/workers/plans'
    );
  });

  it('报告缺少的 workers.dev 子域名', async () => {
    const r = await preflight(fakeCloudflare(), okRunner(), input);
    expect(r.failures.map((f) => f.check)).toEqual(['workers-dev']);
    expect(r.baseUrl).toBeNull();
  });

  it('报告由其他 Worker 服务的主机名，并解析区域', async () => {
    const cf = fakeCloudflare({
      subdomain: 'me',
      zones: [{ id: 'z1', name: 'example.com', status: 'active' }],
      workerDomains: [{ hostname: 'GIT.example.com', service: 'other' }],
    });
    const r = await preflight(cf, okRunner(), {
      ...input,
      workersDev: false,
      hostname: 'git.example.com',
    });
    expect(r.failures.map((f) => f.check)).toEqual(['zone']);
    expect(r.failures[0].message).toContain('other');
    expect(r.zoneId).toBe('z1');
    expect(r.baseUrl).toBe('https://git.example.com');
  });

  it('接受已由本 Worker 使用的主机名，拒绝缺失或未激活的区域', async () => {
    const own = fakeCloudflare({
      zones: [{ id: 'z1', name: 'example.com', status: 'active' }],
      workerDomains: [{ hostname: 'git.example.com', service: 'cloudforge' }],
    });
    const custom = { ...input, workersDev: false, hostname: 'git.example.com' };
    expect((await preflight(own, okRunner(), custom)).failures).toEqual([]);
    const none = await preflight(fakeCloudflare(), okRunner(), custom);
    expect(none.failures.map((f) => f.check)).toEqual(['zone']);
    const pending = await preflight(
      fakeCloudflare({
        zones: [{ id: 'z1', name: 'example.com', status: 'pending' }],
      }),
      okRunner(),
      custom
    );
    expect(pending.failures.map((f) => f.check)).toEqual(['zone']);
  });

  describe('主机名现有的 DNS 记录和路由', () => {
    const custom = { ...input, workersDev: false, hostname: 'git.example.com' };
    const zones = [{ id: 'z1', name: 'example.com', status: 'active' }];

    it('存在 DNS 记录时停止', async () => {
      const cf = fakeCloudflare({
        zones,
        dnsRecords: {
          z1: [{ name: 'git.example.com', type: 'A', content: '192.0.2.1' }],
        },
      });
      const r = await preflight(cf, okRunner(), custom);
      expect(r.failures.map((f) => f.check)).toEqual(['zone']);
      expect(r.failures[0].message).toBe(
        '`git.example.com` already has DNS records (A 192.0.2.1). Nothing was changed.'
      );
      expect(cf.calls.find((c) => c.method === 'dnsRecords')?.args).toEqual([
        'z1',
        'git.example.com',
      ]);
    });

    it('其他 Worker 的路由覆盖该主机名时停止', async () => {
      for (const pattern of [
        'git.example.com/*',
        '*.example.com/*',
        'https://git.example.com/api/*',
      ]) {
        const cf = fakeCloudflare({
          zones,
          routes: { z1: [{ pattern, script: 'other' }] },
        });
        const r = await preflight(cf, okRunner(), custom);
        expect(r.failures.map((f) => f.message)).toEqual([
          '`git.example.com` is routed to `other`. Nothing was changed.',
        ]);
      }
    });

    it('忽略其他主机名的路由以及未绑定 Worker 的路由', async () => {
      const cf = fakeCloudflare({
        zones,
        routes: {
          z1: [
            { pattern: 'www.example.com/*', script: 'other' },
            { pattern: 'git.example.com/static/*', script: null },
          ],
        },
      });
      expect((await preflight(cf, okRunner(), custom)).failures).toEqual([]);
    });

    it('恢复时接受本 Worker 自己的自定义域名和记录', async () => {
      const cf = fakeCloudflare({
        zones,
        workerDomains: [{ hostname: 'git.example.com', service: 'cloudforge' }],
        dnsRecords: {
          z1: [{ name: 'git.example.com', type: 'AAAA', content: '100::' }],
        },
        routes: {
          z1: [{ pattern: 'git.example.com/*', script: 'cloudforge' }],
        },
      });
      expect((await preflight(cf, okRunner(), custom)).failures).toEqual([]);
    });
  });

  it('使用所选账户运行 wrangler', async () => {
    const runner = okRunner();
    await preflight(fakeCloudflare({ subdomain: 'me' }), runner, input);
    const email = runner.calls.find((c) => c.cmd === 'yarn');
    expect(email?.args).toEqual(['-s', 'wrangler', 'email', 'sending', 'list']);
    expect(email?.opts?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
  });

  it('软件包使用自带 wrangler 列出邮件发送配置，且不传 --config', async () => {
    const source = packageSource(
      fakePackage(mkdtempSync(join(tmpdir(), 'pre-')), {
        version: '1.2.0',
        commit: 'abc123def456',
      })
    );
    const out = table([['example.com', 'mail.example.com', 'yes']]);
    const runner = fakeRunner({
      docker: () => ({ code: 0, stdout: '27.0\n', stderr: '' }),
      [process.execPath]: () => ({ code: 0, stdout: out, stderr: '' }),
    });
    const r = await preflight(fakeCloudflare({ subdomain: 'me' }), runner, {
      ...input,
      source,
    });
    expect(r.failures).toEqual([]);
    const email = runner.calls.find((c) => c.cmd === process.execPath);
    expect(email?.args.slice(1)).toEqual(['email', 'sending', 'list']);
    expect(runner.calls.some((c) => c.cmd === 'yarn')).toBe(false);
  });

  it('将发件人域名按完整条目匹配，而非子串匹配', async () => {
    const cf = fakeCloudflare({ subdomain: 'me' });
    const r = await preflight(
      cf,
      okRunner(table([['example.com', 'notmail.example.com', 'yes']])),
      input
    );
    expect(r.failures.map((f) => f.check)).toEqual(['email']);
    expect(r.failures[0].fix).toContain('Email Service');
    const hit = await preflight(
      cf,
      okRunner(table([['example.com', 'MAIL.Example.com', 'yes']])),
      input
    );
    expect(hit.failures).toEqual([]);
  });

  it('区域列匹配、禁用行或不可读输出均不算通过', async () => {
    const cf = fakeCloudflare({ subdomain: 'me' });
    const bare = { ...input, fromEmail: 'noreply@example.com' };
    const zoneOnly = await preflight(
      cf,
      okRunner(table([['example.com', 'mail.example.com', 'yes']])),
      bare
    );
    expect(zoneOnly.failures.map((f) => f.check)).toEqual(['email']);
    const disabled = await preflight(
      cf,
      okRunner(table([['example.com', 'mail.example.com', 'no']])),
      input
    );
    expect(disabled.failures.map((f) => f.check)).toEqual(['email']);
    const junk = await preflight(cf, okRunner('mail.example.com\n'), input);
    expect(junk.failures[0].message).toContain('Could not read');
    expect(junk.failures[0].message).toContain('mail.example.com');
  });

  it('邮件列表命令失败时报告 stderr', async () => {
    const runner = fakeRunner({
      docker: () => ({ code: 0, stdout: '', stderr: '' }),
      yarn: () => ({ code: 1, stdout: '', stderr: 'boom\nmore' }),
    });
    const r = await preflight(
      fakeCloudflare({ subdomain: 'me' }),
      runner,
      input
    );
    expect(r.failures[0].check).toBe('email');
    expect(r.failures[0].message).toContain('boom');
    expect(r.failures[0].message).not.toContain('more');
  });

  it('没有发件人时跳过邮件检查', async () => {
    const runner = fakeRunner({
      docker: () => ({ code: 0, stdout: '', stderr: '' }),
    });
    const r = await preflight(fakeCloudflare({ subdomain: 'me' }), runner, {
      ...input,
      fromEmail: null,
    });
    expect(r.failures).toEqual([]);
  });

  it('分别说明两种 Docker 失败', async () => {
    const yarn = () => ({
      code: 0,
      stdout: table([['example.com', 'mail.example.com', 'yes']]),
      stderr: '',
    });
    const ok = { code: 0, stdout: '27.0\n', stderr: '' };
    const run = (script: Parameters<typeof fakeRunner>[0]) =>
      preflight(fakeCloudflare({ subdomain: 'me' }), fakeRunner(script), input);

    const down = await run({
      'docker --version': () => ok,
      'docker info': () => ({ code: 1, stdout: '', stderr: 'nope' }),
      yarn,
    });
    expect(down.failures.map((f) => f.check)).toEqual(['docker']);
    expect(down.failures[0]!.message).toMatch(
      /^Docker is installed but not running\./
    );

    const unreachable = await run({
      'docker --version': () => ok,
      'docker info': () => Promise.reject(new Error('boom')),
      yarn,
    });
    expect(unreachable.failures[0]!.message).toMatch(/not running/);

    for (const docker of [
      () => Promise.reject(new Error('spawn docker ENOENT')),
      () => ({ code: 127, stdout: '', stderr: '' }),
    ]) {
      const r = await run({ docker, yarn });
      expect(r.failures.map((f) => f.check)).toEqual(['docker']);
      expect(r.failures[0]!.message).toMatch(/^Docker is not installed\./);
    }
  });

  it('一次报告所有失败', async () => {
    const cf = fakeCloudflare();
    cf.failNext('listR2', new CloudflareError('x', 403, [], '/r2'));
    cf.failNext('listArtifactsNamespaces', new Error('weird'));
    const runner = fakeRunner({
      docker: () => ({ code: 1, stdout: '', stderr: '' }),
      yarn: () => ({ code: 0, stdout: '', stderr: '' }),
    });
    const r = await preflight(cf, runner, input);
    expect(r.failures.map((f) => f.check).sort()).toEqual(
      ['artifacts', 'docker', 'email', 'token', 'workers-dev'].sort()
    );
    expect(r.failures.find((f) => f.check === 'artifacts')?.message).toContain(
      'weird'
    );
  });

  it('将 R2 未启用错误映射到 r2 检查', async () => {
    const cf = fakeCloudflare({ subdomain: 'me' });
    cf.failNext(
      'listR2',
      new CloudflareError('enable R2', 400, [10042], '/r2')
    );
    const r = await preflight(cf, okRunner(), input);
    expect(r.failures.map((f) => f.check)).toEqual(['r2']);
  });
});
