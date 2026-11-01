// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { INSTALL_MARKER_WRITE_SQL } from '../../../scripts/cloudforge/install-marker';

const mark = (id = 'installation', nonce = 'original-owner', version = 'new') =>
  env.DB.prepare(INSTALL_MARKER_WRITE_SQL)
    .bind(id, nonce, version, '{"schemaDigest":"new-digest"}', 2, id, nonce)
    .all<{ written: string }>();
const seed = (id: string, nonce: string) =>
  env.DB.prepare(
    'INSERT INTO install_state (installation_id,ownership_nonce,version,manifest_json,updated_at) VALUES (?,?,\'old\',\'{"schemaDigest":"old-digest"}\',1)'
  )
    .bind(id, nonce)
    .run();
const snapshot = () =>
  env.DB.prepare('SELECT * FROM install_state ORDER BY installation_id').all();

describe('安装归属标记的原子写入（真实 D1）', () => {
  it('空库初始化，已存在的同一所有者可幂等更新且只返回非秘密回执', async () => {
    expect((await mark()).results).toEqual([{ written: 'installation' }]);
    expect((await mark()).results).toEqual([{ written: 'installation' }]);
    expect(
      (await mark('installation', 'original-owner', 'newer')).results
    ).toEqual([{ written: 'installation' }]);
    expect((await snapshot()).results).toEqual([
      {
        installation_id: 'installation',
        ownership_nonce: 'original-owner',
        version: 'newer',
        manifest_json: '{"schemaDigest":"new-digest"}',
        updated_at: 2,
      },
    ]);
  });

  it.each([
    ['同安装 ID 的不同所有者', [['installation', 'changed-owner']]],
    ['另一个安装 ID', [['other-installation', 'original-owner']]],
    [
      '匹配行与冲突行并存',
      [
        ['installation', 'original-owner'],
        ['other-installation', 'other-owner'],
      ],
    ],
  ])('拒绝%s 并完整保留原行', async (_case, rows) => {
    for (const [id, nonce] of rows as string[][]) await seed(id, nonce);
    const before = (await snapshot()).results;
    expect((await mark()).results).toEqual([]);
    expect((await snapshot()).results).toEqual(before);
  });

  it('预检之后归属改变时，最终写点拒绝迟到更新', async () => {
    await seed('installation', 'original-owner');
    expect((await snapshot()).results[0]).toMatchObject({
      ownership_nonce: 'original-owner',
    });
    await env.DB.prepare(
      "UPDATE install_state SET ownership_nonce='changed-after-preflight' WHERE installation_id='installation'"
    ).run();
    const before = (await snapshot()).results;
    expect((await mark()).results).toEqual([]);
    expect((await snapshot()).results).toEqual(before);
  });
});
