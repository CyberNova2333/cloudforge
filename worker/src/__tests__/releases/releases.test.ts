// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { repositories } from '../../db/app.schema';
import { onRefsUpdated } from '../../actions/trigger';
import { GitService } from '../../git/service';
import { ZERO_SHA } from '../../git/remote';
import { gitFor } from '../../repositories/service';
import {
  cutRelease,
  getRelease,
  listReleases,
  releasedIn,
  unreleased,
} from '../../releases/service';
import { call, settle } from '../helpers/app';
import { recordPush, runPushEvent } from '../../git/push-events';
import { crewRepo, FILES, type CrewRepo } from '../helpers/crew';
import { commitPaths } from '../helpers/seed';

const ORIGIN = 'https://git.test';
const NAME = 'octocat/app';

const repoRow = async (s: CrewRepo) =>
  (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;

const head = (s: CrewRepo, branch = 'main') =>
  s.repo.refs.get(`refs/heads/${branch}`)!;

let at = 1_760_000_000_000;

/** A pull request landed on `base` (default main), with its bump. */
async function landed(
  s: CrewRepo,
  n: number,
  bump: 'major' | 'minor' | 'patch' | null,
  opts: { title?: string; base?: string } = {}
) {
  await s.mergedRow(n, `topic-${n}`, (at += 60_000), {
    title: opts.title ?? `Change ${n}`,
    base: opts.base,
  });
  await s.t.env.DB.prepare(
    'UPDATE pull_requests SET version_bump = ? WHERE repository_id = ? AND number = ?'
  )
    .bind(bump, s.repoId, n)
    .run();
}

/** `count` more landed pull requests after pull request `after`, in one write. */
async function landedMany(s: CrewRepo, count: number, after = 0) {
  const admin = await s.t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>();
  const insert = s.t.env.DB.prepare(
    `INSERT INTO pull_requests (id, repository_id, number, title, author_id, base_ref, land_target, head_ref, state, merge_commit_sha, landed_commits, merged_at, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'main', 'main', ?, 'merged', NULL, NULL, ?, ?, ?, ?)`
  );
  await s.t.env.DB.batch(
    Array.from({ length: count }, (_, i) => {
      const n = after + i + 1;
      const at = 1_760_000_000 + n * 60;
      return insert.bind(
        `${s.repoId}-m${n}`,
        s.repoId,
        n,
        `Change ${n}`,
        admin!.id,
        `topic-${n}`,
        at,
        at,
        at - 3600,
        at
      );
    })
  );
  await s.t.env.DB.prepare(
    'UPDATE repositories SET next_pr_number = MAX(next_pr_number, ?) WHERE id = ?'
  )
    .bind(after + count + 1, s.repoId)
    .run();
}

async function pending(s: CrewRepo) {
  return unreleased(s.db, await repoRow(s), ORIGIN, NAME);
}

async function cut(
  s: CrewRepo,
  opts: { version?: string; headSha?: string; title?: string } = {}
) {
  const admin = await s.t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>();
  return cutRelease({
    env: s.t.env,
    db: s.db,
    repo: await repoRow(s),
    repoFullName: NAME,
    origin: ORIGIN,
    actor: { id: admin!.id },
    headSha: opts.headSha ?? head(s),
    version: opts.version,
    title: opts.title,
  });
}

const RELEASE_WORKFLOW = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo publish
`;

async function workflowRuns(s: CrewRepo) {
  return (
    await s.t.env.DB.prepare(
      'SELECT ref, head_sha FROM workflow_runs WHERE repository_id = ?'
    )
      .bind(s.repoId)
      .all<{ ref: string; head_sha: string }>()
  ).results;
}

async function releaseRows(s: CrewRepo) {
  return (
    await s.t.env.DB.prepare(
      'SELECT tag FROM releases WHERE repository_id = ? ORDER BY tag'
    )
      .bind(s.repoId)
      .all<{ tag: string }>()
  ).results.map((r) => r.tag);
}

describe('未发布变更', () => {
  it('列出合入默认分支的未发布拉取请求及其版本升级级别', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'minor', { title: 'Add search' });
    await landed(s, 2, null, { title: 'Fix typo' });
    const u = await pending(s);
    expect(u.pulls).toEqual([
      expect.objectContaining({
        number: 1,
        title: 'Add search',
        author: 'octocat',
        bump: 'minor',
      }),
      expect.objectContaining({
        number: 2,
        title: 'Fix typo',
        author: 'octocat',
        bump: null,
      }),
    ]);
    expect(typeof u.pulls[0].mergedAt).toBe('number');
    expect(u.latest).toBeNull();
  });

  it('合入其他分支的拉取请求不计入未发布变更', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'minor');
    await landed(s, 2, 'major', { base: 'feature/stack' });
    expect((await pending(s)).pulls.map((p) => p.number)).toEqual([1]);
  });

  it('重命名默认分支', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'minor');
    await commitPaths(s.repo, 'trunk', FILES, 'trunk');
    await s.setRepo('default_branch', 'trunk');
    expect((await pending(s)).pulls).toEqual([]);
    await landed(s, 2, 'patch', { base: 'trunk' });
    expect((await pending(s)).pulls.map((p) => p.number)).toEqual([2]);
  });
});

describe('创建发布版本', () => {
  it('首次发布必须手动指定版本号', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'minor');
    const u = await pending(s);
    expect(u.next).toBeNull();
    expect(u.notesPreview).toBe('First release.');
    expect(await cut(s)).toEqual({
      ok: false,
      status: 400,
      message: 'The first release needs a version, for example v0.1.0',
    });
    expect(await releaseRows(s)).toEqual([]);
  });

  it('首次发布记录全部历史内容但不逐项列出', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'minor');
    await landed(s, 2, null);
    const r = await cut(s, { version: 'v0.1.0' });
    if (!r.ok) throw new Error(r.message);
    expect(r.release.tag).toBe('v0.1.0');
    expect(r.release.title).toBe('v0.1.0');
    expect(r.release.notes).toBe('First release.');
    expect(r.release.commitSha).toBe(head(s));
    expect(r.release.createdBy).toBe('octocat');
    expect(r.release.pulls).toEqual([]);
    const recorded = await s.t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM release_pulls'
    ).first<{ n: number }>();
    expect(recorded!.n).toBe(2);
    const u = await pending(s);
    expect(u.pulls).toEqual([]);
    expect(u.next).toBeNull();
    expect(u.latest?.tag).toBe('v0.1.0');
    expect(s.repo.refs.get('refs/tags/v0.1.0')).toBe(head(s));
    const audit = await s.t.env.DB.prepare(
      "SELECT target FROM audit_events WHERE action = 'release.created'"
    ).all<{ target: string }>();
    expect(audit.results).toEqual([{ target: 'v0.1.0' }]);
  });

  it('下一版本采用最大的升级级别', async () => {
    const s = await crewRepo();
    await landed(s, 1, 'major');
    expect((await cut(s, { version: 'v0.1.0' })).ok).toBe(true);
    await commitPaths(s.repo, 'main', { ...FILES, 'b.txt': 'b' }, 'more');
    await landed(s, 2, 'patch', { title: 'Fix the footer' });
    await landed(s, 3, 'minor', { title: 'Add search' });
    const u = await pending(s);
    expect(u.next).toBe('v0.2.0');
    expect(u.notesPreview).toContain('### Minor');
    const r = await cut(s);
    if (!r.ok) throw new Error(r.message);
    expect(r.release.tag).toBe('v0.2.0');
    expect(s.repo.refs.get('refs/tags/v0.2.0')).toBe(head(s));
    expect(r.release.notes).toBe(
      [
        '### Minor',
        '',
        '- Add search (#3) @octocat',
        '',
        '### Patch',
        '',
        '- Fix the footer (#2) @octocat',
        '',
        `Full changes: ${ORIGIN}/${NAME}/compare/v0.1.0...v0.2.0`,
      ].join('\n')
    );
    expect(r.release.pulls).toEqual([
      { number: 2, title: 'Fix the footer', bump: 'patch' },
      { number: 3, title: 'Add search', bump: 'minor' },
    ]);
    // The preview is what the cut writes.
    expect(r.release.notes).toBe(u.notesPreview);
  });

  it('缺省升级级别按 patch 处理', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.2.0' })).ok).toBe(true);
    await landed(s, 2, null);
    await landed(s, 3, null);
    expect((await pending(s)).next).toBe('v0.2.1');
    const r = await cut(s);
    expect(r.ok && r.release.tag).toBe('v0.2.1');
  });

  it('手动指定的版本必须更高且未被占用', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.2.0' })).ok).toBe(true);
    await landed(s, 2, null);
    expect(await cut(s, { version: 'v0.1.0' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await cut(s, { version: 'v0.2.0' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await cut(s, { version: '1.0.0' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await cut(s, { version: 'v1.0.0-rc.1' })).toMatchObject({
      ok: false,
      status: 400,
    });
    const r = await cut(s, { version: 'v1.0.0' });
    expect(r.ok && r.release.tag).toBe('v1.0.0');
  });

  it('手动推送的同名标签阻止使用计算出的版本', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.2.9' })).ok).toBe(true);
    const old = head(s);
    await commitPaths(s.repo, 'main', { ...FILES, 'b.txt': 'b' }, 'more');
    // Pushed by hand at an older commit: not a release, and never moved.
    s.repo.refs.set('refs/tags/v0.3.0', old);
    await landed(s, 2, 'minor');
    expect((await pending(s)).next).toBe('v0.3.0');
    expect(await cut(s)).toEqual({
      ok: false,
      status: 409,
      message: 'Tag v0.3.0 already exists; type a version',
    });
    expect(s.repo.refs.get('refs/tags/v0.3.0')).toBe(old);
    // Typed, the same version is refused for the same reason; another one goes through.
    expect(await cut(s, { version: 'v0.3.0' })).toMatchObject({
      ok: false,
      status: 409,
    });
    const r = await cut(s, { version: 'v0.3.1' });
    expect(r.ok && r.release.tag).toBe('v0.3.1');
    // The hand-pushed tag never counts as the latest release.
    expect(
      (await listReleases(s.db, await repoRow(s))).map((x) => x.tag)
    ).toEqual(['v0.3.1', 'v0.2.9']);
  });

  it('默认分支移动时返回 409，并附带新分支头', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    const seen = head(s);
    const moved = await commitPaths(
      s.repo,
      'main',
      { ...FILES, 'b.txt': 'b' },
      'more'
    );
    expect(await cut(s, { version: 'v0.1.0', headSha: seen })).toEqual({
      ok: false,
      status: 409,
      message: expect.stringContaining(moved),
      head: moved,
    });
    expect(s.repo.refs.get('refs/tags/v0.1.0')).toBeUndefined();
  });

  it('没有可发布内容时返回 409', async () => {
    const s = await crewRepo();
    expect(await cut(s, { version: 'v0.1.0' })).toEqual({
      ok: false,
      status: 409,
      message: 'Nothing to release',
    });
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.1.0' })).ok).toBe(true);
    expect(await cut(s)).toEqual({
      ok: false,
      status: 409,
      message: 'Nothing to release',
    });
    expect(s.repo.refs.get('refs/tags/v0.1.1')).toBeUndefined();
  });

  it('并发创建发布版本', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    const results = await Promise.all([
      cut(s, { version: 'v0.1.0' }),
      cut(s, { version: 'v0.1.0' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ ok: false, status: 409 }),
    ]);
    expect(await releaseRows(s)).toEqual(['v0.1.0']);
    expect(s.repo.refs.get('refs/tags/v0.1.0')).toBe(head(s));
  });

  it('重试未完成的版本发布', async () => {
    const s = await crewRepo({ actions: true });
    await commitPaths(
      s.repo,
      'main',
      { ...FILES, '.github/workflows/release.yml': RELEASE_WORKFLOW },
      'Add the release workflow'
    );
    await landed(s, 1, null);
    // Fail the actual accounting batch after a successful tag creation and durable receipt.
    await s.t.env.DB.exec(
      "CREATE TRIGGER fail_release_accounting BEFORE INSERT ON releases BEGIN SELECT RAISE(ABORT, 'injected accounting failure'); END"
    );
    try {
      await expect(cut(s, { version: 'v0.1.0' })).rejects.toThrow(
        'injected accounting failure'
      );
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER fail_release_accounting');
    }
    expect(s.repo.refs.get('refs/tags/v0.1.0')).toBe(head(s));
    expect(await releaseRows(s)).toEqual([]);
    const r = await cut(s, { version: 'v0.1.0' });
    expect(r.ok && r.release.tag).toBe('v0.1.0');
    expect(await releaseRows(s)).toEqual(['v0.1.0']);
    expect(await workflowRuns(s)).toEqual([
      { ref: 'refs/tags/v0.1.0', head_sha: head(s) },
    ]);
  });

  it('不接管位于分支头且已触发运行的手动推送标签', async () => {
    const s = await crewRepo({ actions: true });
    await commitPaths(
      s.repo,
      'main',
      { ...FILES, '.github/workflows/release.yml': RELEASE_WORKFLOW },
      'Add the release workflow'
    );
    await landed(s, 1, null);
    // Pushed with git at the head: the push queued the tag's runs.
    s.repo.refs.set('refs/tags/v0.1.0', head(s));
    const admin = await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>();
    await onRefsUpdated(
      s.t.env,
      s.db,
      await repoRow(s),
      NAME,
      [{ ref: 'refs/tags/v0.1.0', old: ZERO_SHA, new: head(s) }],
      admin!.id
    );
    expect(await workflowRuns(s)).toHaveLength(1);
    expect(await cut(s, { version: 'v0.1.0' })).toEqual({
      ok: false,
      status: 409,
      message: 'Tag v0.1.0 already exists; type a version',
    });
    expect(await releaseRows(s)).toEqual([]);
    expect(await workflowRuns(s)).toHaveLength(1);
  });

  it('已推送但尚未标记为已合入的拉取请求阻止发布', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    // landPull pushed the default branch and refs/pull/2/head to the same commit, and has not recorded it yet.
    await s.mergedRow(2, 'topic-2', (at += 60_000));
    await s.t.env.DB.prepare(
      "UPDATE pull_requests SET state = 'open', merged_at = NULL, closed_at = NULL, merge_commit_sha = NULL WHERE repository_id = ? AND number = 2"
    )
      .bind(s.repoId)
      .run();
    s.repo.refs.set('refs/pull/2/head', head(s));
    expect(await cut(s, { version: 'v0.1.0' })).toEqual({
      ok: false,
      status: 409,
      message: 'A pull request is landing; try again in a moment',
    });
    expect(s.repo.refs.get('refs/tags/v0.1.0')).toBeUndefined();
    expect(await releaseRows(s)).toEqual([]);
  });

  it('并发创建不同版本保留已创建的不可变标签，只记录一个发布', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    const results = await Promise.all([
      cut(s, { version: 'v0.1.0' }),
      cut(s, { version: 'v0.2.0' }),
    ]);
    const won = results.filter((r) => r.ok);
    expect(won).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ ok: false, status: 409 }),
    ]);
    const tag = won[0].ok ? won[0].release.tag : '';
    const lost = tag === 'v0.1.0' ? 'v0.2.0' : 'v0.1.0';
    expect(await releaseRows(s)).toEqual([tag]);
    expect(s.repo.refs.get(`refs/tags/${tag}`)).toBe(head(s));
    expect(s.repo.refs.get(`refs/tags/${lost}`)).toBe(head(s));
  });

  it('版本标签触发推送工作流运行', async () => {
    const s = await crewRepo({ actions: true });
    await commitPaths(
      s.repo,
      'main',
      {
        ...FILES,
        '.github/workflows/release.yml': RELEASE_WORKFLOW,
      },
      'Add the release workflow'
    );
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.1.0' })).ok).toBe(true);
    const runs = await s.t.env.DB.prepare(
      'SELECT ref, head_sha FROM workflow_runs'
    ).all<{ ref: string; head_sha: string }>();
    expect(runs.results).toEqual([
      { ref: 'refs/tags/v0.1.0', head_sha: head(s) },
    ]);
  });

  it('发布内容冻结', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.1.0' })).ok).toBe(true);
    await landed(s, 2, 'minor', { title: 'Add search' });
    const second = await cut(s);
    if (!second.ok) throw new Error(second.message);
    await landed(s, 3, 'major');
    const repo = await repoRow(s);
    const v020 = await getRelease(s.db, repo, 'v0.2.0');
    expect(v020?.pulls).toEqual([
      { number: 2, title: 'Add search', bump: 'minor' },
    ]);
    expect(await getRelease(s.db, repo, 'v9.9.9')).toBeNull();
    expect(await releasedIn(s.db, `${s.repoId}-m1`)).toBe('v0.1.0');
    expect(await releasedIn(s.db, `${s.repoId}-m2`)).toBe('v0.2.0');
    expect(await releasedIn(s.db, `${s.repoId}-m3`)).toBeNull();
    // Pull request responses carry it: the page and the list (one lookup for the whole list).
    const pull = (await (
      await call(s.t, '/api/repos/octocat/app/pulls/2', { cookie: s.admin })
    ).json()) as { pull: { releasedIn: string | null } };
    expect(pull.pull.releasedIn).toBe('v0.2.0');
    const list = (await (
      await call(s.t, '/api/repos/octocat/app/pulls?state=merged', {
        cookie: s.admin,
      })
    ).json()) as { pulls: { number: number; releasedIn: string | null }[] };
    expect(
      Object.fromEntries(list.pulls.map((p) => [p.number, p.releasedIn]))
    ).toEqual({ 1: 'v0.1.0', 2: 'v0.2.0', 3: null });
  });

  it('标签列表包含所有标签，包括手动推送的标签', async () => {
    const s = await crewRepo();
    await landed(s, 1, null);
    expect((await cut(s, { version: 'v0.1.0' })).ok).toBe(true);
    s.repo.refs.set('refs/tags/build-7', s.main);
    s.repo.refs.set('refs/tags/v0.0.9', s.main);
    s.repo.refs.set('refs/tags/v0.0.10', s.main);
    const tags = await gitFor(s.t.env, await repoRow(s)).tags();
    // Numbers compare as numbers: v0.0.10 is above v0.0.9.
    expect(tags).toEqual([
      { name: 'v0.1.0', sha: head(s) },
      { name: 'v0.0.10', sha: s.main },
      { name: 'v0.0.9', sha: s.main },
      { name: 'build-7', sha: s.main },
    ]);
  });

  // The pulls land in one write: one INSERT per pull request here takes about 2 s on a laptop but minutes on a CI
  // container, and D1 writes are what the chunking is about, not how many statements it took to get there.
  it('首次发布覆盖大量已合入拉取请求时完整记录', async () => {
    const s = await crewRepo();
    await landedMany(s, 120);
    const r = await cut(s, { version: 'v0.1.0' });
    if (!r.ok) throw new Error(r.message);
    const recorded = await s.t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM release_pulls'
    ).first<{ n: number }>();
    expect(recorded!.n).toBe(120);
    expect((await pending(s)).pulls).toEqual([]);
    // Later releases list theirs, many as they are.
    await landedMany(s, 60, 120);
    const next = await cut(s);
    if (!next.ok) throw new Error(next.message);
    expect(next.release.pulls).toHaveLength(60);
  });

  it('列出包含大量版本的变更日志', async () => {
    const s = await crewRepo();
    const admin = (await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!.id;
    await landed(s, 1, 'minor', { title: 'Add search' });
    const insert = s.t.env.DB.prepare(
      `INSERT INTO releases (id, repository_id, tag, major, minor, patch, commit_sha, title, notes, created_by_id, previous_release_id, created_at)
       VALUES (?, ?, ?, 0, ?, 0, ?, ?, '', ?, ?, ?)`
    );
    const total = 150;
    await s.t.env.DB.batch(
      Array.from({ length: total }, (_, i) =>
        insert.bind(
          `rel-${i}`,
          s.repoId,
          `v0.${i}.0`,
          i,
          s.main,
          `v0.${i}.0`,
          admin,
          i ? `rel-${i - 1}` : null,
          1_760_000_000_000 + i
        )
      )
    );
    await s.t.env.DB.prepare(
      'INSERT INTO release_pulls (release_id, pull_request_id) VALUES (?, ?)'
    )
      .bind('rel-140', `${s.repoId}-m1`)
      .run();
    const list = await listReleases(s.db, await repoRow(s));
    expect(list).toHaveLength(total);
    expect(list[0].tag).toBe('v0.149.0');
    expect(list.every((r) => r.createdBy === 'octocat')).toBe(true);
    expect(list.find((r) => r.tag === 'v0.140.0')?.pulls).toEqual([
      { number: 1, title: 'Add search', bump: 'minor' },
    ]);
  });
});

it('a completed ordinary tag push is not adopted as a release retry', async () => {
  const s = await crewRepo({ actions: true });
  const head = await s.branch('feature');
  await s.web('feature');
  await s.merge(1);
  const repo = (await s.db
    .select()
    .from(repositories)
    .where(eq(repositories.id, s.repoId))
    .get())!;
  const actor = (await s.t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>())!;
  const tag = 'refs/tags/v1.0.0';
  // Ordinary successful Git push, including its durable follow-ups. No Actions workflows match tags in this repository.
  s.repo.refs.set(tag, head);
  const event = await recordPush(s.db, repo.id, actor.id, [
    { ref: tag, old: ZERO_SHA, new: head },
  ]);
  expect(await runPushEvent(s.t.env, event)).toBe(true);
  expect(
    (await s.t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM workflow_runs WHERE repository_id = ? AND ref = ?'
    )
      .bind(repo.id, tag)
      .first<{ n: number }>())!.n
  ).toBe(0);
  const result = await cutRelease({
    env: s.t.env,
    db: s.db,
    repo,
    repoFullName: 'octocat/app',
    origin: 'https://git.test',
    actor,
    headSha: head,
    version: 'v1.0.0',
  });
  await settle(s.t);
  const count = (await s.t.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM releases'
  ).first<{ n: number }>())!.n;
  expect({ accepted: result.ok, releaseRows: count }).toEqual({
    accepted: false,
    releaseRows: 0,
  });
  expect(s.repo.refs.get(tag)).toBe(head);
});

it('does not infer ownership after an unknown tag-create response', async () => {
  const s = await crewRepo();
  await landed(s, 1, null);
  const original = GitService.prototype.createRef;
  const spy = vi
    .spyOn(GitService.prototype, 'createRef')
    .mockImplementationOnce(async function (this: GitService, ref, sha) {
      await original.call(this, ref, sha);
      throw new Error('Injected lost tag response');
    });
  try {
    await expect(cut(s, { version: 'v0.1.0' })).rejects.toThrow(
      'Injected lost tag response'
    );
  } finally {
    spy.mockRestore();
  }
  expect(s.repo.refs.get('refs/tags/v0.1.0')).toBe(head(s));
  expect(
    await s.t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM release_tag_receipts'
    ).first('n')
  ).toBe(0);
  expect(await cut(s, { version: 'v0.1.0' })).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await releaseRows(s)).toEqual([]);
});
