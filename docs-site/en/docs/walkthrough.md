# End-to-End Request & Workflow Walkthrough

This concise walkthrough mirrors the Chinese primary guide in `repo-docs/walkthroughs/one-real-run.md` (and switches cleanly to the full source-linked Chinese text via the top language switcher).

A single `git push` must hold together access permissions, Git ref protection, upstream Artifacts writes, and recoverable background processing across stateless Workers.

| Scenario / Input                                   | Guard & Hand-off                             | Outcome                                                        |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Write-capable member pushes feature branch         | Passes `accessRuntime` + `decidePush`        | Forwarded to Artifacts; applied refs recorded in `push_events` |
| Read-only PAT or read-only deploy token pushes     | Rejected at auth check before receive-pack   | HTTP 403; upstream Artifacts never contacted                   |
| Writable deploy token pushes to uninitialized repo | Rejected by `deploy-tokens.ts` boundary      | Refuses promoting first branch to default branch               |
| Storage succeeds, `waitUntil` interrupted          | `recordPush` already persisted `push_events` | Next push or scheduled recovery claims lease and finishes work |

## Step-by-Step Pipeline

1. **Protocol & Repository Access (`worker/src/git/http/handler.ts`, `worker/src/access/runtime.ts`)**: Reads D1 `access_runtime_state` before parsing packs (returns uncached `503` if incompatible). Authenticates Basic PAT / `cfd_` deploy token against current member/creator admin status and repo scope.
2. **Receive-Pack Protection (`worker/src/git/push-protection.ts`)**: `decidePush` blocks non-admin pushes/force-pushes/deletes on default or protected branches and blocks all external `refs/pull/*` updates.
3. **Upstream Storage Reply (`worker/src/git/http/handler.ts`)**: Worker trades short-lived `ARTIFACTS` credentials in memory and inspects reported ref statuses (`successfulPushRefs`) rather than assuming HTTP 200 means every ref landed.
4. **Durable Outbox Before HTTP Response (`worker/src/git/push-events.ts`)**: `recordPush` writes `push_events` to D1 _before_ acknowledging the client, preserving `before` SHA context for Actions and conditionally adopting a default branch only if unedited by admins in the interim.
5. **Lease Recovery & Drain Observation**: Unfinished `push_events` recover under bounded attempt leases on later pushes or cron runs (`worker/src/cron.ts`), and operators inspect backlogs read-only via `pnpm cloudforge access-drain-status`.

Verify this flow locally with:

```bash
pnpm test:workers worker/src/__tests__/git/git-http.test.ts worker/src/__tests__/git/push-protection.test.ts worker/src/__tests__/git/push-events.test.ts
```

Continue to [Git, Artifacts & R2 LFS](/en/docs/modules/git-and-storage) or [Code Map & Contributing](/en/docs/code-map).
