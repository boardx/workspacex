# Report export Credit guidance (#6424)

CN browser retest found that the report page showed generic PDF/Word generation failure while the corresponding real native-format Chat tasks each explicitly reported personal Credit insufficiency before tool dispatch. Positive native file generation remains blocked by the user's actual personal capacity, not demonstrated as a renderer failure. This change does not deploy or modify production funds, limits, permissions, or approval policy.

The report adapter retains only closed Credit failure codes from the authorized run projection. Canonical `CreditRequiredBody` is reused; the existing owned-run helper revalidates actor/org binding and reconstructs the billing destination. Mismatched scope becomes accounting unavailable without a payment action. The report job stores the typed failure, including an admission refusal before run acceptance. Historical generic failures can recover guidance from their existing run; nonfailed runs cannot resurrect a terminal report job.

The report page uses the existing Credit presentation. For reload it remembers only an opaque job ID per report identity/format in session storage, never the payer or guidance. Its explicitly observation-only GET rechecks server actor/source authority, cannot initialize an export or kick a queued run, and never auto-downloads or resubmits. Normal user-triggered generation/progress semantics remain intact. A denied or unavailable restored read never triggers generation.

Verification commands:

```sh
pnpm --filter @repo/api exec vitest run --config vitest.report-files-unit.config.ts
pnpm --filter web exec vitest run tests/ui/report-file-actions.test.tsx tests/ui/research-report-file-source.test.tsx tests/lib/report-file-restore.test.ts
pnpm --filter @repo/api typecheck
pnpm --filter web typecheck
pnpm --filter @repo/api lint
pnpm --filter web exec eslint components/report-files/report-file-actions.tsx lib/report-files-api.ts tests/ui/report-file-actions.test.tsx tests/lib/report-file-restore.test.ts
```

The committed red evidence records actual failures: initial contract/real adapter/service lose guidance (3), report UI loses guidance (1), pre-acceptance typed refusal is flattened (1), and restore paths wake/initialize execution (3). Targeted `-t` logs deselect unrelated tests; these are counterexamples, not full-suite completion claims. An initial HTTP fixture used the wrong DI token and was corrected; that setup failure is not a product counterexample.

The actual HTTP test uses the real controller, PrincipalGuard and service, a retained in-memory job store across two Nest app instances, and a stub principal resolver/runtime. It checks authenticated/anonymous/foreign status reads and no new conversion. It is network/serialization/restart evidence, not PostgreSQL durability, real vendor execution, or production acceptance. Existing job JSON persistence needs no migration. Actor/org/source denial, canonical scope reconstruction, outage/no-payment, monthly allowance/no-personal-payment, polling, and UI remount have explicit controls.

The pre-existing CJK PDF layout case requires `WX_PDF_LAYOUT_CJK_FONT`; absent that font it is not counted as a pass. Database/native vendor lanes are outside these pure regression commands. Independent exact-SHA review and current-head CI remain required before merge.

Local final regression (2026-11-08): API 74 passed, 1 existing font-dependent case not run; web 27 passed. API lint and web scoped ESLint exited 0; web TypeScript exited 0. Final TypeScript/baseline results and exact-head CI are recorded in the PR.

Upgrade boundary: the previous UI did not retain job IDs. Only known historical job IDs can recover generic-failure guidance; this change does not discover all old failures by report source, and must not regenerate merely to manufacture a notice. New job IDs are remembered for subsequent reloads.

## Real PostgreSQL terminal-retention review follow-up

Independent PR review found that the existing store only updated `state=running`, so historical failed-job recovery could return an unpersisted body. The service mock had hidden this limitation. A valid real PostgreSQL counterexample failed twice on the old store (`false` instead of successful retention); a service CAS-miss counterexample also failed. Earlier FK/incorrect-helper fixture failures are not product RED, and a subsequent SQL-parenthesis implementation error is not counted as the old defect.

The store now atomically enriches only an already-failed `GENERATION_FAILED` row into a typed Credit failure under org/actor/job/run/thread/request/binding/render/source/format fences. It patches only the existing job's errorCode and canonical creditFailure. Table status, attempts, leases, identifiers and all other metadata are unchanged; the original running-row transition remains. The service reads authorized stored state after update, including a missed CAS, never returning an unretained in-memory candidate.

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/report-files/credit-failure.db.test.ts
```

This owned real PostgreSQL lane passed 4 cases with peak 3 connections, and its stack was released by the wrapper. It covers store reconstruction/read, cross-actor/org and changed identity rejection, concurrency with exactly one winner, complete nonfailure metadata/lease/attempt preservation, no successful-output downgrade, and continued normal running-to-failed persistence. Pure report regression after the fix: 75 passed, 1 pre-existing font-dependent case unrun. Web27 remains unchanged by this backend-only increment. Actual native file generation is still not production-accepted.

Baseline quick-run boundary: the earlier full gate ended40/46 successful with an API PostgreSQL connection interruption and an unrelated supervisor failure. The latter also failed on the exact base's source/test import closure; isolated candidate retry passed5/5. These observations remain recorded in PR triage, not rewritten as full-gate success or a proven environment cause. Normal pre-push and exact-head CI are separate evidence.
