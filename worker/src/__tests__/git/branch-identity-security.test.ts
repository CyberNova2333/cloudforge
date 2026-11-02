import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/schema';
import {
  prClassifications,
  prReviewFlags,
  pullRequests,
} from '../../db/app.schema';
import { gitFor } from '../../repositories/service';
import { approvePull } from '../../review/approvals';
import { decideFlag } from '../../review/flags';
import { loadHead } from '../../review/head';
import { appRepo } from '../helpers/reviews';
import { call, settle } from '../helpers/app';
import { commitPaths } from '../helpers/seed';

const workflow = `name: Relevant CI
on:
  pull_request:
    paths: ['src/**']
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: echo checked
`;

async function setup(kind: 'base' | 'head') {
  const { t, admin, repo } = await appRepo();
  const files = {
    'src/app.ts': 'export const value = 1;\n',
    '.orangeignore': 'generated/**\n',
    '.github/workflows/ci.yml': workflow,
  };
  const base = await commitPaths(repo, 'main', files, 'base');
  repo.refs.set('refs/heads/feature', base);
  const head = await commitPaths(
    repo,
    'feature',
    {
      ...files,
      'src/app.ts': 'export const value = 2;\n',
      '.orangeignore': 'src/**\n',
    },
    'Change source and proposed ignore rules'
  );
  const baseBranch = kind === 'base' ? head : 'main';
  const headBranch = kind === 'head' ? base : 'feature';
  repo.refs.set(`refs/heads/${baseBranch}`, base);
  repo.refs.set(`refs/heads/${headBranch}`, head);
  if (kind === 'base')
    expect(
      (
        await call(t, '/api/repos/octocat/app', {
          cookie: admin,
          method: 'PATCH',
          json: { defaultBranch: baseBranch },
        })
      ).status
    ).toBe(200);
  expect(
    (
      await call(t, '/api/repos/octocat/app/pulls', {
        cookie: admin,
        json: {
          title: 'Actual branch tips',
          body: '',
          base: baseBranch,
          head: headBranch,
        },
      })
    ).status
  ).toBe(201);
  await settle(t);
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db.select().from(pullRequests).get())!;
  const repository = (await db.query.repositories.findFirst({
    where: (r, { eq }) => eq(r.id, pr.repositoryId),
  }))!;
  return {
    t,
    admin,
    db,
    pr,
    repository,
    repo,
    base,
    head,
    git: gitFor(t.env, repository),
  };
}

describe('内部 PR 分支身份不被同名提交 SHA 替换', () => {
  it('默认分支名等于 PR head SHA 时，真实变化仍触发路径过滤 CI', async () => {
    const s = await setup('base');
    const runs = await s.t.env.DB.prepare(
      'SELECT event, head_sha, workflow_path FROM workflow_runs WHERE repository_id = ?'
    )
      .bind(s.pr.repositoryId)
      .all();
    expect(runs.results).toEqual([
      {
        event: 'pull_request',
        head_sha: s.head,
        workflow_path: '.github/workflows/ci.yml',
      },
    ]);
  });

  it('默认分支名等于 PR head SHA 时，审查读取非空差异和目标分支的忽略规则', async () => {
    const s = await setup('base');
    const context = await loadHead(s.t.env, s.db, s.pr.id, s.head);
    expect(context?.ok).toBe(true);
    if (!context?.ok) return;
    expect(context.value.changes.map((change) => change.path)).toContain(
      'src/app.ts'
    );
    expect(context.value.ignoreText).toBe('generated/**\n');
  });

  it('头分支名等于旧 SHA 时，批准记录的是分支实际 head', async () => {
    const s = await setup('head');
    const result = await approvePull(
      s.t.env,
      s.db,
      s.git,
      s.pr,
      s.repository.ownerId,
      () => {},
      { followUps: false, expectedHead: s.head }
    );
    expect(result).toEqual({ ok: true, headSha: s.head });
    expect(
      await s.t.env.DB.prepare('SELECT head_sha FROM pr_approvals').first(
        'head_sha'
      )
    ).toBe(s.head);
  });

  it('头分支名等于旧 SHA 时，不能把旧同名提交作为当前 head 批准', async () => {
    const s = await setup('head');
    const result = await approvePull(
      s.t.env,
      s.db,
      s.git,
      s.pr,
      s.repository.ownerId,
      () => {},
      { followUps: false, expectedHead: s.base }
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(
      await s.t.env.DB.prepare('SELECT head_sha FROM pr_approvals').first()
    ).toBeNull();
  });

  it.each([false, true])(
    'finding 的预期 head 检查按真实分支判断（当前 finding=%s）',
    async (current) => {
      const s = await setup('head');
      const sha = current ? s.head : s.base;
      const classification = `${s.pr.id}-${sha}`;
      const id = crypto.randomUUID();
      await s.db.batch([
        s.db.insert(prClassifications).values({
          id: classification,
          pullRequestId: s.pr.id,
          headSha: sha,
          status: 'done',
          summaryModel: 'fixture',
          classifierModel: 'fixture',
          createdAt: new Date(),
        }),
        s.db.insert(prReviewFlags).values({
          id,
          classificationId: classification,
          key: 'fixture',
          value: { title: 'Check actual head' },
          paths: ['src/app.ts'],
          kind: 'needs_person',
          createdAt: new Date(),
        }),
      ]);
      const result = await decideFlag(
        s.t.env,
        s.db,
        s.pr,
        id,
        s.repository.ownerId,
        { kind: 'approve' },
        (work) => s.t.ctx.waitUntil(work),
        { expectedHead: { sha, git: s.git } }
      );
      if (current) expect(result).toEqual({ ok: true });
      else expect(result).toMatchObject({ ok: false, status: 409 });
      const flag = (await s.db
        .select()
        .from(prReviewFlags)
        .where(eq(prReviewFlags.id, id))
        .get())!;
      expect(flag.approvedAt !== null).toBe(current);
      await settle(s.t);
    }
  );
});
