# Trusted candidate CI — phase 1 backlog

User authorization: default shadow, existing validation and deployment retained; one draft PR, no merge, deploy or reuse activation. Integrator: root. Baseline: `d4f15668a` (2026-10-05).

| Item | Owner | Acceptance | Status | Next action |
|---|---|---|---|---|
| Isolated latest-main checkout | root | Fresh linked worktree; original dirty files/branches preserved | done | Work only in this checkout |
| Existing CI PR reconciliation | root | Open workflow PRs and recent relevant merges inspected | done | Avoid native workflow touched by draft #5245; retain #5335/#5315/#4724 behavior |
| Full coverage and suite ownership | coverage_matrix | Each actual suite has one evidence owner; event/scope/subset differences explicit; deployment and main-only coverage accounted for | tested | 36 suites/36 jobs validated; keep Native source gap with #5245 |
| Candidate provenance and fail-closed policy | evidence_design | API-backed observer authority, checkout/base/head/tree/definitions/locks/environment/artifacts bound; squash tree match safely supported | tested (synthetic runtime) | 175 policy cases pass; complete trusted runtime recorder remains deferred |
| Protected observer and shadow integration | root | Main-owned observer executes no candidate code, consumes no candidate JSON, observes unchanged mandatory executions; off/shadow switches only | tested (local) | 28 immediate-checkout markers; protected observer can start only after a later approved merge |
| Adversarial integration tests | workflow_tests + observer_adapter | Malicious logs, source/workflow drift, new failure, API denial, missing/expired artifact and exceptions always run full | tested | 22 API/observer and 46 workflow regression cases pass; historical sample rejects missing identity |
| Independent exact-SHA security review | security_review | No false-green route or permissions expansion; findings fixed and exact final SHA reviewed | doing | Pre-commit independent review passed; request final exact-SHA decision after normal commit |
| Manual independent revalidation | root | Existing fresh_run, native rerun and manual heavy-lane entries remain reachable | tested | Original triggers, permissions, conditions, dependencies and manual entries equal baseline after stripping additions |
| Local validation and shadow receipts | root | Tests and workflow parsing pass; success/negative fixtures and real historical fallback recorded; savings not fabricated | tested | 243 Node and 366 integrated Vitest tests pass; local receipts saved, live protected observer not yet available |
| Draft PR and terminal CI | root | One normal commit series/draft PR; all CI tracked to terminal state, failures diagnosed | pending | Push, create/attach PR, inspect all runs |
| Reuse activation prerequisites | user + future integrator | Separate approval; required full candidate coverage migrated or retained, environment identity reliable, observer merged/trusted, shadow matches, failure/fallback drills verified | deferred | Never activate in phase 1 |

Sample `37302506067`: total 24m35s, gates 13m20s, deploy 11m14s. A future compatible path could save approximately 13 minutes. Phase 1 saves zero validation executions; no claim that all CI or a whole PR is halved.

## Session progress and handoff

`./init.sh` completed successfully. Main checkout remained on its existing branch with its existing staged/unstaged files. This ad-hoc task does not alter feature status/owner/evidence fields. No Docker stack has been created by this task.

Worker coordination registration is not inferred or created: no supplied registered identity/credential exists for this ad-hoc delegated thread. `pnpm harness tick --json` reported missing `COORD_GATEWAY_URL`; readiness completed. This does not block the authorized isolated implementation or create a registered coordinator identity.
