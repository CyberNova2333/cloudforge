// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  landingIntents,
  pullRequests,
  repositories,
} from '../../db/app.schema';
import { cutRelease, unreleased } from '../../releases/service';
import { landPull } from '../../merge/land';
import { recoverLandings } from '../../merge/landing-recovery';
import { gitFor } from '../../repositories/service';
import { call, settle } from '../helpers/app';
import { crewRepo, FILES } from '../helpers/crew';
import { commitPaths } from '../helpers/seed';
import { makeCommit } from '../../git/objects';
import { decoder } from '../../git/bytes';
import { pullShas } from '../../pulls/service';
import { GitService } from '../../git/service';

afterEach(() => vi.restoreAllMocks());

it('security: 301 commits must not hide another open PR from the landing fence', async () => {
  const s = await crewRepo({ actions: true });
  const parent = await s.branch('parent', {
    'pending.txt': 'unreviewed parent\n',
  });
  expect(await s.web('parent')).toBe(1);
  s.repo.refs.set('refs/heads/child', parent);
  for (let i = 0; i < 300; i++)
    await commitPaths(
      s.repo,
      'child',
      { ...FILES, 'pending.txt': 'unreviewed parent\n', 'child.txt': `${i}\n` },
      `child ${i}`
    );
  expect(await s.web('child')).toBe(2);
  const response = await call(s.t, '/api/repos/octocat/app/pulls/2/merge', {
    cookie: s.admin,
    json: { approve: true },
  });
  await settle(s.t);
  expect(response.status).toBe(409);
  expect(s.repo.refs.get('refs/heads/main')).toBe(s.main);
});

it('security: release must wait for an unrecorded landing even after another fast-forward', async () => {
  const s = await crewRepo({ actions: true });
  await s.branch('first');
  await s.web('first');
  await s.merge(1);
  const second = await s.branch('second');
  await s.web('second');
  expect(
    (
      await call(s.t, '/api/repos/octocat/app/pulls/2/approval', {
        cookie: s.admin,
        method: 'POST',
      })
    ).status
  ).toBe(200);
  await settle(s.t);
  const pr = (await s.db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 2))
    .get())!;
  const repo = (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;
  await s.t.env.DB.exec(
    "CREATE TRIGGER audit_fail_landing BEFORE UPDATE OF state ON pull_requests WHEN NEW.state = 'merged' AND NEW.number = 2 BEGIN SELECT RAISE(ABORT, 'audit interrupted recording'); END;"
  );
  try {
    await expect(
      landPull({
        env: s.t.env,
        db: s.db,
        repo,
        repoFullName: 'octocat/app',
        git: gitFor(s.t.env, repo),
        pr,
        by: null,
        after: () => {},
      })
    ).rejects.toThrow('audit interrupted recording');
  } finally {
    await s.t.env.DB.exec('DROP TRIGGER audit_fail_landing');
  }
  expect(s.repo.refs.get('refs/heads/main')).toBe(second);
  const advanced = await commitPaths(
    s.repo,
    'main',
    {
      ...FILES,
      'second.txt': 'second\n',
      'later.txt': 'legitimate later push\n',
    },
    'later fast-forward'
  );
  const actor = (await s.t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>())!;
  const result = await cutRelease({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    origin: 'https://git.test',
    actor,
    headSha: advanced,
    version: 'v1.0.0',
  });
  await recoverLandings(s.t.env, s.db);
  expect(result).toMatchObject({ ok: false, status: 409 });
  expect(s.repo.refs.has('refs/tags/v1.0.0')).toBe(false);
  const pending = await unreleased(
    s.db,
    repo,
    'https://git.test',
    'octocat/app'
  );
  expect(pending.pulls.map((p) => p.number)).toEqual([1, 2]);
  const retry = await cutRelease({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    origin: 'https://git.test',
    actor,
    headSha: advanced,
    version: 'v1.0.0',
  });
  expect(retry.ok).toBe(true);
  const links = await s.t.env.DB.prepare(
    'SELECT p.number, r.tag FROM pull_requests p LEFT JOIN release_pulls rp ON p.id = rp.pull_request_id LEFT JOIN releases r ON r.id = rp.release_id ORDER BY p.number'
  ).all();
  expect(links.results).toEqual([
    { number: 1, tag: 'v1.0.0' },
    { number: 2, tag: 'v1.0.0' },
  ]);
  const duplicateCut = await cutRelease({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    origin: 'https://git.test',
    actor,
    headSha: advanced,
  });
  expect(duplicateCut).toMatchObject({
    ok: false,
    status: 409,
    message: 'Nothing to release',
  });
});

it('security: revert preserves target changes merged into the feature through its second parent', async () => {
  const s = await crewRepo({ actions: true });
  const feature = await s.branch('feature', { 'feature.txt': 'new feature\n' });
  const target = await commitPaths(
    s.repo,
    'main',
    { ...FILES, 'existing-fix.txt': 'already on main\n' },
    'Main fix before PR'
  );
  const temporary = await commitPaths(
    s.repo,
    'feature',
    {
      ...FILES,
      'feature.txt': 'new feature\n',
      'existing-fix.txt': 'already on main\n',
    },
    'merged tree'
  );
  const merge = await makeCommit({
    tree: s.repo.parseCommit(temporary)!.treeHash,
    parents: [feature, target],
    author: { name: 'Dev', email: 'dev@example.com', timestamp: 1_800_000_000 },
    message: 'Merge main into feature',
  });
  s.repo.add(merge);
  s.repo.refs.set('refs/heads/feature', merge.sha);
  await s.web('feature');
  await s.merge(1);
  const repo = (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;
  const pr = (await s.db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  const range = await pullShas(gitFor(s.t.env, repo), pr, s.db);
  const response = await call(s.t, '/api/repos/octocat/app/pulls/1/revert', {
    cookie: s.admin,
    method: 'POST',
  });
  await settle(s.t);
  expect(response.ok).toBe(true);
  const git = gitFor(s.t.env, repo);
  const revert = s.repo.refs.get('refs/heads/revert-1')!;
  const fixed = await git.entryAt(revert, 'existing-fix.txt');
  const content =
    fixed?.type === 'blob'
      ? decoder.decode((await git.blob(fixed.entry.hash))!)
      : null;
  expect(range).toEqual({ base: target, head: merge.sha });
  expect(content).toBe('already on main\n');
  expect(await git.entryAt(revert, 'feature.txt')).toBeNull();
});

it.each(['error', 'incomplete'])(
  'security: a %s parent-lineage response must not authorize landing its child',
  async (failure) => {
    const s = await crewRepo({ actions: true });
    const parent = await s.branch('parent');
    await s.web('parent');
    const source = s.repo.parseCommit(parent)!;
    const copy = await makeCommit({
      tree: source.treeHash,
      parents: source.parents,
      author: { ...source.author, timestamp: source.authoredAt },
      committer: { ...source.committer, timestamp: source.committedAt + 1 },
      message: source.message,
    });
    s.repo.add(copy);
    s.repo.refs.set('refs/heads/child', copy.sha);
    await commitPaths(
      s.repo,
      'child',
      { ...FILES, 'parent.txt': 'parent\n', 'child.txt': 'child\n' },
      'child'
    );
    await s.web('child');
    expect(
      (
        await call(s.t, '/api/repos/octocat/app/pulls/2/approval', {
          cookie: s.admin,
          method: 'POST',
        })
      ).status
    ).toBe(200);
    await settle(s.t);
    const pr = (await s.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.number, 2))
      .get())!;
    const repo = (await s.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, s.repoId))
      .get())!;
    const git = gitFor(s.t.env, repo);
    const original = git.commitsBetween.bind(git);
    vi.spyOn(git, 'commitsBetween').mockImplementation(async (base, head) => {
      if (head === parent)
        if (failure === 'incomplete') return [];
        else
          throw new Error('audit injected Artifacts read failure for parent');
      return original(base, head);
    });
    const tail: Promise<unknown>[] = [];
    const result = await landPull({
      env: s.t.env,
      db: s.db,
      repo,
      repoFullName: 'octocat/app',
      git,
      pr,
      by: null,
      after: (p) => {
        tail.push(p);
      },
    });
    await Promise.all(tail);
    expect(result).toMatchObject({ ok: false, status: 409 });
  }
);
// A lineage can be incomplete on either side even when exact SHA ancestry is disjoint.
it.each(['candidate', 'other'])(
  'security: truncated %s lineage refuses a disjoint comparison',
  async (long) => {
    const s = await crewRepo({ actions: true });
    await s.branch('other');
    await s.web('other');
    await s.branch('candidate');
    for (let i = 0; i < 300; i++)
      await commitPaths(
        s.repo,
        long,
        { ...FILES, [`${long}.txt`]: `${i}\n` },
        `${long} ${i}`
      );
    await s.web('candidate');
    const response = await call(s.t, '/api/repos/octocat/app/pulls/2/merge', {
      cookie: s.admin,
      json: { approve: true },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'stack' });
    expect(s.repo.refs.get('refs/heads/main')).toBe(s.main);
  }
);

it('security: a long exact child does not prevent its parent landing first', async () => {
  const s = await crewRepo({ actions: true });
  const parent = await s.branch('parent');
  await s.web('parent');
  s.repo.refs.set('refs/heads/child', parent);
  for (let i = 0; i < 300; i++)
    await commitPaths(
      s.repo,
      'child',
      { ...FILES, 'parent.txt': 'parent\n', 'child.txt': `${i}\n` },
      `child ${i}`
    );
  await s.web('child');
  await s.merge(1);
  expect(s.repo.refs.get('refs/heads/main')).toBe(parent);
});

it('security: unreadable patch evidence refuses landing and is retried after the transient failure', async () => {
  const s = await crewRepo({ actions: true });
  const parent = await s.branch('parent');
  await s.web('parent');
  const source = s.repo.parseCommit(parent)!;
  const copy = await makeCommit({
    tree: source.treeHash,
    parents: source.parents,
    author: { ...source.author, timestamp: source.authoredAt },
    committer: { ...source.committer, timestamp: source.committedAt + 1 },
    message: source.message,
  });
  s.repo.add(copy);
  s.repo.refs.set('refs/heads/child', copy.sha);
  await commitPaths(
    s.repo,
    'child',
    { ...FILES, 'parent.txt': 'parent\n', 'child.txt': 'child\n' },
    'child'
  );
  await s.web('child');
  const pr = (await s.db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 2))
    .get())!;
  const repo = (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;
  const git = gitFor(s.t.env, repo);
  vi.spyOn(git, 'diffTrees').mockRejectedValueOnce(
    new Error('transient patch read failure')
  );
  const opts = {
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    git,
    pr,
    by: null,
    after: () => {},
  };
  expect(await landPull(opts)).toMatchObject({
    ok: false,
    status: 409,
    reason: 'stack',
    error: expect.stringContaining('completely check'),
  });
  expect(await landPull({ ...opts, git: gitFor(s.t.env, repo) })).toMatchObject(
    {
      ok: false,
      status: 409,
      reason: 'stack',
      error: expect.stringContaining('carries'),
    }
  );
  expect(s.repo.refs.get('refs/heads/main')).toBe(s.main);
});

it('security: historical linear landings remain revertible without a recorded intent', async () => {
  const s = await crewRepo();
  await s.branch('linear');
  await s.web('linear');
  await s.merge(1);
  const pr = (await s.db.select().from(pullRequests).get())!;
  const repo = (await s.db.select().from(repositories).get())!;
  await s.db
    .delete(landingIntents)
    .where(eq(landingIntents.pullRequestId, pr.id));
  expect(await pullShas(gitFor(s.t.env, repo), pr, s.db)).toEqual({
    base: s.main,
    head: pr.mergeCommitSha,
  });
  const response = await call(s.t, '/api/repos/octocat/app/pulls/1/revert', {
    cookie: s.admin,
    method: 'POST',
  });
  expect(response.status).toBe(201);
  await settle(s.t);
});

it('security: a historical multi-parent landing without durable base evidence refuses automatic revert', async () => {
  const s = await crewRepo();
  const feature = await s.branch('feature');
  const target = await commitPaths(
    s.repo,
    'main',
    { ...FILES, 'existing-fix.txt': 'already on main\n' },
    'main fix'
  );
  const mergedTree = await commitPaths(
    s.repo,
    'feature',
    {
      ...FILES,
      'feature.txt': 'feature\n',
      'existing-fix.txt': 'already on main\n',
    },
    'merged tree'
  );
  const merge = await makeCommit({
    tree: s.repo.parseCommit(mergedTree)!.treeHash,
    parents: [feature, target],
    author: { name: 'Dev', email: 'dev@example.com', timestamp: 1_800_000_000 },
    message: 'Merge main into feature',
  });
  s.repo.add(merge);
  s.repo.refs.set('refs/heads/feature', merge.sha);
  await s.web('feature');
  await s.merge(1);
  const pr = (await s.db.select().from(pullRequests).get())!;
  const repo = (await s.db.select().from(repositories).get())!;
  await s.db
    .delete(landingIntents)
    .where(eq(landingIntents.pullRequestId, pr.id));
  expect(await pullShas(gitFor(s.t.env, repo), pr, s.db)).toBeNull();
  const response = await call(s.t, '/api/repos/octocat/app/pulls/1/revert', {
    cookie: s.admin,
    method: 'POST',
  });
  expect(response.status).toBe(409);
  expect(s.repo.refs.has('refs/heads/revert-1')).toBe(false);
  expect(s.repo.refs.get('refs/heads/main')).toBe(merge.sha);
});
it.each(['pending', 'recorded'])(
  'security: release accounting fences a %s landing added after the snapshot and preserves its tag',
  async (state) => {
    const s = await crewRepo({ actions: true });
    await s.mergedRow(1, 'first', Date.now(), { sha: s.main });
    const repo = (await s.db.select().from(repositories).get())!;
    const actor = (await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!;
    const create = GitService.prototype.createRef;
    let inserted = false;
    const spy = vi
      .spyOn(GitService.prototype, 'createRef')
      .mockImplementation(async function (this: GitService, ref, sha) {
        await create.call(this, ref, sha);
        if (!ref.startsWith('refs/tags/') || inserted) return;
        inserted = true;
        await s.mergedRow(2, 'late', Date.now(), { sha: s.main });
        if (state === 'pending') {
          await s.db
            .update(pullRequests)
            .set({
              state: 'open',
              mergeCommitSha: null,
              mergedAt: null,
              closedAt: null,
            })
            .where(eq(pullRequests.number, 2));
          const pr = (await s.db
            .select()
            .from(pullRequests)
            .where(eq(pullRequests.number, 2))
            .get())!;
          await s.db.insert(landingIntents).values({
            id: crypto.randomUUID(),
            repositoryId: repo.id,
            pullRequestId: pr.id,
            target: 'main',
            baseSha: s.main,
            headSha: s.main,
            landHeadSha: s.main,
            pullRefBefore: s.main,
            landedCommits: 1,
            automatic: true,
            createdAt: new Date(),
          });
        }
      });
    const opts = {
      env: s.t.env,
      db: s.db,
      repo,
      repoFullName: 'octocat/app',
      origin: 'https://git.test',
      actor,
      headSha: s.main,
      version: 'v1.0.0',
    };
    const result = await cutRelease(opts);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(s.repo.refs.get('refs/tags/v1.0.0')).toBe(s.main);
    expect(
      (await s.t.env.DB.prepare('SELECT COUNT(*) n FROM releases').first<{
        n: number;
      }>())!.n
    ).toBe(0);
    expect(
      (await s.t.env.DB.prepare('SELECT COUNT(*) n FROM release_pulls').first<{
        n: number;
      }>())!.n
    ).toBe(0);
    spy.mockRestore();
    if (state === 'pending') {
      await s.db
        .update(landingIntents)
        .set({ recordedAt: new Date(), finishedAt: new Date() });
      await s.db
        .update(pullRequests)
        .set({ state: 'merged', mergeCommitSha: s.main, mergedAt: new Date() })
        .where(eq(pullRequests.number, 2));
    }
    expect((await cutRelease(opts)).ok).toBe(true);
    expect(s.repo.refs.get('refs/tags/v1.0.0')).toBe(s.main);
    expect(
      (await unreleased(s.db, repo, opts.origin, opts.repoFullName)).pulls
    ).toEqual([]);
  }
);
it.each(['tree', 'blob'])(
  'security: missing patch %s objects refuse landing instead of behaving like empty objects',
  async (kind) => {
    const s = await crewRepo({ actions: true });
    const parent = await s.branch('parent');
    await s.web('parent');
    const source = s.repo.parseCommit(parent)!;
    const copy = await makeCommit({
      tree: source.treeHash,
      parents: source.parents,
      author: { ...source.author, timestamp: source.authoredAt },
      committer: { ...source.committer, timestamp: source.committedAt + 1 },
      message: source.message,
    });
    s.repo.add(copy);
    s.repo.refs.set('refs/heads/child', copy.sha);
    await commitPaths(
      s.repo,
      'child',
      { ...FILES, 'parent.txt': 'parent\n', 'child.txt': 'child\n' },
      'child'
    );
    await s.web('child');
    const pr = (await s.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.number, 2))
      .get())!;
    const repo = (await s.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, s.repoId))
      .get())!;
    const missing =
      kind === 'tree'
        ? source.treeHash
        : s.repo
            .parseTree(source.treeHash)!
            .find((e) => e.name === 'parent.txt')!.hash;
    const object = s.repo.objects.get(missing)!;
    s.repo.objects.delete(missing);
    const git = gitFor(s.t.env, repo);
    // A preceding permissive read must not cache a missing tree as valid empty evidence.
    if (kind === 'tree') expect(await git.tree(missing)).toEqual([]);
    const opts = {
      env: s.t.env,
      db: s.db,
      repo,
      repoFullName: 'octocat/app',
      git,
      pr,
      by: null,
      after: () => {},
    };
    expect(await landPull(opts)).toMatchObject({
      ok: false,
      status: 409,
      reason: 'stack',
      error: expect.stringContaining('completely check'),
    });
    expect(s.repo.refs.get('refs/heads/main')).toBe(s.main);
    s.repo.add(object);
    expect(
      await landPull({ ...opts, git: gitFor(s.t.env, repo) })
    ).toMatchObject({
      ok: false,
      status: 409,
      reason: 'stack',
      error: expect.stringContaining('carries'),
    });
  }
);

it('security: strict Git reads accept genuine empty trees and blobs', async () => {
  const s = await crewRepo();
  const repo = (await s.db.select().from(repositories).get())!;
  const { makeBlob, makeTree } = await import('../../git/objects');
  const tree = await makeTree([]);
  const blob = await makeBlob('');
  s.repo.add(tree, blob);
  const git = gitFor(s.t.env, repo);
  expect(await git.tree(tree.sha, true)).toEqual([]);
  expect(await git.blob(blob.sha, true)).toEqual(new Uint8Array());
});
it('security: a later-opened rebased parent is blocked using the strict patch evidence already read', async () => {
  const s = await crewRepo({ actions: true });
  const parent = await s.branch('parent');
  const source = s.repo.parseCommit(parent)!;
  const copy = await makeCommit({
    tree: source.treeHash,
    parents: source.parents,
    author: { ...source.author, timestamp: source.authoredAt },
    committer: { ...source.committer, timestamp: source.committedAt + 1 },
    message: source.message,
  });
  s.repo.add(copy);
  s.repo.refs.set('refs/heads/child', copy.sha);
  await commitPaths(
    s.repo,
    'child',
    { ...FILES, 'parent.txt': 'parent\n', 'child.txt': 'child\n' },
    'child'
  );
  await s.web('child');
  await s.web('parent');
  const pr = (await s.db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  const repo = (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;
  const git = gitFor(s.t.env, repo);
  const diff = git.diffTrees.bind(git);
  vi.spyOn(git, 'diffTrees').mockImplementation(
    async (a, b, prefix, strict) => {
      if (!strict)
        throw new Error(
          'a permissive second read must not authorize a landing'
        );
      return diff(a, b, prefix, strict);
    }
  );
  const result = await landPull({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    git,
    pr,
    by: null,
    after: () => {},
  });
  expect(result).toMatchObject({
    ok: false,
    status: 409,
    reason: 'stack',
    error: expect.stringContaining('of #2'),
  });
  expect(s.repo.refs.get('refs/heads/main')).toBe(s.main);
});
it('security: release refuses unknown pending-landing ancestry when an Artifacts commit is unreadable', async () => {
  const s = await crewRepo();
  await s.mergedRow(1, 'first', Date.now(), { sha: s.main });
  await s.mergedRow(2, 'pending', Date.now(), { sha: s.main });
  await s.db
    .update(pullRequests)
    .set({
      state: 'open',
      mergeCommitSha: null,
      mergedAt: null,
      closedAt: null,
    })
    .where(eq(pullRequests.number, 2));
  const pr = (await s.db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 2))
    .get())!;
  const repo = (await s.db.select().from(repositories).get())!;
  await s.db.insert(landingIntents).values({
    id: crypto.randomUUID(),
    repositoryId: repo.id,
    pullRequestId: pr.id,
    target: 'main',
    baseSha: s.main,
    headSha: 'f'.repeat(40),
    landHeadSha: 'f'.repeat(40),
    pullRefBefore: s.main,
    landedCommits: 1,
    automatic: true,
    createdAt: new Date(),
  });
  const actor = (await s.t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>())!;
  const result = await cutRelease({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    origin: 'https://git.test',
    actor,
    headSha: s.main,
    version: 'v1.0.0',
  });
  expect(result).toMatchObject({ ok: false, status: 409 });
  expect(s.repo.refs.has('refs/tags/v1.0.0')).toBe(false);
});
