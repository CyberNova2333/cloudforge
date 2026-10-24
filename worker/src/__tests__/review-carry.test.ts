// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import type { AgentReview } from '../review/contract';
import { carryApprovalsOnSameTree, carryReview } from '../review/carry';
import { gitFor } from '../lib/repos';
import type { Repository } from '../db/app.schema';
import { call, type TestEnv } from './helpers/app';
import { commitPaths } from './helpers/seed';
import {
  AGENT_MD,
  agentModels,
  appRepo,
  BASE,
  invitedAgent,
  openPull,
  runReviews,
  startReview,
} from './helpers/reviews';
import { decide, finding, findings } from './helpers/lessons';
import { fakeResolver, moved, runRebases } from './helpers/rebase';

const ONE_FOR_A_PERSON: AgentReview = {
  verdict: 'findings',
  summary: 'One thing for a person.',
  findings: [finding('needs_person', 'Check the token')],
};

const prId = async (t: TestEnv) =>
  (await t.env.DB.prepare(
    'SELECT id FROM pull_requests WHERE number = 1'
  ).first<{ id: string }>())!.id;

const heads = async (t: TestEnv, table: string) =>
  (
    await t.env.DB.prepare(`SELECT DISTINCT head_sha AS h FROM ${table}`).all<{
      h: string;
    }>()
  ).results.map((r) => r.h);

const count = async (t: TestEnv, table: string) =>
  (await t.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>())!.n;

/**
 * octocat/app with @secagent, PR #1 changing `changes` (auto-merge off), reviewed (one finding for a person, approved),
 * approved.
 */
async function reviewedAndApproved(changes: Record<string, string>) {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin, 'secagent', AGENT_MD());
  const { head } = await openPull(t, admin, repo, changes);
  // Approved, it would auto-merge: it stays open to be rebased.
  await t.env.DB.prepare(
    'UPDATE pull_requests SET auto_merge_disabled_at = 1'
  ).run();
  await startReview(t);
  await runReviews(t, agentModels({ review: () => ONE_FOR_A_PERSON }).models);
  const [flag] = await findings(t);
  await decide(t, admin, flag.id);
  const res = await call(t, '/api/repos/octocat/app/pulls/1/approval', {
    cookie: admin,
    method: 'POST',
  });
  expect(res.status).toBe(200);
  return { t, admin, repo, head, flag };
}

const reviewPayloadsFor = (t: TestEnv, id: string) =>
  t.actions.resolutions.filter(
    (r) => (r.params as { headReview?: { id: string } }).headReview?.id === id
  );

type View = {
  review: {
    headSha: string;
    status: string | null;
    reviewers: { agent: { username: string }; status: string }[];
    earlier: { headSha: string }[];
    verdict: { state: string } | null;
  };
};

describe('审查结果沿用', () => {
  it('将意见、审查结论及批准转移到干净变基产生的新分支头', async () => {
    const { t, admin, repo, head, flag } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    const old = repo.refs.get('refs/heads/main')!;
    await commitPaths(repo, 'main', { ...BASE, 'z.txt': 'z\n' }, 'Main moves');
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    const id = await prId(t);
    expect(
      (
        await t.env.DB.prepare('SELECT id FROM pr_classifications').all<{
          id: string;
        }>()
      ).results.map((r) => r.id)
    ).toEqual([`${id}-${now}`]);
    expect(await findings(t)).toEqual([
      expect.objectContaining({ id: flag.id }),
    ]);
    expect(await heads(t, 'pr_reviewers')).toEqual([now]);
    expect(await heads(t, 'pr_approvals')).toEqual([now]);
    // Nothing reviews the new head again.
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toEqual([]);
    // The page shows the review once: on the head, not again among earlier commits' reviews.
    const { review } = (await (
      await call(t, '/api/repos/octocat/app/pulls/1', { cookie: admin })
    ).json()) as View;
    expect(review.headSha).toBe(now);
    expect(review.status).toBe('done');
    expect(review.reviewers.map((r) => r.agent.username)).toEqual(['secagent']);
    expect(review.earlier).toEqual([]);
  });

  it('经 AI 解决冲突后重新审查，并将原批准保留在旧分支头', async () => {
    const { t, repo, head } = await reviewedAndApproved({
      'src/app.ts': 'export const a = 2;\n',
    });
    const old = repo.refs.get('refs/heads/main')!;
    await commitPaths(
      repo,
      'main',
      { 'src/app.ts': 'export const a = 3;\n' },
      'Main moves'
    );
    await moved(t, 'main', old);
    const { resolver } = fakeResolver(() => ({
      files: { 'src/app.ts': 'export const a = 23;\n' },
    }));
    await runRebases(t, { resolver });
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    const id = await prId(t);
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toHaveLength(1);
    expect(await heads(t, 'pr_approvals')).toEqual([head]);
  });

  it('重放提交不再产生相同变更时重新审查', async () => {
    const { t, repo, head } = await reviewedAndApproved({
      'src/app.ts': 'export const a = 2;\n',
      'src/b.ts': 'export const b = 1;\n',
    });
    const old = repo.refs.get('refs/heads/main')!;
    // main makes the same change to src/app.ts, plus another: the replayed commit only adds src/b.ts now.
    await commitPaths(
      repo,
      'main',
      { 'src/app.ts': 'export const a = 2;\n', 'z.txt': 'z\n' },
      'Main moves'
    );
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    expect(reviewPayloadsFor(t, `${await prId(t)}-${now}`)).toHaveLength(1);
  });

  it('因目标已包含变更而省略提交时保留审查结果', async () => {
    const { t, repo } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    // A second commit of the pull request, reviewed.
    const two = { ...BASE, 'src/auth.ts': 'export const t = 1;\n' };
    const head = await commitPaths(
      repo,
      'feature',
      { ...two, 'src/b.ts': 'export const b = 1;\n' },
      'Add b'
    );
    await startReview(t);
    await runReviews(t, agentModels({ review: () => ONE_FOR_A_PERSON }).models);
    const old = repo.refs.get('refs/heads/main')!;
    // main lands the first commit's change (as a parent pull request landing would): the replay leaves it out.
    await commitPaths(repo, 'main', two, 'Same as the first commit');
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    const id = await prId(t);
    const rebased = await t.env.DB.prepare(
      "SELECT json_extract(data, '$.skipped') AS skipped FROM pr_events WHERE kind = 'rebased'"
    ).first<{ skipped: number }>();
    expect(rebased!.skipped).toBe(1);
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toEqual([]);
    expect(
      await t.env.DB.prepare(
        'SELECT status FROM pr_classifications WHERE id = ?'
      )
        .bind(`${id}-${now}`)
        .first<{ status: string }>()
    ).toEqual({ status: 'done' });
  });

  it('因目标曾合入再撤销该变更而省略提交时重新审查', async () => {
    const { t, admin, repo } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    const two = { ...BASE, 'src/auth.ts': 'export const t = 1;\n' };
    const head = await commitPaths(
      repo,
      'feature',
      { ...two, 'src/b.ts': 'export const b = 1;\n' },
      'Add b'
    );
    await startReview(t);
    await runReviews(t, agentModels({ review: () => ONE_FOR_A_PERSON }).models);
    const approved = await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    expect(approved.status).toBe(200);
    const old = repo.refs.get('refs/heads/main')!;
    // main lands the first commit's change, then reverts it: the replay leaves the commit out (as git does), so the
    // pull request no longer makes the change that was reviewed.
    await commitPaths(repo, 'main', two, 'Same as the first commit');
    await commitPaths(repo, 'main', BASE, 'Revert it');
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    const rebased = await t.env.DB.prepare(
      "SELECT json_extract(data, '$.skipped') AS skipped FROM pr_events WHERE kind = 'rebased'"
    ).first<{ skipped: number }>();
    expect(rebased!.skipped).toBe(1);
    const id = await prId(t);
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toHaveLength(1);
    expect(await heads(t, 'pr_approvals')).not.toContain(now);
  });

  it('代理仍在审查时，不沿用其失败的审查结果', async () => {
    const { t, repo, head } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    const id = await prId(t);
    await t.env.DB.prepare(
      "UPDATE pr_classifications SET status = 'failed'"
    ).run();
    await t.env.DB.prepare(
      "UPDATE pr_reviewers SET status = 'reviewing'"
    ).run();
    const old = repo.refs.get('refs/heads/main')!;
    await commitPaths(repo, 'main', { ...BASE, 'z.txt': 'z\n' }, 'Main moves');
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    expect(now).not.toBe(head);
    expect(
      await t.env.DB.prepare(
        'SELECT status FROM pr_classifications WHERE id = ?'
      )
        .bind(`${id}-${head}`)
        .first<{ status: string }>()
    ).toEqual({ status: 'failed' });
    expect(await heads(t, 'pr_reviewers')).toEqual([head]);
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toHaveLength(1);
  });

  it('沿用的审查及批准已满足全部条件时自动合入拉取请求', async () => {
    const { t, repo } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    // Auto-merge turned back on without a trigger: only the rebase's own check can land it (no Actions workflows).
    await t.env.DB.prepare(
      'UPDATE pull_requests SET auto_merge_disabled_at = NULL'
    ).run();
    const old = repo.refs.get('refs/heads/main')!;
    await commitPaths(repo, 'main', { ...BASE, 'z.txt': 'z\n' }, 'Main moves');
    await moved(t, 'main', old);
    await runRebases(t);
    expect(
      await t.env.DB.prepare(
        'SELECT state FROM pull_requests WHERE number = 1'
      ).first<{ state: string }>()
    ).toEqual({ state: 'merged' });
  });

  it('正在进行的审查留在旧分支头，但仍沿用批准', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    const { head } = await openPull(t, admin, repo, {
      'src/auth.ts': 'export const t = 1;\n',
    });
    await t.env.DB.prepare(
      'UPDATE pull_requests SET auto_merge_disabled_at = 1'
    ).run();
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    const old = repo.refs.get('refs/heads/main')!;
    await commitPaths(repo, 'main', { ...BASE, 'z.txt': 'z\n' }, 'Main moves');
    await moved(t, 'main', old);
    await runRebases(t);
    const now = repo.refs.get('refs/heads/feature')!;
    const id = await prId(t);
    const reviews = (
      await t.env.DB.prepare(
        'SELECT id FROM pr_classifications ORDER BY created_at'
      ).all<{ id: string }>()
    ).results.map((r) => r.id);
    expect(reviews[0]).toBe(`${id}-${head}`);
    expect(reviewPayloadsFor(t, `${id}-${now}`)).toHaveLength(1);
    expect(await heads(t, 'pr_approvals')).toEqual([now]);
  });

  it('重复沿用或目标分支头已有审查时保持幂等，不重复迁移', async () => {
    const { t, repo, head, flag } = await reviewedAndApproved({
      'src/auth.ts': 'export const t = 1;\n',
    });
    const db = drizzle(t.env.DB, { schema });
    const id = await prId(t);
    const pr = { id };
    const to = 'f'.repeat(40);
    const before = {
      reviewers: await count(t, 'pr_reviewers'),
      flags: await count(t, 'pr_review_flags'),
      approvals: await count(t, 'pr_approvals'),
    };
    expect(await carryReview(db, pr, head, to)).toBe(true);
    // A retried step: nothing left on the old head, nothing duplicated.
    expect(await carryReview(db, pr, head, to)).toBe(false);
    expect(await heads(t, 'pr_reviewers')).toEqual([to]);
    expect(await heads(t, 'pr_approvals')).toEqual([to]);
    expect(
      (
        await t.env.DB.prepare('SELECT id FROM pr_classifications').all<{
          id: string;
        }>()
      ).results.map((r) => r.id)
    ).toEqual([`${id}-${to}`]);
    expect(await findings(t)).toEqual([
      expect.objectContaining({ id: flag.id }),
    ]);
    expect({
      reviewers: await count(t, 'pr_reviewers'),
      flags: await count(t, 'pr_review_flags'),
      approvals: await count(t, 'pr_approvals'),
    }).toEqual(before);
    // Back again; a target head that already has its own review keeps it and leaves this one where it is.
    expect(await carryReview(db, pr, to, head)).toBe(true);
    const other = repo.refs.get('refs/heads/main')!; // any other sha
    await t.env.DB.prepare(
      `INSERT INTO pr_classifications (id, pull_request_id, head_sha, status, summary_model, classifier_model, created_at)
       VALUES (?, ?, ?, 'done', 'm', 'c', 0)`
    )
      .bind(`${id}-${other}`, id, other)
      .run();
    expect(await carryReview(db, pr, head, other)).toBe(false);
    expect(await count(t, 'pr_classifications')).toBe(2);
    expect(await heads(t, 'pr_reviewers')).toEqual([head]);
    expect(await findings(t)).toEqual([
      expect.objectContaining({ id: flag.id }),
    ]);
  });
});

describe('不修改文件的提交批准', () => {
  const FILES = { 'src/auth.ts': 'export const t = 1;\n' };

  async function pushed(files: Record<string, string>) {
    const { t, admin, repo } = await appRepo();
    const { head } = await openPull(t, admin, repo, FILES);
    await t.env.DB.prepare(
      'UPDATE pull_requests SET auto_merge_disabled_at = 1'
    ).run();
    const res = await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const next = await commitPaths(repo, 'feature', files, 'Re-run checks');
    const row = (await t.env.DB.prepare(
      "SELECT * FROM repositories WHERE name = 'app'"
    ).first<Record<string, unknown>>())!;
    const db = drizzle(t.env.DB, { schema });
    const carry = () =>
      carryApprovalsOnSameTree(
        db,
        gitFor(t.env, {
          id: row.id,
          artifactsName: row.artifacts_name,
        } as Repository),
        row.id as string,
        [{ ref: 'refs/heads/feature', old: head, new: next }]
      );
    return { t, head, next, carry };
  }

  it('将人工批准沿用到目录树相同的新分支头，且只执行一次', async () => {
    const { t, next, carry } = await pushed({ ...BASE, ...FILES });
    expect(await carry()).toHaveLength(1);
    expect(await heads(t, 'pr_approvals')).toEqual([next]);
    expect(await carry()).toEqual([]);
    expect(await count(t, 'pr_approvals')).toBe(1);
  });

  it('目录树变化时将批准保留在旧分支头', async () => {
    const { t, head, carry } = await pushed({
      ...BASE,
      'src/auth.ts': 'export const t = 2;\n',
    });
    expect(await carry()).toEqual([]);
    expect(await heads(t, 'pr_approvals')).toEqual([head]);
  });
});
