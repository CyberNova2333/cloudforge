import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsRepoClient } from '../git/remote';
import { createFakeArtifacts } from './helpers/fake-artifacts';

/** The fake Artifacts binding, counting its control-plane calls (get, info, createToken). */
async function counted() {
  const fake = createFakeArtifacts();
  await fake.binding.create('r_cache');
  const calls: string[] = [];
  const binding = {
    get: async (name: string) => {
      calls.push('get');
      const repo = await fake.binding.get(name);
      return {
        ...repo,
        info: () => (calls.push('info'), repo.info()),
        createToken: (scope: 'read' | 'write', ttl: number) => (
          calls.push(`token:${scope}`),
          repo.createToken(scope, ttl)
        ),
      };
    },
  } as unknown as Artifacts;
  return { fake, binding, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('Artifacts 控制面调用的缓存', () => {
  it('同一 isolate 内的后续请求复用远程地址和令牌，不再调用控制面', async () => {
    const { binding, calls } = await counted();
    await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    expect(calls).toEqual(['get', 'token:read', 'info']);
    calls.length = 0;
    // A new client, as the next request makes.
    await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    expect(calls).toEqual([]);
  });

  it('读令牌和写令牌分开缓存，快到期前重新签发', async () => {
    const { binding, calls } = await counted();
    const client = () => new ArtifactsRepoClient(binding, 'r_cache');
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await client().token('read');
    await client().token('write');
    await client().token('read');
    expect(calls.filter((c) => c.startsWith('token'))).toEqual([
      'token:read',
      'token:write',
    ]);
    // 300 s tokens are used for 240 s.
    now.mockReturnValue(start + 239_000);
    await client().token('read');
    expect(calls.filter((c) => c === 'token:read')).toHaveLength(1);
    now.mockReturnValue(start + 241_000);
    await client().token('read');
    expect(calls.filter((c) => c === 'token:read')).toHaveLength(2);
  });

  it('交给运行器的令牌总是新签发的', async () => {
    const { binding, calls } = await counted();
    await new ArtifactsRepoClient(binding, 'r_cache').token('read');
    await new ArtifactsRepoClient(binding, 'r_cache').token('read', {
      fresh: true,
    });
    expect(calls.filter((c) => c === 'token:read')).toHaveLength(2);
  });

  it('Artifacts 拒绝缓存的令牌时丢弃缓存，并重新查找仓库后重发', async () => {
    const { binding, calls } = await counted();
    await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    const fakeFetch = globalThis.fetch;
    let refused = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!refused++) return Promise.resolve(new Response('', { status: 401 }));
      return fakeFetch(input, init);
    });
    calls.length = 0;
    const refs = await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    expect(refs).toBeTruthy();
    expect(refused).toBe(2);
    expect(calls).toEqual(['get', 'token:read', 'info']);
    vi.stubGlobal('fetch', fakeFetch);
  });

  it('仓库被删除后，缓存的地址不掩盖 NOT_FOUND', async () => {
    const { fake, binding } = await counted();
    await new ArtifactsRepoClient(binding, 'r_cache').listRefs();
    fake.repos.delete('r_cache');
    await expect(
      new ArtifactsRepoClient(binding, 'r_cache').listRefs()
    ).rejects.toThrow('NOT_FOUND');
  });
});
