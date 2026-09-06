# Standard capabilities implementation handoff

Work continues on `/private/tmp/workspacex-standard-capabilities`, branch
`codex/standard-capabilities`. Keep this worktree for the explicitly requested remaining
capabilities. Tracking issue #2864; the **single aggregate Draft PR is #2869**:
https://github.com/boardx/workspacex/pull/2869 . Do not create a second aggregate PR or merge main.

Read `development-flow.md` for the current colour-coded component progress,
`capability-catalog.json` for the 75 design entries, and `peer-boundaries.md` before
changing shared files. These are design/progress records, not feature passing state.
The user waived agent identity registration for this temporary module-agent task;
see `implementation-notes.md`. Do not invent an agent ID or change historical signoffs.

## Implemented foundation and evidence

E001/E002/E003/E004, T011, T042, E005 discovery schemas and W12 trusted identity have
verified increments. Their exact scope/commits are in implementation-notes and evidence.
The native graph is still opt-in: production selector remains legacy/text-only.
W12 transmits identity but has no persistent-memory consumer. E005 preserves schemas
but has no governed production tools/call. Neither is a fully delivered capability.

Use existing `.venv` in apps/deep-agent-service and uv.lock; do not resolve newer
Deep Agents casually. The service Dockerfile now consumes the lock. Native sandbox
initialization checks an exact 0.7.6 upstream grep template patch; package upgrades need
explicit review and the sync/async real grep tests. File methods reuse upstream semantics; T002 image transport correction 8b7fe404b uses official bounded capture, 46 real sandbox regressions passed, independent review found no blocker. Read adds capture/cleanup executions; async waiting cancellation does not kill the worker thread.

Always use `apps/skill-sandbox/docker-compose.sessions.yml` for native sessions. It has
mandatory seccomp isolation and init-based child reaping; a plain container or the
legacy compose is not equivalent. The supplied 160-execution test caught PID exhaustion
that short tests did not. Each test container/project needs a unique owned name and
cleanup. All containers/volumes used in this turn were removed; no DB stack remains.

## Next work

- W12: follow memory-integration-delta.md. Official LangMem 0.0.30 was inspected but NOT
  added to dependencies. Its default upsert/delete/search semantics are weaker than the
  catalogue's source-message validation, revision conflict, idempotency and exact-user
  scope requirements. Verify actual persistent Store deployment; never fall back to
  in-memory or treat checkpoints as personal memory.
- E005: follow mcp-execution-integration.md. Fixed-version approved whitelist publication
  is not currently established, and peer has no stable public admission contract. Do not
  add empty unused snapshot fields or bypass the existing failed security scan. Extract
  MCP contract definitions before the next addition to oversized agent-runtime.ts;
  the four-field temporary exception is scoped in mcp-execution-delta.md.
- Standard Skill distribution already has complete-pack admin import and pins. Platform
  enabled skills are automatically loaded into all orgs; do not mistake that for a
  separate installable-template catalogue or publish a Skill with unavailable tool names.
- Native factory, artifacts, standard-ID trace and remaining 19-work-package items still
  require implementation and joint verification. Do not recreate peer's main-run queue,
  events, leases, approval state or workbench UI.

## Verification and PR discipline

`./init.sh` quick path passed with normal git-hook write permissions. Normal pre-push
ran 13 affected typecheck/lint tasks successfully at 749969d77. Full PR CI was started
on that head and exposed non-replayable migrations. Fix e4b8e9b34 passed local 202-migration empty-build/forced-replay and 13 pre-push tasks, then was pushed. On e4b8e9b34 CI gates-runtime, full compile, pytest and core-loop subsequently passed. T042 correction dd1079503 decouples the subtask stale threshold from peer main-run leases; 73 targeted tests plus 7 real-DB counterexamples passed. Inspect final-head live checks rather than assuming local green means CI green.
The initial issue progress comment is
https://github.com/boardx/workspacex/issues/2864#issuecomment-5561173526 .

API tests must use `.harness/scripts/with-test-isolation.ts`, one DB wrapper at a time.
Real Python integration uses the explicit WX_NATIVE_SANDBOX_CONTAINER fixture; without
it, tests skip deliberately. Retain raw failures plus correction output. In particular,
the 49-case live set passed 46 then a corrected three-case rerun; do not rewrite this
history as one 49-passed invocation. Production real-model/combined UI acceptance remains.
