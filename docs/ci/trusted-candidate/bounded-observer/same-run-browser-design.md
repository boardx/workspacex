# Same-run browser consolidation: bounded contract comparison

Status: **design only; existing execution remains enabled**. This comparison reads frozen branch `77700fe5f15eabb4ceeff2bd10a2eed59e2d7178` and the explicitly requested main snapshot `e27f209357712603455f6f197cf0be196f3e2b7a`. It does not change a workflow, command, required check, permission, deployment dependency, test inventory, or reuse switch. No browser, service, test suite, workflow dispatch, rerun, merge, or deployment was started for this comparison.

The bounded opportunity is one browser selection executed twice **inside the same harness run**. Its test identities match; its two current runtime and credential profiles differ. Selecting a canonical execution profile is a decision that must precede removing either execution. The existing full base gate, geometry, chat-read, self-service-profile, backend core-loop, Board lanes, deployment checks, and standalone `verify:full` remain required in their current scope.

## 1. Actual selection and coverage

Both paths ultimately invoke the same raw command:

```text
fullstack-smoke job
  ci-fullstack-runtime.mjs run -- pnpm run verify:fullstack-smoke
    with-test-isolation -- pnpm run verify:fullstack-smoke:raw

full-regression-core job
  TURBO_FORCE=true pnpm run verify:full
    with-test-isolation -- pnpm run verify:full:raw
      run-verify-lanes.ts
        base        -> pnpm run verify:base:raw
        browser-e2e -> pnpm run verify:fullstack-smoke:raw

raw browser command in both paths:
  pnpm --filter web exec playwright test
    --config playwright.fullstack-smoke.config.ts
    --project=seeded-github-import
```

The two lanes in `run-verify-lanes.ts` are serial but independent: a returned nonzero base exit still starts the browser lane; any failed or not-run lane makes the full command fail. An exception while starting a lane can leave later lanes not-run. A successful browser lane cannot make the base lane pass. See [package scripts](../../../../package.json), lines 47–56 and 90–91, and [lane orchestrator](../../../../.harness/scripts/run-verify-lanes.ts), lines 49–68 and 93–152.

The checked-in [inventory observation](../../../../.harness/config/ci-fullstack-inventory.json) came from an actual Playwright 1.62.0 `--list` invocation, not an execution. It contains 149 identities in 53 distinct spec files over the selected project and its six transitive dependencies:

| Project | Tests | Spec files | Direct dependencies | Expected existing skip |
| --- | ---: | ---: | --- | ---: |
| seeded | 109 | 35 | none | 1 |
| board-collaboration-regressions | 2 | 2 | seeded | 0 |
| official-digital-human | 1 | 1 | seeded, board-collaboration-regressions | 0 |
| realtime-voice | 1 | 1 | official-digital-human | 0 |
| official-role-workflow | 1 | 1 | official-digital-human | 0 |
| board-image-ingress | 4 | 1 | official-role-workflow, realtime-voice | 0 |
| seeded-github-import | 31 | 12 | official-role-workflow, realtime-voice, board-image-ingress | 0 |
| **Total** | **149** | **53** | seven-project dependency closure | **1** |

Selection is defined in [fullstack config](../../../../apps/web/playwright.fullstack-smoke.config.ts), lines 303–521. `seeded` and `seeded-github-import` exclude `EMPTY_DB_TAG_RE`. The separate core-loop-seeded → core-loop-reset → core-loop-empty-db chain is **not** selected by either raw command; `verify:core-loop` selects it independently. Config comments at lines 299–301 saying `verify:full` also runs core-loop are stale against the current executable scripts. Other configured projects do not become covered merely because they appear in this config.

The existing skip is `seeded`, `apps/web/e2e/inbox-smoke.spec.ts:67:8`, title path `统一收件箱端到端：直接提交、看板拖拽迁移、不做需理由` → `① 直接提交反馈 → 跳转收件箱并自动打开该条详情 drawer`. It is a checked-in `test.fixme` pending a product decision ([definition](../../../../apps/web/e2e/inbox-smoke.spec.ts), lines 62–67). Thus 149 is inventory, not 149 executed passes; the successful observed terminal split is **148 passed + 1 skipped**. A new skip, lost project, focused selection, missing identity, failure, or retry/flaky result cannot be hidden by a count of 149.

Geometry is a different selection: 7 tests / 5 spec files / 1 `chromium` project, config `playwright.trace-geometry.config.ts`. It measures real component styles without the application/API stack. Its files are `chat-plan-panel-scroll-geometry` (2 tests), `chat-rail-notifications-geometry` (2 viewport-specific titles), `chat-trace-collapsed-spinner-liveness` (1), `chat-trace-disclosure-geometry` (1), and `chat-trace-failure-forward-motion-geometry` (1). It remains a separately executed and reported step; the 149 identities do not include these seven. See [geometry config](../../../../apps/web/playwright.trace-geometry.config.ts), lines 3–17, and [web command](../../../../apps/web/package.json), line 17.

## 2. Same-run measurement at requested main snapshot

Bounded read: one successful API page filtered to exact head and push event, one run's job summaries, and the two existing job logs. The workflow-specific collection URL was rejected by the connector's URL allowlist; the approved generic `actions/runs` collection with the same exact filters succeeded. Terminal metadata identified [harness run 37340304743](https://github.com/boardx/workspacex/actions/runs/37340304743), `push`, `main`, attempt 1, head `e27f209357712603455f6f197cf0be196f3e2b7a`, **completed/failure**. Both checkout logs print that exact SHA; this main execution has no PR merge-SHA ambiguity.

| Existing job | Actual step result | Browser terminal data | Overall result |
| --- | --- | --- | --- |
| [fullstack-smoke / 111885908701](https://github.com/boardx/workspacex/actions/runs/37340304743/job/111885908701) | smoke success; geometry success; upload success; reused-verdict step skipped | 149 identities, 148 passed + 1 skipped, no retry/flaky rows; geometry 7 passed | success; informational workflow policy still applies |
| [full-regression-core / 111885908299](https://github.com/boardx/workspacex/actions/runs/37340304743/job/111885908299) | uncached full gate **failure**; upload success; reused-verdict step skipped | base failed, browser subsequently ran 149 identities, 148 passed + 1 skipped, no retry/flaky rows | **failure** |
| chat-read / 111885908413 | journey failure | not re-read in this bounded comparison | failure |
| self-service-profile / 111885908195 | journey success | not re-read in this bounded comparison | success |
| e2e-full / 111904758238 | Require every full regression lane **failure** | consumes the three full-regression job results | **failure** |

The logs were saved as temporary read receipts outside the repository:

| Local receipt | Bytes | SHA-256 | Relevant lines |
| --- | ---: | --- | --- |
| `/tmp/wsx-ci-budget-main-fullstack-smoke.log` | 835148 | `be71a25dec56c0212413f430ce8e30f19da4af5d018388c6ded3a0fdf735f34b` | checkout 2301; runtime 2494; isolation 2503; Running 149 at 4424; skip/pass 5054–5055; geometry Running/pass 5084/5094 |
| `/tmp/wsx-ci-budget-main-full-regression-core.log` | 911389 | `e4a6425d92a6a848b117f88e54df46916977e827669b2dd7a637d51c93f909d1` | checkout 2310; isolation 2895; base begin 2901; failure 3175; browser begin 3177; Running 149 at 5145; skip/pass 5810–5811; browser pass 5812; exit 1 at 5830 |
| `/tmp/wsx-ci-budget-main-harness-browser-jobs.json` | bounded run/job metadata | available to integrator; not a repository authority file | exact run/head/attempt and actual step conclusions |

Base failed at `lint:vocabulary --strict`: `docs/testing/d011-reconstruction/canvas-inventory.md:34` used the replaced term `MAAU` (core log 3160–3173). The browser lane did continue. The `&&` base chain stopped before later lint/harness steps, turbo typecheck/lint and default tests; this run does **not** prove those later base checks passed or executed. The failure must survive any browser consolidation.

The pure-data legacy parser matched each log's 149 rows against the prior discovery identities: project, file, line, column, full title path, repeat index 0. Missing/extra/duplicate identities and retry rows were absent, with the same one existing fixme. The geometry seven also matched individually in the smoke log. Sorted identity-set SHA-256 (IDs joined with LF and final LF): fullstack `379a223ee702ead0f372f2ac3e6c9658e1f41c68b6392493b3c049ee94c3b91d`; geometry `efe9e4822574db1c901bf4a710ca4499c5d363de3ad54fc9f854ad2e1b0fef6d`.

This is **comparison-only**. `comparisonComplete=true` does not authenticate per-test lifecycle, configured hooks, filesystem/dependency closure, or candidate execution authority. The parser keeps `executionAuthorityVerified=false`, `apiVerified=false`, `protectedVerified=false`, `reuseEligible=false`, `skip=false`, and `runFull=true`. It did not execute candidate configs/imports or test discovery in this task. See [legacy parser boundary](../../../../.harness/scripts/lib/ci-candidate-fullstack-inventory.mjs), lines 280–308. Historical #5400 had one flaky retry and is not a stable-pass substitute; subsequent #5404/#5406 saved observations do not substitute for this same main run.

Read-only GitHub contents and local Git blob IDs establish that **four relevant definitions** are byte-identical at frozen777 and requested e27: fullstack config `3cd1fe5624842604fb3129766f9593c98177b858`; lane orchestrator `1680ca5cdb91ccb08ecc4ee39361c06ba2d05a37`; runtime wrapper `fc66c2f59dc6f72596b16235c3b7345d9510b3f4`; root package scripts `fb734b9a3338b3635274f004468448c4c2768d75`. This bounded comparison did not assert equality of every product file, every installed dependency, every lockfile, or complete trees across the two commits. The requested main tree in the run metadata is `ee242dc09725ebc93425c3ec30b52f2f233429b8`.

## 3. Runtime and provenance are not interchangeable today

| Dimension | fullstack-smoke producer today | full-regression-core browser today | Consolidation implication |
| --- | --- | --- | --- |
| Source | own checkout, credential persistence explicitly false; pre-install identity action at frozen777 | own checkout; checkout default credential persistence; same new identity action at frozen777 | Same run SHA is necessary, not sufficient; bind actual checkout and reviewed workflow definitions. e27 predates the new identity action. |
| JS install | own `pnpm install --frozen-lockfile` on hosted runner, then installed workspace mounted into container | own frozen install on hosted runner | Two materializations/hooks/build outputs; no measured dependency-byte equality. |
| Browser / OS | reviewed Playwright 1.62.0 Linux/amd64 image digest `02bbb2155cd7109e3e9c741941097ed1608cf8b6fa44ee2595896da2bdc1f471`, `/ms-playwright`, browser readiness probe, outer APT blocked | hosted Ubuntu plus `playwright install --with-deps chromium`; main log downloads Chrome/Headless Shell 151.0.7922.34, Chromium revision 1234 (lines 2634–2672) | Same Playwright selection does not prove OS/library/launch environment equivalence. Choose a canonical browser runtime before activation. |
| Other toolchain | host Node/pnpm/Docker/Compose/unzip mounted read-only into outer container | host tools; additionally `uv 0.12.5`, `uv sync --frozen --extra dev` for the base API cross-language tests | Retain Python/base setup; browser consolidation does not cover it. Both actual logs show Node v22.23.3. |
| Environment / auth | outer container allowlist: CI, SHA/run/attempt, server timeout; optional existing public-read Skill import credential; no runner/admin token substitution | host process environment inherited through isolation wrapper; workflow does not explicitly supply the optional Skill import credential | Main smoke auth probe reports credential present and quota HTTP 200 (line 2438). Core auth profile cannot be inferred identical. Never add a secret/token to normalize this silently. |
| Data / services | fresh isolation ID `run-muvibpmp-58058e7b-37dab5ef6c7a`, its own DB/Compose/ports; five loopback provider services, seeded API, clean Next build | fresh isolation ID `run-muvidq30-f25dbbd8-dcc73893d1db`, different DB/Compose/ports; same config but base executes first in the outer scope | Their mutable data and process lifecycles differ. Share one complete browser execution, not a database, build directory or another live job's services. |
| Network / mutable boundary | host network and IPC; read/write repository and HOME mounts; Docker socket mounted; sibling infrastructure builds through host Docker | host network and Docker; public GitHub imports and infrastructure builds | The digest seals the outer browser image, **not** the whole execution. Outer APT blocking does not prevent the PostgreSQL sibling image build's APT/network activity. No read-only-input/runtime closure was established. |
| Artifacts | runtime log/manifest and web test-results; separate geometry log; artifact `phase-01-fullstack-smoke-evidence-37340304743` ID 11362050766, 73060041 bytes | full e2e log/optional success manifest and web test-results; artifact `phase-01-e2e-full-evidence-37340304743` ID 11362435204, 78670292 bytes | Artifact upload success does not mean test success. Both artifacts uploaded although core failed. Archives were not downloaded or promoted to protected evidence. |

Runtime details are executable in [wrapper](../../../../.harness/scripts/ci-fullstack-runtime.mjs), lines 29–59 and 69–121. Shared application setup is [fullstack config](../../../../apps/web/playwright.fullstack-smoke.config.ts), lines 688–837: Docker postgres/redis/minio, migration/seed, loopback providers, API health, and `rm -rf .next-fullstack-e2e && next build && next start`, with `reuseExistingServer:false`. [Seed](../../../../apps/api/scripts/seed-fullstack-smoke.ts), lines 4 and 72, calls `migrateOnce`; this migration coverage remains in the browser execution. The isolation wrapper reserves scope/ports, runs admission, forwards output, cleans the stack and propagates signal/process/cleanup errors ([wrapper](../../../../.harness/scripts/with-test-isolation.ts), lines 65–94 and 113–197). Existing heavy-lock code matches literal `playwright` and `test` argv tokens; these outer `pnpm run …:raw` wrapper argv do not themselves contain those tokens. Do not claim the comment alone proves heavy-lock admission for either chain.

Environment-sensitive assertions exist without changing IDs: [inbox spec](../../../../apps/web/e2e/inbox-smoke.spec.ts), lines 121–148, switches 200/503 expectations with `GITHUB_ISSUE_TOKEN`; config permits counterproof/reuse-infra flags and CI-specific reporters/retries. CI globally permits one retry except explicit project overrides ([config](../../../../apps/web/playwright.fullstack-smoke.config.ts), lines 649–665). This comparison observed no retries but did not rewrite that policy. A future consumer must not treat flaky retry success as stable evidence.

## 4. Existing verdict and applicability contract

At frozen777, [workflow](../../../../.github/workflows/harness-verify.yml) lines 548–630 make fullstack-smoke informational with job-level `continue-on-error:true`. A job/check green is therefore insufficient: inspect the actual `Execute trusted full-stack smoke` step, separately from `Execute trace disclosure geometry`. The smoke shell retains the command's exit with `PIPESTATUS[0]`; geometry and upload run with `always()` after a real producer execution. The manifest is generated only after command success, but it is candidate-executed JSON and its nonzero-count check is not complete inventory authentication.

Core has no job-level continue-on-error. Its actual full-gate step propagates the full command exit (workflow lines 683–700). `e2e-full` retains exactly `needs:[full-regression-core,chat-read,self-service-profile]`, and [aggregate](../../../../.harness/scripts/ci-full-regression.mjs), lines 6–22, accepts only all three literal `success` results; missing/skipped/failed/cancelled/invalid input cannot pass. On whole-workflow cancellation its `!cancelled()` guard can leave the aggregate cancelled/skipped rather than actively failing; that still is not a green verification. The e27 workflow uses the same contracts at smoke 534–616, core 618–696 and aggregate 801–811 ([immutable main workflow](https://github.com/boardx/workspacex/blob/e27f209357712603455f6f197cf0be196f3e2b7a/.github/workflows/harness-verify.yml)).

| Event / input | fullstack-smoke + geometry | core/base + chat-read + profile + e2e-full | Future same-run sharing boundary |
| --- | --- | --- | --- |
| pull_request (including synchronize) | runs, informational | condition-skipped | No second full-regression browser execution exists to remove. Keep PR behavior. |
| main push | runs | runs | Only this run/attempt may share after runtime/profile decision. |
| `v*` tag push | runs | runs | Same isolation and verdict rules; preserve release applicability. |
| merge_group | runs | runs because event is not pull_request | Candidate-group source/base/head remain distinct from PR/main; no cross-event reuse. |
| workflow_dispatch, run_e2e_full=false | runs | condition-skipped | Keep smoke and geometry; do not add a full consumer. |
| workflow_dispatch, run_e2e_full=true, fresh_run=false | runs | runs | A new run may share only its own real producer; not a prior same-SHA run. |
| fresh_run=true or native Re-run jobs | existing independent fresh paths | existing fresh full command | Preserve the request: opt out of consolidation or run the complete original consumer command afresh. Never mix attempts. |

Push triggers are only main and `v*` tags (workflow lines 34–67). A personal branch update is PR synchronize, not a second personal-branch push trigger. Schedule is currently absent despite a dormant smoke schedule condition.

Existing [lane dedup](../../../../.harness/scripts/ci-lane-dedup.mjs), lines 53–78 and 89–108, is a separate cross-run feature: same workflow/SHA/lane, 24 hours, push/dispatch sources, excludes PR, preserves newer failure, requires actual execution/upload steps and an unexpired named artifact; fresh/rerun forces execution. It is not this design's authorization to consume an earlier run. A same-run producer that itself only executes `Preserve reused verification verdict` is **not a real same-run browser execution** and must not qualify.

## 5. Minimum future design, without a proof platform

The smallest useful change is a CI-only browser producer/consumer contract, not a general receipt store. Keep the public `pnpm run verify:full` and its two real lanes unchanged. Keep the aggregate check names and three dependencies unchanged. Keep all non-browser full-base checks and Python setup; keep geometry as a separately executed step with its existing informational policy. Do not make a geometry failure silently count as browser failure/success; do not introduce a new blocking geometry requirement without a separate decision.

**Option A (preferred after the runtime decision):** the existing fullstack-smoke execution becomes the single browser producer for applicable automatic full-regression events. The CI core path runs the complete uncached base lane in its own isolation and then a same-run browser verdict consumer; that consumer runs even if base fails, and the core's final verdict is base AND browser. It consumes only the actual smoke step, not the informational job result. Its producer must execute afresh inside this run/attempt, bypassing the producer's existing cross-run dedup for this path. Geometry still runs independently and records its own result. A new small CI-specific entry point may compose this path; it must not redefine standalone `verify:full` or accept a caller-provided `browserPassed` flag.

**Option B (if preserving the current host browser is chosen):** core keeps the browser owner, with base and browser exposed as separate actual workflow steps that both execute; main's informational fullstack presentation consumes the actual browser step while retaining a fresh independent geometry execution. Core's current monolithic full-gate step alone is insufficient as a producer: e27 demonstrates that it can fail for base while browser passes. This option moves the main smoke browser from its current sealed profile to the host profile; it therefore also requires an explicit runtime decision. PR retains its current standalone sealed smoke execution.

Neither option is an equivalence proof of the two current environments. Until the canonical runtime, credential profile and diagnostic acceptance are settled, continue both existing executions and observe the comparison. No new persistent CAS, catalog scan, full repository index, protected fullstack reporter platform, or cross-run/PR→main reuse is part of this bounded design.

A future consumer's scope is exact repository/workflow/run ID/run attempt, exact producer job identity, approved command/step identity and actual checkout (including merge-group base/head when applicable). Use GitHub's actual step/job metadata and workflow-controlled process exit path; candidate stdout, manifest fields, artifact names or a JSON `apiVerified:true` never grant authority. Artifact content is diagnostic and tied to an API-returned artifact ID/digest, not a self-declared green. If that bounded observation cannot be obtained reliably with the current read permissions, retain fresh execution. There is no permission expansion in this proposal.

| Producer / consumer state | Required policy for future core consumer |
| --- | --- |
| Actual smoke step completed success; exact scope matches; unchanged approved selection/runtime/profile; diagnostic inventory matches | Accept this run's browser result only; base still must succeed. Keep explicit existing fixme as skipped. This is standard same-run CI gating, not authenticated execution-closure proof. |
| Job reports success but smoke step failed, cancelled, timed out, missing, skipped, or only reused-verdict ran | Reject the green job. An observed actual failure remains a failure; do not replace it automatically with older success or another run. |
| Observed failed/flaky/retried test, new skip, missing project/ID, focused selection, worker/hook error or incomplete terminal output | Do not accept a browser pass. Preserve failed/incomplete diagnostic state and keep the gate non-green. |
| Producer absent/condition-skipped, checkout/definition/profile mismatch, upload absent, unreadable metadata, permission/read/validation error | Fall back to the complete original fresh consumer command, not a success default. Keep a visible fallback reason. If fallback cannot finish, result remains non-green. No unbounded retry loop. |
| Producer pending | Wait only for the declared same-run dependency within existing budgets; no polling of workflow history/catalog. A timeout cannot pass. Base may still execute independently. |
| Whole workflow cancelled | Propagate cancellation; do not launch a replacement measurement or publish green. |
| Only consumer is rerun, producer belongs to an earlier attempt | Do not combine attempts; run original fresh full command for the consumer. |
| Producer rerun after consumer completion | It cannot rewrite the consumer's previous result. Require a new matching consumer attempt or fresh independent full run. |
| Explicit fresh_run/manual independent request | Keep all original fresh entry points and uncached full execution; no historical or prior-attempt consumption. |
| Geometry fails but smoke succeeds | Preserve geometry failure visibly; decide the browser consumer from smoke only under current policy. Do not mask geometry or silently make it a new aggregate dependency. |

Artifacts in a future path need an unambiguous run/attempt/job binding so a rerun cannot select an earlier artifact with the same run-only name. This is a small naming/binding decision, not permission to create an external persistence service. Failed and fallback executions retain their logs and test-results. The base/browser consumer must remain independently observable, so a successful artifact upload cannot wash out a failed test step.

## 6. Decisions and next actions

| Item | Owner | Acceptance before implementation/activation | Next action |
| --- | --- | --- | --- |
| Canonical runtime and credential profile | CI integrator + security reviewer; human for any permission change | Choose A sealed or B host knowingly; account for current host-vs-container and credential differences without broadening secrets/token rights | Review the two existing runtime contracts above; keep both executions meanwhile |
| Same-run consumer and fallback | CI integrator | Same run/attempt actual-step result, exact source/selection; failure/cancel/absent/read-error paths never green; real base failure still fails core | Design a bounded API/step interface; exercise focused synthetic negative paths only when implementation is authorized |
| Independent geometry and full base | CI integrator + coverage reviewer | Geometry remains a fresh separate seven-test scope; base keeps harness, full typecheck/lint/default tests and locked Python; chat-read/profile remain aggregate inputs | Check proposed graph against current matrix and the e27 base-failed/browser-passed counterexample |
| Standalone/manual verification | CI integrator | `verify:full` keeps both lanes; fresh dispatch/native rerun independently execute original commands; PR/main/MG/tag applicability unchanged | Specify CI-only invocation and explicit no-sharing paths before any workflow edit |
| Evidence and timing | CI integrator | Report metadata comparisons separately from execution authority; measure actual before/after on comparable runs only | Retain this same-run sample as baseline; do not claim saved minutes from observations alone |

The observed browser summaries were 13.7 minutes in sealed smoke and 19.4 minutes in host core, and smoke geometry was 7.3 seconds. These are different runtime/startup paths in a run whose core/base and chat-read failed; their difference is not measured consolidation saving. A future design could remove one actual browser invocation on eligible full-regression paths, but no time saving has been measured here. The earlier release sample's approximately 13-minute path estimate remains a separate estimate; it cannot justify a claim that all CI or every PR duration is halved. Production deploy/version/health/login/core-flow/necessary migration checks and backend/Board lanes stay outside this consolidation.
