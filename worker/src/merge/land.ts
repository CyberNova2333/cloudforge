// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { publishChange } from '../live/publish';
import type { DrizzleDB } from '../db/middleware';
import {
  pullRequests,
  repositories,
  landingIntents,
  type PullRequest,
  type Repository,
} from '../db/app.schema';
import { REBASE_COMMITTER } from '../git/rebase';
import { GitPushError, ZERO_SHA } from '../git/remote';
import type { GitService } from '../git/service';
import { recordAudit } from '../audit/service';
import { resolutionConfigured } from './resolution';
import {
  afterRebase,
  ensureRebase,
  queueRebasedActions,
  rebaseAt,
  rebaseBlocked,
  stopMessage,
  writeRebase,
  written,
  type RebaseTips,
} from './rebase';
import { checksAt, reviewGateFor, reviewReasonText } from '../review/gate';
import { landTargetIs, landTargetOf } from '../pulls/land-target';
import { protectedBy } from '../repositories/protected-branches';
import { stackGate } from '../stack/gate';
import { lineageOf, sharedWith } from '../stack/lineage';
import {
  closeStaleLanding,
  finishLanding,
  landingReceipt,
  landingStatus,
  recordLanding,
} from './landing-recovery';

export const pullRef = (n: number) => `refs/pull/${n}/head`;

type Refusal = {
  ok: false;
  status: 400 | 409;
  error: string;
  /** Which gate refused it (absent for other failures). */
  reason?: 'stack' | 'checks' | 'review' | 'rebase' | 'paused';
  /** Landing rebased the branch and pushed it to this head, then stopped (its checks or review, or the target moved). */
  rebased?: string;
  /** The head that rebase replaced (with `rebased`): what an agent's local commits sit on. */
  rebasedFrom?: string;
};
export type LandResult = { ok: true; sha: string; headSha: string } | Refusal;

type LandOpts = {
  env: CloudflareBindings;
  db: DrizzleDB;
  repo: Repository;
  repoFullName: string;
  git: GitService;
  pr: PullRequest;
  /** Who merged it; null for auto-merge. */
  by: { id: string; name: string; email: string } | null;
  /** The head commit the person saw: refused (409) when the branch has moved since. */
  expectedHead?: string;
  /** Runs follow-up work (Actions, sweeps) after the merge. */
  after: (work: Promise<unknown>) => void;
};

/** Why landing refuses while merging is paused on the repository (the merge button, MCP and auto-merge alike). */
export const MERGING_PAUSED =
  'Merging is paused on this repository. Anyone with push access can resume it.';

/**
 * When merging was paused on the repository and by whom; null while it isn't. Read from D1 each time, never from a
 * repository row loaded earlier, so a pause stops landings that are already on their way.
 */
export async function mergingPause(
  db: DrizzleDB,
  repositoryId: string
): Promise<{ at: Date; byId: string | null } | null> {
  const row = await db
    .select({
      at: repositories.mergingPausedAt,
      byId: repositories.mergingPausedById,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();
  return row?.at ? { at: row.at, byId: row.byId } : null;
}

/**
 * Lands a pull request by moving its land target to its head with compare-and-swap (a fast-forward): the target keeps
 * every commit with its author, message and SHA, and no commit is made. When the target moved since the branch was
 * last rebased, rebases it first and pushes the rebased branch; it then lands in the same call only when the new head
 * needs no checks and its review carried over, else it stops ("rebased — waiting for checks") and auto-merge lands it
 * once they pass.
 */
export async function landPull(opts: LandOpts): Promise<LandResult> {
  const { env, db, git, pr } = opts;
  const attempts = await db
    .select()
    .from(landingIntents)
    .where(eq(landingIntents.pullRequestId, pr.id))
    .orderBy(desc(landingIntents.createdAt))
    .all();
  // Recovery precedes the ordinary gates: the authorized Git operation has already happened. This cannot turn
  // an arbitrary contained head into a merge; both a pre-push durable intent and its remote receipt are required.
  for (const previous of attempts) {
    if (previous.finishedAt && !previous.recordedAt) continue;
    if (!previous.recordedAt) {
      const status = await landingStatus(git, pr, previous);
      if (status === 'stale') await closeStaleLanding(db, previous.id);
      if (status !== 'pushed') continue;
    }
    if (!previous.recordedAt && !(await recordLanding(db, pr, previous)))
      continue;
    if (!previous.finishedAt)
      opts.after(
        finishLanding(env, db, opts.repo, opts.repoFullName, pr, previous)
      );
    return { ok: true, sha: previous.landHeadSha, headSha: previous.headSha };
  }
  if (pr.state !== 'open')
    return { ok: false, status: 400, error: 'Pull request is not open' };
  if (await mergingPause(db, pr.repositoryId))
    return { ok: false, status: 409, reason: 'paused', error: MERGING_PAUSED };
  const target = landTargetOf(pr);
  const headSha = await git.resolveBranch(pr.headRef);
  if (!headSha)
    return {
      ok: false,
      status: 400,
      error: 'The head branch no longer exists',
    };
  if (opts.expectedHead && opts.expectedHead !== headSha)
    return {
      ok: false,
      status: 409,
      error:
        'The pull request has new commits since you looked. Review them, then merge again.',
    };
  const refusal = await landingGates(opts, pr, headSha, target);
  if (refusal) return refusal;
  const refsBefore = await git.refs();
  const baseBefore = refsBefore.get(`refs/heads/${target}`);
  if (!baseBefore)
    return {
      ok: false,
      status: 400,
      error: 'The target branch no longer exists',
    };
  const mb = await git.mergeBase(baseBefore, headSha);
  if (mb === headSha)
    return { ok: false, status: 400, error: 'Nothing to merge' };
  let landHead = headSha;
  // Set when landing rebased the branch below: a refusal after that still says so.
  let rewrote: { rebased: string; rebasedFrom: string } | undefined;
  if (mb !== baseBefore) {
    const rebased = await rebaseForLanding(opts, {
      onto: baseBefore,
      ontoBranch: target,
      head: headSha,
    });
    if (!rebased.ok) return rebased;
    landHead = rebased.head;
    if (landHead !== headSha)
      rewrote = { rebased: landHead, rebasedFrom: headSha };
  }
  // All Git reads needed to record the result happen before the commit point.
  const landedCommits = await firstParentSteps(git, baseBefore, landHead);
  const candidate = {
    id: crypto.randomUUID(),
    pullRequestId: pr.id,
    repositoryId: pr.repositoryId,
    target,
    baseSha: baseBefore,
    headSha,
    landHeadSha: landHead,
    pullRefBefore: refsBefore.get(pullRef(pr.number)) ?? ZERO_SHA,
    landedCommits,
    actorId: opts.by?.id ?? null,
    automatic: !opts.by,
    createdAt: new Date(),
  };
  // A transport error may have happened before push. Retain that attempt for late recovery, but do not let its
  // obsolete tips block a newly authorized merge. Both attempts still CAS the target they actually reviewed.
  let intent = attempts.find(
    (a) =>
      !a.finishedAt &&
      a.baseSha === baseBefore &&
      a.landHeadSha === landHead &&
      a.target === target
  );
  if (!intent) {
    [intent] = await db.insert(landingIntents).values(candidate).returning();
  }
  const pushRefs = (await git.client.listRefs()).refs;
  try {
    // Prepare recoverable evidence before committing the target. Artifacts need not support atomic multi-ref
    // pushes: a partially prepared receipt/pin cannot commit the target, and a committed target always has both.
    await git.client.push(
      [
        {
          ref: pullRef(pr.number),
          old:
            pushRefs.get(pullRef(pr.number)) === landHead
              ? landHead
              : intent.pullRefBefore,
          new: landHead,
        },
        {
          ref: landingReceipt(pr.number, intent.id),
          old: pushRefs.get(landingReceipt(pr.number, intent.id)) ?? ZERO_SHA,
          new: landHead,
        },
      ],
      []
    );
    const live = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, pr.id))
      .get();
    const freshRefs = (await git.client.listRefs()).refs;
    if (
      !live ||
      live.state !== 'open' ||
      live.stateRevision !== pr.stateRevision ||
      landTargetOf(live) !== target ||
      live.headRef !== pr.headRef ||
      freshRefs.get(`refs/heads/${pr.headRef}`) !== landHead ||
      (await mergingPause(db, pr.repositoryId))
    ) {
      await db
        .update(landingIntents)
        .set({ finishedAt: new Date() })
        .where(eq(landingIntents.id, intent.id));
      return {
        ok: false,
        status: 409,
        error: 'The pull request or merge policy changed. Review it and retry.',
      };
    }
    // Receipt preparation can involve multiple remote calls. Its old authorization snapshot must not let
    // a withdrawn review or newly failing check move the target. This is a final admission check, not a
    // cross-service atomic fence: a change after these reads still requires a future serialization protocol.
    const refusal = await landingGates(opts, live, landHead, target);
    if (refusal) {
      await db
        .update(landingIntents)
        .set({ finishedAt: new Date() })
        .where(eq(landingIntents.id, intent.id));
      return { ...refusal, ...rewrote };
    }
    await git.client.push(
      [{ ref: `refs/heads/${target}`, old: baseBefore, new: landHead }],
      []
    );
  } catch (e) {
    // A lost response can hide a successful push. Keep the intent on transport errors so a retry or Cron can
    // verify it. A rejected CAS with no committed landing can be retried with fresh gates and a new intent.
    const status = await landingStatus(git, pr, intent);
    if (status === 'pushed') {
      if (!(await recordLanding(db, pr, intent)))
        return {
          ok: false,
          status: 409,
          error:
            'Another merge attempt completed this pull request. Refresh its state.',
        };
      opts.after(
        finishLanding(env, db, opts.repo, opts.repoFullName, pr, intent)
      );
      return { ok: true, sha: landHead, headSha: intent.headSha };
    }
    if (e instanceof GitPushError) {
      // Keep the attempted operation as evidence, including partial multi-ref pushes. Fresh tips can create a
      // new attempt; recovery never guesses that receipt-only means the target moved. A target the remote has
      // moved off this attempt's base can never take its compare-and-swap, so that attempt is closed now.
      if (status === 'stale') await closeStaleLanding(db, intent.id);
      return {
        ok: false,
        status: 409,
        error: 'Base branch was modified. Review and try the merge again.',
        // The branch was rebased (and pushed) before the target moved again: the agent's clone is stale either way.
        ...rewrote,
      };
    }
    return {
      ok: false,
      status: 400,
      error: e instanceof Error ? e.message : 'Merge failed',
    };
  }
  if (!(await recordLanding(db, pr, intent)))
    return {
      ok: false,
      status: 409,
      error:
        'Another merge attempt completed this pull request. Refresh its state.',
    };
  opts.after(finishLanding(env, db, opts.repo, opts.repoFullName, pr, intent));
  return { ok: true, sha: landHead, headSha };
}

/** Re-read every mutable gate immediately before the target write. D1 and Artifacts are not one transaction. */
async function landingGates(
  opts: LandOpts,
  pr: PullRequest,
  headSha: string,
  target: string
): Promise<Refusal | null> {
  const { db, git, env } = opts;
  if (await mergingPause(db, pr.repositoryId))
    return { ok: false, status: 409, reason: 'paused', error: MERGING_PAUSED };
  const gate = await stackGate(db, git, pr);
  if (gate.error)
    return {
      ok: false,
      status: 409,
      reason: 'stack',
      error:
        'Couldn’t check how it relates to other open pull requests (the stack tree). Try again.',
    };
  if (gate.blocks.length)
    return {
      ok: false,
      status: 409,
      reason: 'stack',
      error: `${gate.blocks.map((b) => b.message.replace(/[.\s]+$/, '')).join('. ')}. A maintainer can dismiss a dependency on the pull request page.`,
    };
  // Never move the target past another open pull request's unlanded commits, whatever the stack tree says.
  const carried = await carriedPull(git, db, pr, target, headSha);
  if (carried === 'unknown')
    return {
      ok: false,
      status: 409,
      reason: 'stack',
      error:
        'Couldn’t completely check for commits from other open pull requests. Retry, or shorten the branch history before merging.',
    };
  if (carried)
    return {
      ok: false,
      status: 409,
      reason: 'stack',
      error: `It carries ${carried.count === 1 ? 'a commit' : `${carried.count} commits`} of #${carried.number}, which hasn't landed: landing it would land them too. Land #${carried.number} first, or rebase this branch without them.`,
    };
  // Checks, then review, for the commit that lands; a person's approval of it satisfies review.
  const checks = await checksAt(db, pr.repositoryId, headSha);
  if (checks)
    return {
      ok: false,
      status: 409,
      reason: 'checks',
      error:
        checks.kind === 'failed'
          ? // Run 0: a status a CI server reported, not an Actions run.
            `${checks.reason}${checks.runNumber ? ` (run #${checks.runNumber})` : ''}. Fix them, then merge.`
          : `${checks.reason}. Merge once they pass.`,
    };
  const review = await reviewGateFor(
    db,
    resolutionConfigured(env),
    pr,
    headSha
  );
  if (!review.satisfied)
    return {
      ok: false,
      status: 409,
      reason: 'review',
      error: `Review isn't satisfied: ${review.reasons.map(reviewReasonText).join('; ')}. Approve the pull request or its flags (an agent's change request needs a new commit or a Dismiss first).`,
    };
  return null;
}

/**
 * Another open pull request into the same target whose own commits (or rebased copies of them) this head carries,
 * so landing it would land them too: one this head holds whole (its parent), or one it shares some commits with that
 * was opened first (they branched from the same work, which belongs to the older one). Never one that holds this
 * head whole (its child). Null when there is none; unknown when evidence is incomplete.
 */
export async function carriedPull(
  git: GitService,
  db: DrizzleDB,
  pr: PullRequest,
  target: string,
  headSha: string
): Promise<{ number: number; count: number } | null | 'unknown'> {
  try {
    const refs = await git.refs();
    const tip = refs.get(`refs/heads/${target}`);
    if (!tip) return 'unknown';
    const others = await db
      .select({
        id: pullRequests.id,
        number: pullRequests.number,
        headRef: pullRequests.headRef,
      })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, pr.repositoryId),
          eq(pullRequests.state, 'open'),
          ne(pullRequests.id, pr.id),
          landTargetIs(target)
        )
      )
      .all();
    if (!others.length) return null;
    const compare = [];
    for (const o of others.sort((x, y) => x.number - y.number)) {
      const h = refs.get(`refs/heads/${o.headRef}`);
      if (!h || h === headSha) continue;
      // Exact ancestry does not depend on the bounded rebase-identity sample. This also lets a short parent land
      // before a long child without claiming that the child's truncated identities are complete.
      const carried = await git.isAncestor(h, headSha, true);
      if (carried === null) return 'unknown';
      if (carried) {
        const landed = await git.isAncestor(h, tip, true);
        if (landed === null) return 'unknown';
        if (!landed) return { number: o.number, count: 1 };
        continue;
      }
      const child = await git.isAncestor(headSha, h, true);
      if (child === null) return 'unknown';
      if (!child) compare.push({ ...o, head: h });
    }
    if (!compare.length) return null;
    const mine = await lineageOf(git, tip, headSha, true);
    if (mine.truncated) return 'unknown';
    if (!mine.ids.length) return null;
    for (const o of compare) {
      const theirs = await lineageOf(git, tip, o.head, true);
      if (theirs.truncated) return 'unknown';
      const count = (await sharedWith(git, mine, theirs, true)).size;
      if (!count) continue;
      // Its child (it holds all of this head, or the same commits): landing this one first is the right order.
      if (count === new Set(mine.ids).size) continue;
      // The strict intersection above already proved the patches. Re-reading through permissive discovery helpers
      // could lose that verdict on a second transient failure (especially when the parent was opened later).
      if (count === new Set(theirs.ids).size || o.number < pr.number)
        return { number: o.number, count };
    }
    return null;
  } catch (e) {
    console.warn('[merge] carried-commits check failed', pr.id, e);
    return 'unknown';
  }
}

/**
 * How many first-parent steps lead from `head` back into `base`'s history: the landed commits `pullShas` reads back
 * with `log(head, n)`. Counts a merged-in side branch as one step (its merge commit), as a first-parent log shows it.
 */
async function firstParentSteps(
  git: GitService,
  base: string,
  head: string
): Promise<number> {
  const own = new Set(
    (await git.commitsBetween(base, head)).map((c) => c.hash)
  );
  const chain = await git.log(head, own.size || 1);
  let n = 0;
  while (n < chain.length && own.has(chain[n].hash)) n++;
  return n;
}

/**
 * The target moved since the branch was last rebased: rebase it now and push the rebased branch (as a rebase run
 * would: Actions, the sweep, review carry-over). Ready to land only if the new head needs no checks and its review
 * holds; a conflict leaves the pull request to a rebase run.
 */
async function rebaseForLanding(
  opts: LandOpts,
  tips: RebaseTips
): Promise<{ ok: true; head: string } | Refusal> {
  const { env, db, git, pr } = opts;
  // Never rewrite the default branch, a protected branch, or a head another open pull request into a different base
  // shares.
  const blocked = await rebaseBlocked(db, pr);
  if (blocked)
    return {
      ok: false,
      status: 409,
      reason: 'rebase',
      error: `${tips.ontoBranch} has moved on, so it must be rebased before it lands. ${blocked}`,
    };
  const result = await rebaseAt(git, db, pr, tips, {
    ...REBASE_COMMITTER,
    timestamp: Math.floor(Date.now() / 1000),
  });
  if (result.kind === 'up_to_date') return { ok: true, head: tips.head };
  // The target already has every change: rewriting the branch to its tip would land nothing.
  if (result.kind === 'done' && !result.commits.length)
    return { ok: false, status: 400, error: 'Nothing to merge' };
  if (result.kind !== 'done') {
    opts.after(ensureRebase(env, db, git, pr));
    return {
      ok: false,
      status: 409,
      reason: 'rebase',
      error:
        result.kind === 'too_many'
          ? stopMessage.tooMany(result.count)
          : `Rebasing onto ${tips.ontoBranch} stops at commit ${result.commit.hash.slice(0, 7)}, which conflicts in ${result.conflicts.join(', ')}. ${
              resolutionConfigured(env)
                ? 'CloudForge is resolving it; merge again once it has.'
                : 'Rebase it locally and push.'
            }`,
    };
  }
  if ((await writeRebase(git, pr, tips, result)) === 'moved')
    return {
      ok: false,
      status: 409,
      error:
        'The pull request has new commits since you looked. Review them, then merge again.',
    };
  const w = written(tips, result);
  const done = { repo: opts.repo, repoFullName: opts.repoFullName, pr, w };
  // Actions on the new head before anything that can fail: the checks gate below must see its runs.
  await queueRebasedActions(env, db, done);
  try {
    await afterRebase(env, db, done);
  } catch (e) {
    // The branch is rebased and its runs are queued: the gates below still hold.
    console.error('[merge] after-rebase work failed', pr.id, e);
  }
  const rebased = `Rebased onto ${tips.ontoBranch} as ${w.to.slice(0, 7)}`;
  const checks = await checksAt(db, pr.repositoryId, w.to);
  if (checks)
    return {
      ok: false,
      status: 409,
      reason: 'checks',
      rebased: w.to,
      rebasedFrom: w.from,
      error: `${rebased} — waiting for checks (${checks.reason}). It lands once they pass: on its own with auto-merge, else merge again.`,
    };
  const review = await reviewGateFor(db, resolutionConfigured(env), pr, w.to);
  if (!review.satisfied)
    return {
      ok: false,
      status: 409,
      reason: 'review',
      rebased: w.to,
      rebasedFrom: w.from,
      error: `${rebased}; review isn't satisfied for the new head: ${review.reasons.map(reviewReasonText).join('; ')}.`,
    };
  return { ok: true, head: w.to };
}

/**
 * After a landing (when the repository deletes merged branches), deletes the pull request's head branch with
 * compare-and-swap on the landed head. Keeps it when someone pushed since, when it's the default branch or a
 * protected one, or when another open pull request uses it as base, head or land target (a stack builds on it).
 * Never throws.
 */
export async function deleteMergedBranch(opts: {
  env: CloudflareBindings;
  db: DrizzleDB;
  repo: Repository;
  git: GitService;
  pr: Pick<PullRequest, 'id' | 'number' | 'repositoryId' | 'headRef'>;
  /** The head commit that landed. */
  headSha: string;
  /** Landing recovery retries transient failures; ordinary callers keep best-effort cleanup. */
  strict?: boolean;
}): Promise<boolean> {
  const { env, db, repo, git, pr } = opts;
  const branch = pr.headRef;
  try {
    if (branch === repo.defaultBranch) return false;
    if (protectedBy(repo.protectedBranches, branch)) return false;
    const inUse = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, pr.repositoryId),
          eq(pullRequests.state, 'open'),
          ne(pullRequests.id, pr.id),
          or(
            eq(pullRequests.baseRef, branch),
            eq(pullRequests.headRef, branch),
            landTargetIs(branch)
          )
        )
      )
      .get();
    if (inUse) return false;
    // From the remote: landing may have just pushed a rebased head, which a cached listing wouldn't show.
    const { refs } = await git.client.listRefs();
    if (refs.get(`refs/heads/${branch}`) !== opts.headSha) return false;
    // A deletion starts no Actions run and leaves no PR to sweep, so a live ping is all it needs.
    await git.deleteBranch(branch, opts.headSha);
  } catch (e) {
    console.warn('[merge] could not delete merged branch', pr.id, branch, e);
    if (opts.strict) throw e;
    return false;
  }
  await recordAudit(db, {
    repositoryId: pr.repositoryId,
    actorId: null,
    action: 'branch.deleted',
    target: branch,
    data: { sha: opts.headSha, merged: true },
    // The pull request whose landing deleted it, so the log can say "deleted <branch> after #<n> merged".
    pull: pr.number,
  });
  await publishChange(env, pr.repositoryId);
  return true;
}
