# E008 local compatibility audit

Status: investigation; no runtime change or dynamic claim yet.

The canonical four Office skill identities remain in `domain/skill/platform-skill-catalog.ts`; `ensure-platform-skill-catalog.ts` consumes that registry and migrates historical `cap-${skillId}` listing identities. E008 must test these existing identities rather than create a second alias registry.

A concrete routing gap needs a dynamic regression: `PgAgentRunRepository.claimQueued` does not return `agent_runs.runtime_profile`, and `ClaimedAgentRun` has no runtime profile. Approval and checkpoint resume re-enter this claim path. `execute-run.ts` chooses native prompting, session provisioning and output collection solely from the currently injected `deps.nativeSessions`. Consequently the current rollout flag may change the engine chosen for a previously interrupted run. The stale-running recovery implementation already reads the persisted profile; this finding is specifically about queued continuation.

Proposed bounded acceptance:

1. A new run with the rollout disabled uses legacy without native provisioning.
2. A legacy checkpoint/approval continuation remains legacy after rollout enablement.
3. A native checkpoint/approval continuation cannot fall back to legacy when native dependencies are unavailable; no model invocation, script execution or publication occurs.
4. With native dependencies retained for draining, native continuation remains native after disabling admission of new native runs.
5. Existing recovery uses the known remote handle and staged output metadata; it never resubmits model input or executes final prose scripts.

Implementation coordination is required for the execution snapshot, repository claim, executor and composition admission/drain distinction. Main-run state transitions and peer UI are outside this worker's independent ownership. No second migration-router service is proposed.
