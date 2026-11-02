import { describe, expect, it, vi } from 'vitest';
import { handleGitRequest } from '../../git/http/handler';
import { GitService } from '../../git/service';
import { ArtifactsRepoClient } from '../../git/remote';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import { prunePushStaging, PUSH_STAGING_PREFIX } from '../../git/push-staging';
import { concat, decoder } from '../../git/bytes';
import { buildPack } from '../../git/pack';
import { FLUSH, parsePktLines, pktLine } from '../../git/pktline';
import {
  decidePush,
  MAX_COMMAND_LIST_BYTES,
  receiveCommandBytes,
  rewriteReceiveRequest,
  successfulPushRefs,
  type PushCommand,
  readReceiveRequest,
  refusalReport,
  rewriteReport,
  type PushRules,
} from '../../git/push-protection';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
} from '../helpers/app';
import { pat } from '../helpers/actions';
import { commitPaths } from '../helpers/seed';

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

  it('pkt 长度必须是完整的四位十六进制，不能把无效前缀当作 flush', async () => {
    expect(await readReceiveRequest(new Response('00g4').body!)).toBeNull();
  });

  it('单个网络块也不能绕过命令列表大小上限', async () => {
    const line = pktLine(`${A} ${B} refs/heads/feature\n`);
    const oversized = concat([
      ...Array.from(
        { length: Math.ceil(MAX_COMMAND_LIST_BYTES / line.length) },
        () => line
      ),
      FLUSH,
    ]);
    expect(await readReceiveRequest(new Response(oversized).body!)).toBeNull();
  });

  it('短命令列表后的大 pack 不算命令字节，分块改写保留 shallow 和完整 pack', async () => {
    const pack = new Uint8Array(MAX_COMMAND_LIST_BYTES + 1).fill(42);
    const commands = [{ old: A, new: B, ref: 'refs/heads/main' }];
    const header = receiveCommandBytes(
      commands,
      ['report-status'],
      [`shallow ${A}`]
    );
    const raw = concat([header, pack]);
    const parsed = await readReceiveRequest(new Response(raw).body!);
    expect(parsed?.commandBytes).toBe(header.length);
    const staged = [{ old: Z, new: B, ref: 'refs/pull/_push/test/0' }];
    const rewritten = new Uint8Array(
      await new Response(
        rewriteReceiveRequest(parsed!, staged, ['report-status'])
      ).arrayBuffer()
    );
    expect(rewritten).toEqual(
      concat([
        receiveCommandBytes(staged, ['report-status'], [`shallow ${A}`]),
        pack,
      ])
    );
  });

  it('缺少 flush、截断和失败的报告都不会把 ref 认作成功', () => {
    const ok = concat([
      pktLine('unpack ok\n'),
      pktLine('ok refs/heads/main\n'),
      FLUSH,
    ]);
    expect([...successfulPushRefs(ok, ['report-status'])]).toEqual([
      'refs/heads/main',
    ]);
    expect(
      successfulPushRefs(ok.subarray(0, ok.length - 4), ['report-status']).size
    ).toBe(0);
    expect(
      successfulPushRefs(
        concat([
          pktLine('unpack failed\n'),
          pktLine('ok refs/heads/main\n'),
          FLUSH,
        ]),
        []
      ).size
    ).toBe(0);
    expect(
      successfulPushRefs(
        concat([
          pktLine('unpack ok\n'),
          pktLine('ok refs/heads/main\n'),
          pktLine('ng refs/heads/main denied\n'),
          FLUSH,
        ]),
        []
      ).size
    ).toBe(0);
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
    return pushMany(s, token, [{ ref, old, new: next }]);
  }

  async function pushMany(
    s: Awaited<ReturnType<typeof setup>>,
    token: string,
    commands: PushCommand[],
    opts: { caps?: string[]; gzip?: boolean; pack?: Uint8Array } = {}
  ) {
    const caps = opts.caps ?? ['report-status'];
    let body = concat([
      receiveCommandBytes(commands, caps),
      opts.pack ?? (await buildPack([])),
    ]);
    if (opts.gzip)
      body = new Uint8Array(
        await new Response(
          new Response(body).body!.pipeThrough(new CompressionStream('gzip'))
        ).arrayBuffer()
      );
    const res = await handleGitRequest(
      new Request('http://test.local/octocat/app.git/git-receive-pack', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`u:${token}`)}`,
          'Content-Type': 'application/x-git-receive-pack-request',
          ...(opts.gzip ? { 'Content-Encoding': 'gzip' } : {}),
          'Content-Length': String(body.length),
        },
        body,
      }),
      s.t.env,
      s.t.ctx
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    return reportLines(
      new Uint8Array(await res.arrayBuffer()),
      caps.includes('side-band-64k')
    );
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

  it('管理员可以快进 main，强制推送在修改分支前被拒绝', async () => {
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

  it('检查祖先时受保护分支仍是原头，从未短暂暴露被禁止的历史', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const rewrite = await commitPaths(
      s.repo,
      'other',
      { 'b.txt': 'b\n' },
      'rewrite',
      { moveRef: false }
    );
    const seen: (string | undefined)[] = [];
    const original = GitService.prototype.isAncestor;
    const check = vi
      .spyOn(GitService.prototype, 'isAncestor')
      .mockImplementation(function (this: GitService, ...args) {
        seen.push(s.repo.refs.get('refs/heads/main'));
        return original.apply(this, args);
      });
    try {
      await push(s, s.adminToken, 'refs/heads/main', main, rewrite);
      expect(seen).toEqual([main]);
      expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    } finally {
      check.mockRestore();
    }
  });

  it('补偿或临时引用清理失败也不会留下被禁止的强制推送', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const rewrite = await commitPaths(
      s.repo,
      'other',
      { 'b.txt': 'b\n' },
      'rewrite',
      { moveRef: false }
    );
    const cleanup = vi
      .spyOn(ArtifactsRepoClient.prototype, 'push')
      .mockRejectedValue(new Error('injected cleanup failure'));
    try {
      const lines = await push(
        s,
        s.adminToken,
        'refs/heads/main',
        main,
        rewrite
      );
      expect(s.repo.refs.get('refs/heads/main')).toBe(main);
      expect(lines[1]).toMatch(/^ng refs\/heads\/main /);
    } finally {
      cleanup.mockRestore();
    }
  });

  it('验证抛错时保守拒绝，混合的普通分支和删除命令也没有执行', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    s.repo.refs.set('refs/heads/delete-me', main);
    const next = await commitPaths(s.repo, 'main', { a: 'next' }, 'next', {
      moveRef: false,
    });
    const check = vi
      .spyOn(GitService.prototype, 'isAncestor')
      .mockRejectedValue(new Error('verification interrupted'));
    try {
      const lines = await pushMany(
        s,
        s.adminToken,
        [
          { old: main, new: next, ref: 'refs/heads/main' },
          { old: Z, new: next, ref: 'refs/heads/feature' },
          { old: main, new: Z, ref: 'refs/heads/delete-me' },
        ],
        { caps: ['report-status', 'atomic', 'delete-refs'] }
      );
      expect(lines.filter((l) => l.startsWith('ng '))).toHaveLength(3);
      expect(s.repo.refs.get('refs/heads/main')).toBe(main);
      expect(s.repo.refs.has('refs/heads/feature')).toBe(false);
      expect(s.repo.refs.get('refs/heads/delete-me')).toBe(main);
      expect(
        [...s.repo.refs.keys()].some((r) => r.startsWith(PUSH_STAGING_PREFIX))
      ).toBe(false);
      expect(
        await s.t.env.DB.prepare('SELECT COUNT(*) AS n FROM push_events').first(
          'n'
        )
      ).toBe(0);
    } finally {
      check.mockRestore();
    }
  });

  it('gzip 的新对象先暂存，最终保留 v2、sideband、atomic 与普通 ref 命令', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const existing = new Set(s.repo.objects.keys());
    const next = await commitPaths(
      s.repo,
      'main',
      { 'new.txt': 'new pack object' },
      'new commit',
      { moveRef: false }
    );
    const objects = [...s.repo.objects.values()].filter(
      (o) => !existing.has(o.sha)
    );
    for (const o of objects) s.repo.objects.delete(o.sha);
    const requests: { commands: PushCommand[]; caps: string[] }[] = [];
    const receive = s.repo.receivePack.bind(s.repo);
    const wire = vi
      .spyOn(s.repo, 'receivePack')
      .mockImplementation(async (bytes) => {
        const parsed = (await readReceiveRequest(new Response(bytes).body!))!;
        requests.push({ commands: parsed.commands, caps: parsed.capabilities });
        await parsed.body.cancel();
        const plain = await receive(bytes);
        return parsed.capabilities.includes('side-band-64k')
          ? concat([pktLine(concat([new Uint8Array([1]), plain])), FLUSH])
          : plain;
      });
    try {
      const caps = [
        'report-status-v2',
        'side-band-64k',
        'atomic',
        'ofs-delta',
        'agent=test',
      ];
      expect(
        await pushMany(
          s,
          s.adminToken,
          [
            { old: main, new: next, ref: 'refs/heads/main' },
            { old: Z, new: next, ref: 'refs/heads/feature' },
          ],
          { caps, gzip: true, pack: await buildPack(objects) }
        )
      ).toEqual(['unpack ok', 'ok refs/heads/main', 'ok refs/heads/feature']);
      expect(
        requests[0].commands.every((c) => c.ref.startsWith(PUSH_STAGING_PREFIX))
      ).toBe(true);
      expect(requests[1].caps).toEqual(caps);
      expect(requests[1].commands.map((c) => c.ref)).toEqual([
        'refs/heads/main',
        'refs/heads/feature',
      ]);
      expect(s.repo.refs.get('refs/heads/main')).toBe(next);
      expect(s.repo.refs.get('refs/heads/feature')).toBe(next);
      expect(
        [...s.repo.refs.keys()].some((r) => r.startsWith(PUSH_STAGING_PREFIX))
      ).toBe(false);
      const events = await s.t.env.DB.prepare(
        'SELECT commands FROM push_events'
      ).all<{ commands: string }>();
      expect(events.results).toHaveLength(1);
      expect(events.results[0].commands).not.toContain(PUSH_STAGING_PREFIX);
    } finally {
      wire.mockRestore();
    }
  });

  it('最终 CAS 失败保留并发更新，不把暂存成功记作正式推送成功', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const next = await commitPaths(s.repo, 'main', { a: 'next' }, 'next', {
      moveRef: false,
    });
    const other = await commitPaths(
      s.repo,
      'main',
      { b: 'concurrent' },
      'other',
      { moveRef: false }
    );
    const receive = s.repo.receivePack.bind(s.repo);
    const wire = vi
      .spyOn(s.repo, 'receivePack')
      .mockImplementation(async (bytes) => {
        const parsed = (await readReceiveRequest(new Response(bytes).body!))!;
        if (parsed.commands.some((c) => c.ref === 'refs/heads/main'))
          s.repo.refs.set('refs/heads/main', other);
        await parsed.body.cancel();
        return receive(bytes);
      });
    try {
      expect(
        (await push(s, s.adminToken, 'refs/heads/main', main, next))[1]
      ).toMatch(/^ng refs\/heads\/main /);
      expect(s.repo.refs.get('refs/heads/main')).toBe(other);
      expect(
        [...s.repo.refs.keys()].some((r) => r.startsWith(PUSH_STAGING_PREFIX))
      ).toBe(false);
      expect(
        await s.t.env.DB.prepare('SELECT COUNT(*) AS n FROM push_events').first(
          'n'
        )
      ).toBe(0);
    } finally {
      wire.mockRestore();
    }
  });

  it('暂存报告缺失或截断则不进入祖先检查或正式提交', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const next = await commitPaths(s.repo, 'main', { a: 'next' }, 'next', {
      moveRef: false,
    });
    const receive = s.repo.receivePack.bind(s.repo);
    const wire = vi
      .spyOn(s.repo, 'receivePack')
      .mockImplementation(async (bytes) => {
        const reply = await receive(bytes);
        return decoder.decode(bytes).includes(PUSH_STAGING_PREFIX)
          ? reply.subarray(0, reply.length - 4)
          : reply;
      });
    const check = vi.spyOn(GitService.prototype, 'isAncestor');
    try {
      expect(
        (await push(s, s.adminToken, 'refs/heads/main', main, next))[1]
      ).toContain('could not stage');
      expect(check).not.toHaveBeenCalled();
      expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    } finally {
      wire.mockRestore();
      check.mockRestore();
    }
  });

  it('protected push-options 明确拒绝且不向远程上传', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const receive = vi.spyOn(s.repo, 'receivePack');
    try {
      const lines = await pushMany(
        s,
        s.adminToken,
        [{ old: main, new: main, ref: 'refs/heads/main' }],
        { caps: ['report-status', 'push-options'] }
      );
      expect(lines[1]).toContain('push-options are not supported');
      expect(receive).not.toHaveBeenCalled();
    } finally {
      receive.mockRestore();
    }
  });

  it('日常清理只删过期暂存，保留近期暂存和 PR 记录', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    const now = Date.now();
    const old = `${PUSH_STAGING_PREFIX}${now - 2 * 86_400_000}-${crypto.randomUUID()}/0`;
    const fresh = `${PUSH_STAGING_PREFIX}${now}-${crypto.randomUUID()}/0`;
    s.repo.refs.set(old, main);
    s.repo.refs.set(fresh, main);
    s.repo.refs.set('refs/pull/1/head', main);
    s.repo.refs.set('refs/pull/1/landings/receipt', main);
    expect(
      await prunePushStaging(
        s.t.env,
        drizzle(s.t.env.DB, { schema }),
        new Date(now)
      )
    ).toBe(1);
    expect(s.repo.refs.has(old)).toBe(false);
    expect(s.repo.refs.has(fresh)).toBe(true);
    expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    expect(s.repo.refs.has('refs/pull/1/head')).toBe(true);
    expect(s.repo.refs.has('refs/pull/1/landings/receipt')).toBe(true);
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
