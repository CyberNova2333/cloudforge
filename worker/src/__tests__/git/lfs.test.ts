// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import { handleLfsRequest, MAX_ADOPT_PROBES } from '../../lfs/http/handler';
import { sha256Hex } from '../../git/bytes';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import { commitFiles } from '../helpers/seed';

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;
const PATH = '/octocat/app.git/info/lfs';

async function pat(t: TestEnv, cookie: string) {
  const res = await call(t, '/api/tokens', {
    cookie,
    json: { name: 'lfs', expiresInDays: 30 },
  });
  return ((await res.json()) as { plaintext: string }).plaintext;
}

async function lfs(
  t: TestEnv,
  path: string,
  opts: {
    token?: string;
    method?: string;
    json?: unknown;
    env?: Partial<CloudflareBindings>;
  } = {}
) {
  const headers = new Headers({ Accept: 'application/vnd.git-lfs+json' });
  if (opts.token)
    headers.set('Authorization', `Basic ${btoa(`user:${opts.token}`)}`);
  if (opts.json !== undefined)
    headers.set('Content-Type', 'application/vnd.git-lfs+json');
  const req = new Request(`http://test.local${PATH}${path}`, {
    method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  return handleLfsRequest(
    req,
    { ...t.env, ...opts.env } as CloudflareBindings,
    ctx
  );
}

/** A file's LFS identity: oid is the SHA-256 of its content. */
async function blob(content: string) {
  return {
    content,
    oid: await sha256Hex(content),
    size: new TextEncoder().encode(content).length,
  };
}

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', addReadme: true, visibility: 'internal' },
  });
  const repoId = [...t.fake.repos.values()][0].name.slice(2);
  return { t, admin, token: await pat(t, admin), repoId };
}

type Batch = {
  objects: {
    oid: string;
    size: number;
    actions?: Record<string, { href: string; header?: Record<string, string> }>;
    error?: { code: number };
  }[];
};

describe('Git LFS 批量 API', () => {
  it('以 JSON 正文向未认证客户端发起认证质询', async () => {
    const { t } = await setup();
    const res = await lfs(t, '/objects/batch', {
      json: { operation: 'download', objects: [] },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.git-lfs+json'
    );
  });

  it('提供绑定校验和的预签名上传 URL 及验证动作', async () => {
    const { t, token, repoId } = await setup();
    const f = await blob('big binary file');
    const res = await lfs(t, '/objects/batch', {
      token,
      json: {
        operation: 'upload',
        transfers: ['basic'],
        objects: [{ oid: f.oid, size: f.size }],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Batch & { transfer: string };
    expect(body.transfer).toBe('basic');
    const { upload, verify } = body.objects[0].actions!;
    const href = new URL(upload.href);
    expect(href.host).toBe(
      '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'
    );
    expect(href.pathname).toBe(`/cloudforge-lfs-test/lfs/${repoId}/${f.oid}`);
    expect(href.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(href.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'x-amz-checksum-sha256'
    );
    expect(upload.header!['x-amz-checksum-sha256']).toBe(
      btoa(
        String.fromCharCode(...f.oid.match(/../g)!.map((h) => parseInt(h, 16)))
      )
    );
    expect(verify.href).toBe(`http://test.local${PATH}/objects/verify`);
  });

  it('仅在验证确认证明对象已存储后记录对象', async () => {
    const { t, token, repoId } = await setup();
    const f = await blob('hello lfs');
    const verify = () =>
      lfs(t, '/objects/verify', { token, json: { oid: f.oid, size: f.size } });
    expect((await verify()).status).toBe(422);

    await t.env.LFS.put(`lfs/${repoId}/${f.oid}`, f.content, { sha256: f.oid });
    expect((await verify()).status).toBe(200);

    const again = (await (
      await lfs(t, '/objects/batch', {
        token,
        json: { operation: 'upload', objects: [{ oid: f.oid, size: f.size }] },
      })
    ).json()) as Batch;
    expect(again.objects[0].actions).toBeUndefined(); // already stored: nothing to upload

    const down = (await (
      await lfs(t, '/objects/batch', {
        token,
        json: {
          operation: 'download',
          objects: [{ oid: f.oid, size: f.size }],
        },
      })
    ).json()) as Batch;
    expect(new URL(down.objects[0].actions!.download.href).pathname).toBe(
      `/cloudforge-lfs-test/lfs/${repoId}/${f.oid}`
    );
  });

  it('存储对象大小与声明不符时拒绝验证', async () => {
    const { t, token, repoId } = await setup();
    const f = await blob('size matters');
    await t.env.LFS.put(`lfs/${repoId}/${f.oid}`, f.content);
    const res = await lfs(t, '/objects/verify', {
      token,
      json: { oid: f.oid, size: f.size + 1 },
    });
    expect(res.status).toBe(422);
  });

  it('逐对象报告缺失或格式错误的对象', async () => {
    const { t, token } = await setup();
    const f = await blob('never uploaded');
    const res = await lfs(t, '/objects/batch', {
      token,
      json: {
        operation: 'download',
        objects: [
          { oid: f.oid, size: f.size },
          { oid: 'nope', size: 1 },
        ],
      },
    });
    const body = (await res.json()) as Batch;
    expect(body.objects.map((o) => o.error?.code)).toEqual([404, 422]);
  });

  it('一次批量请求最多向 R2 查询 100 个 D1 不认识的对象', async () => {
    const { t, token } = await setup();
    const head = vi.spyOn(t.env.LFS, 'head');
    try {
      const objects = await Promise.all(
        Array.from({ length: 150 }, async (_, i) => {
          const f = await blob(`unknown ${i}`);
          return { oid: f.oid, size: f.size };
        })
      );
      const res = await lfs(t, '/objects/batch', {
        token,
        json: { operation: 'download', objects },
      });
      const body = (await res.json()) as Batch;
      expect(body.objects.every((o) => o.error?.code === 404)).toBe(true);
      expect(head).toHaveBeenCalledTimes(MAX_ADOPT_PROBES);
    } finally {
      head.mockRestore();
    }
  });

  it('允许所有成员下载，但仅写入者可上传', async () => {
    const { t, admin, repoId } = await setup();
    const bob = await pat(t, await addMember(t, admin, 'bob'));
    const f = await blob('shared asset');
    await t.env.LFS.put(`lfs/${repoId}/${f.oid}`, f.content, { sha256: f.oid });
    const up = await lfs(t, '/objects/batch', {
      token: bob,
      json: { operation: 'upload', objects: [{ oid: f.oid, size: f.size }] },
    });
    expect(up.status).toBe(403);
    expect(
      (
        await lfs(t, '/objects/verify', {
          token: bob,
          json: { oid: f.oid, size: f.size },
        })
      ).status
    ).toBe(403);
    const down = (await (
      await lfs(t, '/objects/batch', {
        token: bob,
        json: {
          operation: 'download',
          objects: [{ oid: f.oid, size: f.size }],
        },
      })
    ).json()) as Batch;
    expect(down.objects[0].actions?.download).toBeDefined();
  });

  it('缺少 R2 密钥时说明 LFS 未配置', async () => {
    const { t, token } = await setup();
    const res = await lfs(t, '/objects/batch', {
      token,
      json: { operation: 'download', objects: [] },
      env: { R2_ACCESS_KEY_ID: '' },
    });
    expect(res.status).toBe(501);
    expect(((await res.json()) as { message: string }).message).toContain(
      'R2_ACCESS_KEY_ID'
    );
  });

  it('报告没有锁，并拒绝创建锁', async () => {
    const { t, token } = await setup();
    expect(await (await lfs(t, '/locks', { token })).json()).toEqual({
      locks: [],
    });
    expect(
      await (await lfs(t, '/locks/verify', { token, json: {} })).json()
    ).toEqual({ ours: [], theirs: [] });
    expect(
      (await lfs(t, '/locks', { token, json: { path: 'a.bin' } })).status
    ).toBe(501);
  });
});

describe('网页界面中的 Git LFS', () => {
  it('识别指针文件，将下载重定向至 R2，并在删除仓库时删除对象', async () => {
    const { t, admin, token, repoId } = await setup();
    const f = await blob('PNG bytes');
    const repo = [...t.fake.repos.values()][0];
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${f.oid}\nsize ${f.size}\n`;
    await commitFiles(
      repo,
      'main',
      { 'logo.png': pointer },
      'Add logo via LFS'
    );

    const before = (await (
      await call(t, '/api/repos/octocat/app/contents?refPath=main/logo.png', {
        cookie: admin,
      })
    ).json()) as { file: { lfs: unknown } };
    expect(before.file.lfs).toEqual({
      oid: f.oid,
      size: f.size,
      stored: false,
    });
    // Not uploaded yet: the raw endpoint serves the pointer itself.
    const rawPointer = await call(
      t,
      '/api/repos/octocat/app/raw?ref=main&path=logo.png',
      { cookie: admin }
    );
    expect(rawPointer.status).toBe(200);
    expect(await rawPointer.text()).toBe(pointer);

    await t.env.LFS.put(`lfs/${repoId}/${f.oid}`, f.content, { sha256: f.oid });
    await lfs(t, '/objects/verify', {
      token,
      json: { oid: f.oid, size: f.size },
    });
    const after = (await (
      await call(t, '/api/repos/octocat/app/contents?refPath=main/logo.png', {
        cookie: admin,
      })
    ).json()) as { file: { lfs: { stored: boolean } } };
    expect(after.file.lfs.stored).toBe(true);

    const dl = await call(
      t,
      `/api/repos/octocat/app/lfs/${f.oid}?filename=logo.png`,
      { cookie: admin }
    );
    expect(dl.status).toBe(302);
    const location = new URL(dl.headers.get('Location')!);
    expect(location.pathname).toBe(
      `/cloudforge-lfs-test/lfs/${repoId}/${f.oid}`
    );
    expect(location.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="logo.png"'
    );

    // The raw endpoint (used by images in rendered Markdown) follows the pointer to R2, inline.
    const raw = await call(
      t,
      '/api/repos/octocat/app/raw?ref=main&path=logo.png',
      { cookie: admin }
    );
    expect(raw.status).toBe(302);
    const rawLocation = new URL(raw.headers.get('Location')!);
    expect(rawLocation.pathname).toBe(
      `/cloudforge-lfs-test/lfs/${repoId}/${f.oid}`
    );
    expect(
      rawLocation.searchParams.get('response-content-disposition')
    ).toBeNull();

    expect(
      (
        await call(t, '/api/repos/octocat/app', {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    expect(await t.env.LFS.head(`lfs/${repoId}/${f.oid}`)).toBeNull();
  });

  it('将 LFS 存储的 SVG 从 R2 作为图片提供', async () => {
    const { t, admin, token, repoId } = await setup();
    const f = await blob('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const repo = [...t.fake.repos.values()][0];
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${f.oid}\nsize ${f.size}\n`;
    await commitFiles(repo, 'main', { 'logo.svg': pointer }, 'Add SVG via LFS');
    await t.env.LFS.put(`lfs/${repoId}/${f.oid}`, f.content, { sha256: f.oid });
    await lfs(t, '/objects/verify', {
      token,
      json: { oid: f.oid, size: f.size },
    });

    const raw = await call(
      t,
      '/api/repos/octocat/app/raw?ref=main&path=logo.svg',
      { cookie: admin }
    );
    expect(raw.status).toBe(302);
    const location = new URL(raw.headers.get('Location')!);
    // R2 keeps whatever type the upload sent; the signed URL overrides it.
    expect(location.searchParams.get('response-content-type')).toBe(
      'image/svg+xml'
    );
  });
});
