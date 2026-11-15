# AI Reviews, PR Stacking & Auto-Merge

After a push triggers PR creation or sync, `MergeResolutionWorkflow` (`MERGE_RESOLUTION`) and `landPull` coordinate review, DAG ordering, and fast-forward landing:

- **Sandboxed Deep Review & Learning**: `engine: pi` agents run inside per-attempt `AgentReviewer` DOs (`worker/src/review/agent-reviewer.ts`), checking out up to 3,000 text files / 24 MB (`worker/src/review/checkout.ts`) under `.orangeignore` rules and site-admin budgets (`review.pi_*`). Without `AGENT_REVIEWER` bindings, reviews fall back to single-pass. Dismissed change requests or teach notes enqueue `agent_lessons` where the agent may edit only `AGENT.md` body and `knowledge/**` (`worker/src/learn/validate.ts`).
- **Git-First DAG Stacking**: `worker/src/stack/lineage.ts` detects full branch containment in Git (`decided_by = 'git'`) before calling AI models, enforces DAG acyclicity (`worker/src/stack/acyclic.ts`), and retargets `base_ref` in D1 only (`land_target` preserved) without touching remote feature branches (`worker/src/stack/reconcile.ts`).
- **Single Verdict & Checkpoint Recovery**: `reviewVerdict` (`worker/src/review/gate.ts`) governs manual merge, MCP merge, and `autoMergeRepository`; guarded/security/data agents block blank dismissals (422) and `Let Claude decide` delegations (`ai_delegations`). `landPull` CAS-advances the base branch while `landing-recovery.ts` and `close-recovery.ts` handle branch cleanup, `Fixes #N` closure, notifications, and webhooks.

Next: [Actions Containers & Webhooks](/en/docs/modules/actions-containers-and-webhooks).
