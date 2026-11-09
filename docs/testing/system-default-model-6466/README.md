# System default model for ordinary conversations (#6466)

## Behavior

New ordinary conversation runs use `resolveDeepAgentModel()` and the current
`KERNEL_DEFAULT_AGENT_MODEL_ID` unless the organization explicitly selected a
custom core model. An empty organization model pool is valid in the default case.
The resolver remains the single source of system model configuration; no model
identifier is hardcoded into the runtime or UI by this change.

Explicit custom selections retain verified deployment/billing/permission checks
and the existing core-model snapshot. Unavailable custom selections fail closed.
Image generation and deep research retain their specialized providers. Existing
runs and immutable agent versions are not rewritten; idempotent replay returns
before resolving current configuration.

## Verification

- `./init.sh`: PASS (quick baseline).
- Isolated API Vitest run: **53 tests passed**, five files:
  `tests/auth/org-core-model.test.ts`, `tests/model/org-core-model-snapshot.test.ts`,
  `tests/model/core-model-runtime-guard.test.ts`,
  `tests/capability/model/org-core-model-real-db.test.ts`,
  `tests/chat/message-write-roundtrip.test.ts`.
  Command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run <five files above>`.
- Web Vitest: **41 tests passed** in `tests/ui/org-core-model-panel.test.tsx`
  and `tests/ui/platform-model-catalog-i18n.test.tsx`.
- API and web `typecheck`: PASS.
- Independent source review: no concrete blockers; runtime execution still
  bounded by the tests described here.

The new PostgreSQL test uses an organization with no model rows, accepts a run
with the system model, changes system configuration, replays the first request,
and accepts a second run. The database contains exactly two runs with the
respective frozen model IDs. Custom-model resolution is never called. Existing
real-database custom-selection/replay tests and HTTP acceptance tests also pass.

The regression test initially failed with the old agent-version model instead
of the system model. Initial fixture cleanup used an application-role DELETE
that correctly failed permission checks; the test was corrected to recreate its
isolated organization using the existing privileged test helper. No application
permissions were broadened. Stale UI wording expectations were updated to the
new default behavior; credential configuration labels remain unchanged.

## Production boundary

No production writes, restart, release, or real provider inference was performed
for this change. The earlier read-only CN inspection observed system model
configuration `qwen3.8-max`; this document does not assert current production
release state or claim this source change has been deployed.
