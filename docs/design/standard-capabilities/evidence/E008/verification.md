# E008 runtime compatibility verification

The persisted `agent_runs.runtime_profile` is now included in the claimed execution snapshot. Approval/checkpoint continuation uses that profile, not the current rollout setting. Native admission and the available session owner are separate dependencies: disabling admission leaves the owner available to drain existing native runs. If native dependencies are absent, a native continuation fails before model dispatch; it cannot fall back to legacy.

`runtimeProfile` remains optional only for existing in-process port callers. The PostgreSQL claim always returns the constrained database value. Continuation is determined from checkpoint/approval/sequence facts and the durable lease epoch. No new route service, alias registry, run state, journal or migration is introduced.

Dynamic red evidence:
- `route-red.txt`: native continuation without owner actually invoked the legacy model once; legacy approval continuation with the owner present incorrectly failed before dispatch. The same first run also caught an invalid test fixture transition.
- `claim-red.txt`: corrected fixture uses actual claim then approval, then a fresh database connection/repository. Both native and legacy persisted profiles were missing from the claimed snapshot.

The additional positive drain test uses the real PG repository, real plan-ledger remote-handle persistence, a bounded fake model and an explicit async fake owner. It asserts one native dispatch with the original approval resume and second lease, one release, staged-file collection and persisted writeback_pending. It is not an external-model or real-sandbox test. T010/E003 evidence covers the separate actual sandbox path.

Commands: standard `with-test-isolation.ts` wrapper followed by `pnpm --filter @repo/api exec vitest run tests/agent-run/runtime-profile-continuation.test.ts tests/agent-run/runtime-profile-claim.test.ts tests/agent-run/execute-run-thin-gateway.test.ts`.

The canonical Office aliases remain the existing platform-skill-catalog and its existing seeded-listing migration; this patch does not change or duplicate them. Existing stale-running reconciliation remains responsible for known remote handles and already staged outputs. Their broader regression results must be cited separately, not inferred from these tests.

Final result: `final-green.txt`, 3 files / 12 tests passed, wrapper exited 0 and cleaned its compose volume/resources (10 seconds, peak 3 connections). The intermediate drain failure in `drain-fixture-diagnostic.txt` was a fake owner returning undefined from release where the actual port requires a Promise; correcting the fake to async made the unchanged native invocation path settle correctly. No production workaround was added for that fixture error.
