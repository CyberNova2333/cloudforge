import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import {
  MAX_PUSH_EVENT_ATTEMPTS,
  PUSH_EVENT_LEASE_MS,
  recordPush,
  recoverPushEvents,
} from '../../git/push-events';
import { commitPaths } from '../helpers/seed';
import { CI, pushFiles, setup, type Setup } from '../helpers/actions';

const db = (s: Setup) => drizzle(s.t.env.DB, { schema });
const events = (s: Setup) =>
  s.t.env.DB.prepare(
    'SELECT id, attempts, completed_at FROM push_events ORDER BY created_at'
  )
    .all<{ id: string; attempts: number; completed_at: number | null }>()
    .then((r) => r.results);
const runCount = (s: Setup) =>
  s.t.env.DB.prepare('SELECT count(*) AS n FROM workflow_runs')
    .first<{ n: number }>()
    .then((r) => r!.n);

/** A push whose follow-ups never ran (its background was cut off): main moved to a commit with a workflow. */
async function interruptedPush(s: Setup) {
  const old = s.repo.refs.get('refs/heads/main')!;
  const sha = await commitPaths(
    s.repo,
    'main',
    { '.github/workflows/ci.yml': CI },
    'Add CI'
  );
  const repoId = s.repo.name.slice(2);
  const id = await recordPush(
    db(s),
    repoId,
    null,
    [{ ref: 'refs/heads/main', old, new: sha }],
    new Date(Date.now() - PUSH_EVENT_LEASE_MS - 1000)
  );
  return { id, repoId };
}

describe('推送后续处理的持久化', () => {
  it('推送先记录事件，后台处理完成后标记完成', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [event] = await events(s);
    expect(event).toMatchObject({ attempts: 1 });
    expect(event.completed_at).not.toBeNull();
    expect(await runCount(s)).toBe(1);
  });

  it('后台被中断的事件由每日恢复补跑，再跑一次也不重复排队运行', async () => {
    const s = await setup();
    const { id } = await interruptedPush(s);
    expect(await runCount(s)).toBe(0);
    expect(await recoverPushEvents(s.t.env, db(s))).toBe(1);
    expect(await runCount(s)).toBe(1);
    expect((await events(s))[0]).toMatchObject({ id, attempts: 1 });
    // A second run of the same event (its completion was lost, and its lease ran out) finds the run it queued.
    await s.t.env.DB.prepare(
      'UPDATE push_events SET completed_at = NULL, claimed_at = NULL'
    ).run();
    expect(await recoverPushEvents(s.t.env, db(s))).toBe(1);
    expect(await runCount(s)).toBe(1);
  });

  it('同一仓库的下一次推送顺带补跑之前未完成的事件', async () => {
    const s = await setup();
    await interruptedPush(s);
    await pushFiles(s, 'feature', { 'a.txt': 'a\n' }, 'feature work');
    expect((await events(s)).every((e) => e.completed_at !== null)).toBe(true);
    expect(await runCount(s)).toBeGreaterThanOrEqual(1);
  });

  it('租约内的事件和用完次数的事件不会被恢复', async () => {
    const s = await setup();
    const { id } = await interruptedPush(s);
    await s.t.env.DB.prepare('UPDATE push_events SET claimed_at = ?')
      .bind(Date.now())
      .run();
    expect(await recoverPushEvents(s.t.env, db(s))).toBe(0);
    await s.t.env.DB.prepare(
      'UPDATE push_events SET claimed_at = NULL, attempts = ?'
    )
      .bind(MAX_PUSH_EVENT_ATTEMPTS)
      .run();
    expect(await recoverPushEvents(s.t.env, db(s))).toBe(0);
    expect(await runCount(s)).toBe(0);
    // Kept a week, then deleted.
    await recoverPushEvents(s.t.env, db(s), {
      now: new Date(Date.now() + 8 * 86_400_000),
    });
    expect((await events(s)).map((e) => e.id)).not.toContain(id);
  });
});
