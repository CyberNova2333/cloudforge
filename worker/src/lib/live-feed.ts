// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { Repository } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import type { GitService } from '../git/service';
import { listAudit, type AuditEvent } from './audit';
import { mergeQueue, type QueueTarget } from './queue';
import { repoSessions, visitorSession, type SessionSummary } from './sessions';

// The Live page: who is working on the repository right now. The merge queue, the requests "floor" (open pull
// requests grouped by coding session or person, with their states) and the newest audit and timeline events. The page
// refetches it on the repository's live pings (`repo:<id>`).

export const LIVE_EVENTS = 50;

export type LivePayload = {
  queue: QueueTarget[];
  floor: SessionSummary[];
  events: AuditEvent[];
};

/**
 * One read of each: the queue's pull request states are reused for the floor (computed once). `member`: false for
 * someone without an account (a public repository), who gets neither the audit log (members only, as on the Audit
 * page) nor what people asked their coding agents for.
 */
export async function liveFeed(
  env: CloudflareBindings,
  db: DrizzleDB,
  git: GitService,
  repo: Repository,
  opts: { member: boolean }
): Promise<LivePayload> {
  const queue = await mergeQueue(env, db, git, repo);
  const [floor, audit] = await Promise.all([
    repoSessions(env, db, git, repo, { openOnly: true, states: queue.states }),
    opts.member
      ? listAudit(db, { repositoryId: repo.id, limit: LIVE_EVENTS })
      : null,
  ]);
  return {
    queue: queue.targets,
    floor: opts.member ? floor : floor.map(visitorSession),
    events: audit?.events ?? [],
  };
}
