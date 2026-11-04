# Task 2 independent source review

Scope: immutable `e309f92210ea75f9dd60ef5fa8daa144f0f06818` against `f7f8ca20f0a85777f206f90eb7b603cc4bdd7082`. Read the supplied four-file diff once. No changed-file rereads, Git operations, tests, services, database/browser runs, or subagents. Later mutable fixes are outside this verdict.

**Spec verdict: PASS for source coverage and integrity only. Quality verdict: FAIL at this SHA because of the confirmed type error below. Runtime acceptance remains UNRUN.**

## Actionable finding

- **[P2] Narrow the DOM node before accessing Element attributes** — `apps/web/e2e/entity-localization.spec.ts:1316`. The switch-identity `ElementHandle.evaluate` callback receives a generic `Node`; `node.getAttribute(...)` is not defined on that type. Root's native web type gate on this exact SHA exited 2 with TS2339 (private `raw/task-2-source/task-2-web-type.txt`). Add an `instanceof Element` guard while retaining both connectedness and identity checks. Re-run the covering web type gate before browser acceptance. This is one finding; the gate failure and callback defect are the same issue.

No additional actionable P1/P2 source defect found.

## Four-file coverage

- `entity-localization-fixture.ts`: one explicitly synthetic failed historical attempt; valid constrained report shape, precise numbers/ISO timestamps, coherent past consent/omissions, valid placeholder hash. No sender-success assertion or credentials added.
- `seed-entity-localization.ts`: optional prefix preserves legacy callers; strict complete input validation precedes owned SQL. Parameterized singleton insertion preserves existing secret, fresh secret uses 32 random bytes, canonical helper derives the actual instance hash. Only canonical initial consent and historical read prerequisites are seeded; mutation/grant outcomes remain real.
- `playwright.fullstack-smoke.config.ts`: additive history serialization and actual isolated API `WSX_TELEMETRY_DISABLED=1`. Canonical config recognizes it; reporter state checks kill switch first; worker returns before timer creation. The case asserts kill_switch on its first settings GET. No production worker/transport alteration.
- `entity-localization.spec.ts`: canonical real login/schema/identity checks; original raw response supplies the JSON property-order oracle; both locale directions preserve mounted controls/counts/booleans/history. All four native switches require exact one-key PUT, strict response, independent GET and reload. Actual superuser grant/operator consent/revoke, original ordinary-admin and revoked GET/PUT403, denial panels, unchanged rejected writes, and separate cleanup are present. Eight states at both widths include relevant panel/label/control bounds, global overflow checks and native JSON-axis reachability. No force/interception/fake authentication/budget extension is introduced.

Preservation is supported by root's independent `task-2-preservation.json`: original 11 statements, 77 env expressions, fixture prefix, two seed functions except additive invocation, import/binding relative order and Task 1's five files. I did not repeat these checks.

## Focused reads outside the diff

Read the named plan/spec/brief/constraints/report/preflight and preservation receipt. Concrete compatibility checks used only: `packages/contracts/src/instance-telemetry.ts` (strict shapes/defaults/IDs/methods); telemetry config, cycle hash/state helper and report worker (secret derivation and disabled startup); singleton migration (SQL columns/types); system telemetry controller and PlatformOperatorGuard (all three endpoints, dynamic role lookup and403 code); Task 1 telemetry screen (actual selectors, labels and native JSON scroller geometry). A guessed controller path was absent; located and read the exact controller path. No broad code crawl.

## Missing dynamic evidence

Root reports API type exit0 and web type exit2; remaining source gates stopped/unrun. No real PG/browser journey or16 PNGs has run. Source inspection cannot establish native login hydration, real persistence/revocation, panel fit at375/1280, wheel targeting/reachability,120s completion, image privacy or cleanup. These require the planned actual gates/run and individual image review after the type fix. Synthetic history never proves attempted or successful outbound sending.

## Scoped fix 1 re-review

Reviewed only `e309f92210ea75f9dd60ef5fa8daa144f0f06818..3e7e579cea24ab9b1effdabb408c453fd571cc8d` via `review-task2-fix1.diff`, read once, plus the implementer's appended explanation and root's covering `task-2-fix1-web-type.json` receipt. No changed-file reread or command/gate execution.

**Prior P2: ADDRESSED. Source-only spec verdict: PASS. Source-only quality verdict: PASS at `3e7e579cea24ab9b1effdabb408c453fd571cc8d`.** The sole change adds the runtime `node instanceof Element` guard before attribute access; connectedness and exact DOM identity assertions remain intact. The callback runs inside the page's DOM realm, so the guard is appropriate. No new breakage found in this one-line fix. Covering web typecheck receipt binds this exact head to exit0 in9.092s; the previous failure remains retained above rather than erased.

Root additionally reports same-head scoped/API lint, test-ID, wiring, fullstack-spec and init gates exit0; unchanged API content retains the earlier API type exit0. These are root-reported evidence, not independently rerun here. Dynamic real PG/browser acceptance and all16 PNGs remain **UNRUN**, so this source verdict does not establish runtime completion.
