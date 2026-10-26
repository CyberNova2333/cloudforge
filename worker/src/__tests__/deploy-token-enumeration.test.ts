import { describe, expect, it } from 'vitest';
import { handleGitRequest } from '../git-http';
import { handleLfsRequest } from '../lfs-http';
import { bootstrapAdmin, call, makeEnv } from './helpers/app';

describe('部署凭据不能枚举私有仓库', () => {
  it.each([
    ['git', 'cfd_bad'],
    ['git', `cfd_${'a'.repeat(64)}`],
    ['lfs', 'cfd_bad'],
    ['lfs', `cfd_${'a'.repeat(64)}`],
  ] as const)(
    '%s 的无效凭据 %s 对现存私库与缺失仓库给出相同质询',
    async (protocol, token) => {
      const t = makeEnv();
      const cookie = await bootstrapAdmin(t);
      expect(
        (
          await call(t, '/api/repos', {
            cookie,
            json: { name: 'private', visibility: 'private' },
          })
        ).status
      ).toBe(201);
      const replies = [];
      for (const name of ['private', 'missing']) {
        const headers = { Authorization: `Basic ${btoa(`deploy:${token}`)}` };
        const response =
          protocol === 'git'
            ? await handleGitRequest(
                new Request(
                  `http://test.local/octocat/${name}.git/info/refs?service=git-upload-pack`,
                  { headers }
                ),
                t.env,
                t.ctx
              )
            : await handleLfsRequest(
                new Request(
                  `http://test.local/octocat/${name}.git/info/lfs/objects/batch`,
                  {
                    method: 'POST',
                    headers: {
                      ...headers,
                      'Content-Type': 'application/vnd.git-lfs+json',
                    },
                    body: JSON.stringify({
                      operation: 'download',
                      objects: [],
                    }),
                  }
                ),
                t.env,
                t.ctx
              );
        replies.push({
          status: response.status,
          challenge: response.headers.get('WWW-Authenticate'),
          body: await response.text(),
        });
      }
      expect(replies[0].status, protocol).toBe(401);
      expect(replies[0].challenge, protocol).toContain('Basic');
      expect(replies[1], protocol).toEqual(replies[0]);
    }
  );
});
