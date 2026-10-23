import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import {
  lfsObjects,
  repositories,
  repositoryCollaborators,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import { findReposByIds, permissionsForMany } from '../lib/repos';
import { usersByCommitEmail } from '../lib/commit-authors';
import { usersById } from '../lib/users';
import { handleLfsRequest } from '../lfs-http';
import { TOOL_HANDLERS } from '../mcp/tools';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';

describe('D1 set queries above 100 members', () => {
  it('lists 200 repositories through MCP with correct read/write permissions and resolves their IDs', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'seed', visibility: 'internal' },
    });
    const db = drizzle(t.env.DB, { schema });
    const seed = (await db.query.repositories.findFirst())!;
    const bob = (await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.username, 'bob'),
    }))!;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...seed,
      id: `repo-${i}`,
      name: `repo-${i}`,
      artifactsName: `r_repo-${i}`,
      updatedAt: new Date(seed.updatedAt.getTime() + 1000),
    }));
    const inserts = rows.map((row) => db.insert(repositories).values(row));
    await db.batch([inserts[0], ...inserts.slice(1)]);
    await db.insert(repositoryCollaborators).values({
      repositoryId: rows[0].id,
      userId: bob.id,
      createdAt: new Date(),
    });
    const perms = await permissionsForMany(db, rows, bob);
    expect(perms.size).toBe(200);
    expect(perms.get(rows[0].id)).toEqual({
      read: true,
      write: true,
      admin: false,
    });
    expect(perms.get(rows[199].id)).toEqual({
      read: true,
      write: false,
      admin: false,
    });
    const found = await findReposByIds(db, [
      ...rows.map((r) => r.id),
      rows[0].id,
      'missing',
    ]);
    expect(found.size).toBe(200);
    expect(found.get(rows[199].id)?.namespace.username).toBe('octocat');
    const result = await TOOL_HANDLERS.get(
      'gitorange_list_repositories'
    )!.handler(
      {},
      {
        db,
        env: t.env,
        user: bob,
        baseURL: 'http://test.local',
        after: () => {},
        moderator: null,
      }
    );
    const list = JSON.parse(result.content[0].text) as {
      full_name: string;
      can_push: boolean;
    }[];
    expect(list).toHaveLength(200);
    expect(list.find((r) => r.full_name === 'octocat/repo-0')?.can_push).toBe(
      true
    );
    expect(list.find((r) => r.full_name === 'octocat/repo-199')?.can_push).toBe(
      false
    );
  });

  it('looks up more than 100 verified authors and users without losing any matches', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const db = drizzle(t.env.DB, { schema });
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `author-${i}`,
      username: `author-${i}`,
      name: `Author ${i}`,
      email: `author-${i}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    for (const row of rows) await db.insert(users).values(row);
    const matches = await usersByCommitEmail(
      db,
      rows.map((r) => r.email)
    );
    expect(matches.size).toBe(120);
    expect(matches.get(rows[119].email)?.id).toBe(rows[119].id);
    expect(
      (
        await usersById(
          db,
          rows.map((r) => r.id)
        )
      ).size
    ).toBe(120);
    expect(await usersByCommitEmail(db, [])).toEqual(new Map());
    expect(await findReposByIds(db, [])).toEqual(new Map());
  });

  it('serves the documented 100-SHA commit-status request', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'statuses', visibility: 'public' },
    });
    const shas = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(40, '0')
    );
    const res = await call(
      t,
      `/api/repos/octocat/statuses/commit-statuses?shas=${shas.join(',')}`
    );
    expect(res.status).toBe(200);
    const statuses = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(statuses)).toEqual(shas);
    expect(statuses[shas[99]]).toEqual({ state: null, runs: [] });
  });

  it('downloads a full 100-object LFS batch, keeping every object’s scoped URL', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'large-batch', visibility: 'public' },
    });
    const db = drizzle(t.env.DB, { schema });
    const repo = (await db.query.repositories.findFirst())!;
    const objects = Array.from({ length: 100 }, (_, i) => ({
      oid: i.toString(16).padStart(64, '0'),
      size: 1,
    }));
    for (const o of objects)
      await db.insert(lfsObjects).values({
        id: `lfs-${o.oid}`,
        repositoryId: repo.id,
        oid: o.oid,
        size: o.size,
        r2Key: `lfs/${repo.id}/${o.oid}`,
        uploadedById: null,
        createdAt: new Date(),
      });
    const res = await handleLfsRequest(
      new Request(
        'http://test.local/octocat/large-batch.git/info/lfs/objects/batch',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/vnd.git-lfs+json' },
          body: JSON.stringify({ operation: 'download', objects }),
        }
      ),
      t.env,
      t.ctx
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      objects: { oid: string; actions: { download: { href: string } } }[];
    };
    expect(result.objects).toHaveLength(100);
    for (const o of result.objects)
      expect(new URL(o.actions.download.href).pathname).toContain(
        `/lfs/${repo.id}/${o.oid}`
      );
  });
});
