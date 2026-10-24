import { describe, expect, it } from 'vitest';
import { handleGitRequest } from '../git-http';
import { concat, decoder } from '../git/bytes';
import { buildPack } from '../git/pack';
import { FLUSH, parsePktLines, pktLine } from '../git/pktline';
import {
  decidePush,
  readReceiveRequest,
  refusalReport,
  rewriteReport,
  type PushRules,
} from '../git/push-protection';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
} from './helpers/app';
import { pat } from './helpers/actions';
import { commitPaths } from './helpers/seed';

const Z = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const rules = (over: Partial<PushRules> = {}): PushRules => ({
  defaultBranch: 'main',
  protectedPatterns: ['release/*'],
  admin: false,
  empty: false,
  ...over,
});

/** The report-status lines of a reply, plain or on side-band 1. */
function reportLines(reply: Uint8Array, sideband = false): string[] {
  let inner = reply;
  if (sideband)
    inner = concat(
      parsePktLines(reply).flatMap((p) =>
        p.type === 'data' && p.data[0] === 1 ? [p.data.subarray(1)] : []
      )
    );
  return parsePktLines(inner).flatMap((p) =>
    p.type === 'data' ? [decoder.decode(p.data).replace(/\n$/, '')] : []
  );
}

describe('推送保护规则', () => {
  it('协作者不能直接推送默认分支和受保护分支，其他分支照常', () => {
    const d = decidePush(
      [
        { old: A, new: B, ref: 'refs/heads/main' },
        { old: A, new: B, ref: 'refs/heads/release/1.0' },
        { old: A, new: B, ref: 'refs/heads/feature' },
        { old: A, new: B, ref: 'refs/tags/v1.0.0' },
      ],
      rules()
    );
    expect([...d.refused.keys()]).toEqual([
      'refs/heads/main',
      'refs/heads/release/1.0',
    ]);
    expect(d.fastForwardOnly).toEqual([]);
  });

  it('任何人都不能删除受保护分支或推送 refs/pull/', () => {
    const d = decidePush(
      [
        { old: A, new: Z, ref: 'refs/heads/main' },
        { old: A, new: B, ref: 'refs/pull/1/head' },
        { old: A, new: Z, ref: 'refs/heads/feature' },
      ],
      rules({ admin: true })
    );
    expect([...d.refused.keys()]).toEqual([
      'refs/heads/main',
      'refs/pull/1/head',
    ]);
  });

  it('管理员推送受保护分支时只允许快进，新建不需要检查', () => {
    const d = decidePush(
      [
        { old: A, new: B, ref: 'refs/heads/main' },
        { old: Z, new: B, ref: 'refs/heads/release/2.0' },
      ],
      rules({ admin: true })
    );
    expect(d.refused.size).toBe(0);
    expect(d.fastForwardOnly.map((c) => c.ref)).toEqual(['refs/heads/main']);
  });

  it('空仓库的第一次推送可以创建默认分支', () => {
    const first = [{ old: Z, new: B, ref: 'refs/heads/main' }];
    expect(decidePush(first, rules({ empty: true })).refused.size).toBe(0);
    expect(decidePush(first, rules()).refused.size).toBe(1);
  });
});

describe('receive-pack 请求与回复', () => {
  it('读出命令列表（跳过 shallow 行），并原样转发整个请求体', async () => {
    const body = concat([
      pktLine(`shallow ${A}\n`),
      pktLine(`${A} ${B} refs/heads/main\0report-status side-band-64k\n`),
      pktLine(`${Z} ${B} refs/heads/feature\n`),
      FLUSH,
      new TextEncoder().encode('PACK-and-more-bytes'),
    ]);
    // Delivered in small pieces, as a network would.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < body.length; i += 7)
          c.enqueue(body.slice(i, i + 7));
        c.close();
      },
    });
    const r = (await readReceiveRequest(stream))!;
    expect(r.commands).toEqual([
      { old: A, new: B, ref: 'refs/heads/main' },
      { old: Z, new: B, ref: 'refs/heads/feature' },
    ]);
    expect(r.capabilities).toEqual(['report-status', 'side-band-64k']);
    expect(new Uint8Array(await new Response(r.body).arrayBuffer())).toEqual(
      body
    );
  });

  it('拒绝不是命令列表的请求体', async () => {
    const bad = new Response('not a push').body!;
    expect(await readReceiveRequest(bad)).toBeNull();
  });

  it('拒绝的回复按客户端要求的格式（普通或 side-band）给出每个 ref 的原因', () => {
    const commands = [
      { old: A, new: B, ref: 'refs/heads/main' },
      { old: A, new: B, ref: 'refs/heads/feature' },
    ];
    const refused = new Map([['refs/heads/main', 'main is protected']]);
    const expected = [
      'unpack ok',
      'ng refs/heads/main main is protected',
      'ng refs/heads/feature declined: another ref of this push was refused',
    ];
    expect(
      reportLines(refusalReport(commands, refused, ['report-status']))
    ).toEqual(expected);
    expect(
      reportLines(
        refusalReport(commands, refused, ['report-status', 'side-band-64k']),
        true
      )
    ).toEqual(expected);
  });

  it('改写上游回复时保留进度消息，被撤回的 ref 改为 ng 并去掉其 option 行', () => {
    const inner = concat([
      pktLine('unpack ok\n'),
      pktLine('ok refs/heads/main\n'),
      pktLine(`option old-oid ${A}\n`),
      pktLine('ok refs/heads/feature\n'),
      FLUSH,
    ]);
    const progress = pktLine(
      concat([
        new Uint8Array([2]),
        new TextEncoder().encode('Resolving deltas\n'),
      ])
    );
    const upstream = concat([
      progress,
      pktLine(concat([new Uint8Array([1]), inner])),
      FLUSH,
    ]);
    const caps = ['report-status-v2', 'side-band-64k'];
    const out = rewriteReport(
      upstream,
      caps,
      new Map([['refs/heads/main', 'only fast-forwards']])
    )!;
    expect(reportLines(out, true)).toEqual([
      'unpack ok',
      'ng refs/heads/main only fast-forwards',
      'ok refs/heads/feature',
    ]);
    expect(decoder.decode(out)).toContain('Resolving deltas');
  });
});

describe('经由 git 端点的推送', () => {
  async function setup() {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'app', addReadme: true, visibility: 'internal' },
    });
    const repo = [...t.fake.repos.values()][0];
    const bob = await addMember(t, admin, 'bob');
    await call(t, '/api/repos/octocat/app/collaborators/bob', {
      cookie: admin,
      method: 'PUT',
    });
    return {
      t,
      repo,
      adminToken: await pat(t, admin),
      bobToken: await pat(t, bob),
    };
  }

  async function push(
    s: Awaited<ReturnType<typeof setup>>,
    token: string,
    ref: string,
    old: string,
    next: string
  ) {
    const res = await handleGitRequest(
      new Request('http://test.local/octocat/app.git/git-receive-pack', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`u:${token}`)}`,
          'Content-Type': 'application/x-git-receive-pack-request',
        },
        body: concat([
          pktLine(`${old} ${next} ${ref}\0report-status\n`),
          FLUSH,
          await buildPack([]),
        ]),
      }),
      s.t.env,
      s.t.ctx
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    return reportLines(new Uint8Array(await res.arrayBuffer()));
  }

  it('协作者推送 main 被拒绝且分支不动，推送功能分支照常', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const next = await commitPaths(s.repo, 'main', { 'a.txt': 'a\n' }, 'x', {
      moveRef: false,
    });
    const lines = await push(s, s.bobToken, 'refs/heads/main', main, next);
    expect(lines[1]).toMatch(
      /^ng refs\/heads\/main main is a protected branch/
    );
    expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    expect(await push(s, s.bobToken, 'refs/heads/feature', Z, next)).toEqual([
      'unpack ok',
      'ok refs/heads/feature',
    ]);
  });

  it('管理员可以快进 main，强制推送会被撤回', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const forward = await commitPaths(s.repo, 'main', { 'a.txt': 'a\n' }, 'x', {
      moveRef: false,
    });
    expect(
      await push(s, s.adminToken, 'refs/heads/main', main, forward)
    ).toEqual(['unpack ok', 'ok refs/heads/main']);
    // A commit that doesn't contain `forward`: a rewrite of main's history.
    const rewrite = await commitPaths(
      s.repo,
      'other',
      { 'b.txt': 'b\n' },
      'y',
      {
        moveRef: false,
      }
    );
    const lines = await push(
      s,
      s.adminToken,
      'refs/heads/main',
      forward,
      rewrite
    );
    expect(lines[1]).toMatch(/only fast-forward pushes are allowed/);
    expect(s.repo.refs.get('refs/heads/main')).toBe(forward);
  });

  it('管理员也不能删除 main，协作者不能推送 refs/pull/', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    expect(
      (await push(s, s.adminToken, 'refs/heads/main', main, Z))[1]
    ).toMatch(/can't be deleted/);
    expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    expect((await push(s, s.bobToken, 'refs/pull/1/head', Z, main))[1]).toMatch(
      /managed by CloudForge/
    );
  });
});
