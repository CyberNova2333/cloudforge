// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { searchQueryOptions } from './searchQuery';
import type { SearchResults } from './uiApi';

const wait = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

const results = (repo: string): SearchResults => ({
  repos: [{ name: repo, description: null }],
  pulls: [],
  agents: [],
  people: [],
  branches: [],
  files: [],
});

/** Every request the page made, with a way to answer it and the signal it would be aborted by. */
let requests: {
  url: string;
  signal: AbortSignal | null | undefined;
  answer(body: SearchResults): void;
}[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        requests.push({
          url: String(url),
          signal: init?.signal,
          answer: (body) =>
            resolve(
              new Response(JSON.stringify(body), {
                headers: { 'content-type': 'application/json' },
              })
            ),
        });
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      })
  );
});
afterEach(() => vi.unstubAllGlobals());

/** What the search box does: one observer whose options change as the (debounced) term and scope do. */
function watch() {
  const client = new QueryClient();
  const observer = new QueryObserver(client, searchQueryOptions('a', null));
  const unsubscribe = observer.subscribe(() => {});
  return {
    observer,
    type: (term: string, scope: string | null = null) =>
      observer.setOptions(searchQueryOptions(term, scope)),
    now: () => observer.getCurrentResult(),
    stop: () => {
      unsubscribe();
      client.clear();
    },
  };
}

describe('searchQueryOptions：搜索查询选项', () => {
  it('在当前仓库范围内向 /api/search 查询词条', async () => {
    const s = watch();
    await wait();
    s.type('auth', 'o/r');
    await wait();
    expect(requests.map((r) => r.url)).toEqual([
      '/api/search?q=a',
      '/api/search?q=auth&repo=o%2Fr',
    ]);
    s.stop();
  });

  it('查询为空时不发送请求', async () => {
    const s = watch();
    await wait();
    requests[0].answer(results('o/a'));
    await wait();
    s.type('');
    await wait();
    expect(requests).toHaveLength(1);
    expect(s.now().fetchStatus).toBe('idle');
    s.stop();
  });

  it('下一批结果加载期间保留上一批结果', async () => {
    const s = watch();
    await wait();
    requests[0].answer(results('o/a'));
    await wait();
    s.type('ab');
    await wait();
    expect(s.now()).toMatchObject({
      isFetching: true,
      isPlaceholderData: true,
      data: results('o/a'),
    });
    requests[1].answer(results('o/ab'));
    await wait();
    expect(s.now()).toMatchObject({
      isFetching: false,
      isPlaceholderData: false,
      data: results('o/ab'),
    });
    s.stop();
  });

  it('下一次输入使请求过期时取消该请求', async () => {
    const s = watch();
    await wait();
    s.type('ab');
    await wait();
    expect(requests[0].signal?.aborted).toBe(true);
    expect(requests[1].signal?.aborted).toBe(false);
    s.stop();
  });

  it('不将结果带入其他仓库', async () => {
    const s = watch();
    await wait();
    requests[0].answer(results('o/a'));
    await wait();
    s.type('a', 'o/r');
    await wait();
    expect(s.now().data).toBeUndefined();
    s.stop();
  });

  it('几秒内再次输入同一查询时从缓存返回', async () => {
    const s = watch();
    await wait();
    requests[0].answer(results('o/a'));
    await wait();
    s.type('ab');
    await wait();
    requests[1].answer(results('o/ab'));
    await wait();
    s.type('a');
    await wait();
    expect(requests).toHaveLength(2);
    expect(s.now().data).toEqual(results('o/a'));
    s.stop();
  });

  it('立即显示错误而不重试', async () => {
    const s = watch();
    await wait();
    // The server refused it.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 400 }));
    s.type('b');
    await wait();
    expect(s.now().isError).toBe(true);
    s.stop();
  });
});
