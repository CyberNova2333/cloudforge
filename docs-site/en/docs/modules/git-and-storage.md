# Git Transport, Artifacts Isolation & R2 LFS

CloudForge keeps Git pack storage out of D1 and keeps upstream credentials inside the Worker (`worker/src/git/http/handler.ts`, `worker/src/lfs/http/handler.ts`).

- **In-memory credential exchange**: Clients authenticate with PATs or `cfd_` deploy tokens; the Worker exchanges short-lived credentials for `ARTIFACTS` or mints 15-minute `PUT`/`GET` R2 presigned URLs (`lfs/<repo_id>/<oid>` with `x-amz-checksum-sha256` verification) so bytes bypass Worker memory.
- **Ref & deploy token boundaries**: `decidePush` (`worker/src/git/push-protection.ts`) prevents force-pushes/deletes on default and protected branches and rejects external writes to `refs/pull/*`. Writable deploy tokens verify creator admin status on every call and refuse pushing to an empty repo that lacks an admin-initialized default branch (`worker/src/auth/deploy-tokens.ts`).
- **Async persistence**: `recordPush` writes `push_events` before returning the HTTP response so interrupted follow-ups recover reliably; default-branch adoption updates conditionally only if unchanged since read (`worker/src/git/push-events.ts`).

Next: [Reviews, Stacking & Auto-Merge](/en/docs/modules/reviews-stacking-and-merge) or full Chinese reference in `repo-docs/modules/git-and-storage.md`.
