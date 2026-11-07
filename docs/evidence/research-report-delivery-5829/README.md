# Research report delivery — #5829

Root cause: research uses the GET `ReportFileSourceInfo` response (four binding fields plus `title`/`notices`) as the strict POST source. `ReportFileRequest.parse` rejects the two extra keys before HTTP. Interview constructs exactly four binding fields. The fix projects research GET metadata to those same four fields; strict request parsing stays intact.

Evidence boundary: frontend controls + actual request helper + schema, HTTP mocked only. RED2 confirms neither format submitted; GREEN2 submits exact canonical identity. Shared native conversion pipeline is unchanged. Existing shared file service/content validators are regression-tested, not evidence of a new paid native execution for the user's live report.

Progress: suppress per-source automatic handling detail; neutral document warning text remains distinct from completed. Genuine blocking errors, pauses, interruptions and quality drafts still retain their states. Completed report removes upper source workspace; canonical source records and report references remain.

Discovery: fixed three-document stopping now uses distinct confirmed report questions (including subsection questions), floor3/cap9 per chapter. This is an evidence-pool target, not a citation minimum or coverage guarantee; all relevance/document/evidence/citation/review gates remain. Existing saved report is not rewritten, and no live generation was triggered to add citations.

Verification: API research, shared file service, web affected tests, both packages typecheck/lint. Isolated browser uses genuine API/PG saved report and source binding, intercepts POST with explicit controlled failed job to prove the former client-side failure is gone; no native model dispatch. No assertion of downloaded native PDF/DOCX or restored online report.

## Results

- `./init.sh`: quick baseline PASS.
- `pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts`: 38 files / 881 tests PASS.
- `pnpm --filter @repo/api exec vitest run --config vitest.report-files-unit.config.ts`: 52 PASS / 1 optional font test SKIP.
- Web affected suite: 6 files / 50 tests PASS (real schema adapter regression, shared/interview controls, timeline, report hierarchy, rewrite).
- Both packages typecheck and lint PASS.
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.research-ux.config.ts -g 'R5 '`: PASS, owned stack cleaned in 1s.
- Browser's first attempt failed in the test's native dynamic import (missing `AgentRunStatus` ESM export); static import fixed the test, second run PASS. Failure log retained.
- Browser sends both formats with exactly kind/id/reportVersion/reportHash from the genuine source GET; injected `INVALID_FILE` response explicitly tests real failure handling. It is not a native generation success test.
- Broad chapter reads 6 approved sources for 6 distinct confirmed questions, caps 12-question discovery at 9, deduplicates repeated section/subsection questions and URLs. Legacy per-question task keeps the prior three-document window. Empty question plan still refuses coverage; existing failed read, cancellation, retained-document retry and evidence/quality regressions PASS.

`report-completed.png` shows the controlled formal report before injected export failures. `requests.json` records only canonical request identities, never credentials. No deployment, live report regeneration, or new paid native run performed. Existing saved references are unchanged; the broader pool applies to subsequent authorized generation.

## Full CI regression correction

The first CI head (`9a8c854dc8318842b5078b18f8a7bb13066682f9`) had 24 successful checks and one failed full-stack check. This was directly related to the change: the old `guided-research-runtime.spec.ts:102` still clicked the now intentionally removed **completed-report** source accordion. Both attempts timed out; this was not an environment failure. 128 preceding full-stack cases passed, 93 were not run after that failure.

The existing complete spec now asserts that the duplicate entry/workspace is absent and verifies a real inline citation bound to `/research-evidence` with its accessible name; it also retains the later exact named reference assertion after reload (`Research E2E policy evidence`), all original per-question evidence, quality, persistence and recovery controls. It does not skip the test or change its timeout.

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded guided-research-runtime.spec.ts`: **1 PASS**, production build, actual UI/API/PostgreSQL with the standard controlled loopback model; 3m44s including cleanup1s. This is a complete report-generation/control-flow fixture, not a paid live-provider semantic evaluation or new native file-byte generation. See `full-flow-green.txt` and the original CI failure excerpt.

## P2 remaining-quota review correction

Review thread `discussion_r4310289429` identified a real limit bug in the initial pool expansion: a supplement counted only its own new query results, so an existing5/target6 chapter could admit six more. Five failing counterexamples reproduced the bug. The fix recomputes remaining capacity from committed, accepted document URLs for the same chapter before each supplemental batch and sizes the batch to that allowance. Normalized duplicates, unread/excluded documents and rejected candidates do not fill it. Legacy question-scoped supplements also respect the task's three-document budget. Primary/recovery attempts still count material approved in that attempt, so retained documents cannot short-circuit retry validation.

- `quota-red.txt`: 5 RED counterexamples /11 existing PASS before the fix.
- `quota-green.txt`: 31 PASS (19 progressive/quota +12 exact scope cases), including5/6 and8/9 admitting exactly1, duplicates over multiple queries, negative/unread/excluded material, legacy3 and a partial last primary batch.
- `quota-api-green.txt`: full research 38 files /889 PASS.
- `quota-typecheck.txt`, `quota-lint.txt`: API typecheck/lint PASS.
- `quota-full-flow-green.txt`: original complete production-build UI/API/PostgreSQL controlled-loopback spec PASS, 6m52s, cleanup1s. No new native or live-provider generation.

The test for publishing a first partial batch still checks the same persisted boundary; it now reads5 candidates instead of6 because only two further approvals are needed after the first accepted document. It does not admit an extra fourth document for a target of three.

## Optional CI cancellation boundary

On36717d1797b4ca1beef18df22812bfcca9ffd3cd, run39201160326 attempt1 recorded222 full-stack cases PASS (31.6m), Fabric1 PASS and trace geometry7 PASS, with successful evidence upload. The job nevertheless concludedCANCELLED. The check-run annotation explicitly says `The job has exceeded the maximum execution time of 40m0s`. This is not a successful job conclusion and is not counted as acceptancePASS. The source result lines are retained in `ci-36717d1-verification-results.txt` and the primary run URL is https://github.com/boardx/workspacex/actions/runs/39201160326/job/117894407988.

Attempt2 of the old36717d1 run was separately started as a bounded retry, then explicitly cancelled by the main coordinator to avoid redundant old-head work while this P2 fix was prepared. It must not be confused with attempt1's time-limit cancellation. No shared workflow timeout, Board code, check policy or assertion was changed. Final acceptance uses the new head, resolved review, actual required checks and official `harness pr-queue`; optional cancellation remains an advisory rather than a fabricatedPASS.

## First available export interaction lifecycle

The f0a988920 CI affected-Web run found a PDF error-state regression in the new HTTP-onlymock fixture. A fully settled sourceInfo binding via asyncact passes, but settling the test alone would not fix the product race: ReportFileActions initially exposed committed buttons before its passive effect advanced epoch/aborted controllers/cleared state. A first action in that gap sent its valid strictPOST and then lost its result when initialization invalidated it.

Two deterministic counterexamples use the actual ResearchReportFileActions async source binding and ReactProfiler's commit callback to click exactly once at the first committed button. Hooks are not mocked, no timer is added, and a strictPOST assertion passes before the expected server-error state disappears. Both PDF andWord fail under the old passive initialization (`first-click-red.txt`); the two asyncact-settled binding controls pass. Initialization/cleanup now use a small layout effect with the same dependencies and logic, establishing/retiring the source epoch before interaction. This is a product lifecycle fix distinct from the test's explicit async binding synchronization.

- Complete Web command: `WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web test` —943 files PASS,8192 tests PASS/5 conditional SKIP, exit0. The compact receipt records the relevant file results and complete-run totals; raw output retained at `/tmp/research-web-full-green-5830.txt` in this verification workspace.
- Existing source-version late-return protection stays tested; new disabled/unmount cases assert immediate abort and no late download. StrictMode retains one user request and one download.
- Web typecheck/lint PASS.
- Production R5 browser: actual saved report/API/PostgreSQL source GET plus real strict request helper, both formats POST and persist the explicit controlled server verdict;1 PASS,2m14s including cleanup1s. This does not generate new native file bytes or use a paid model. See first-click-browser-green.txt and first-click-browser-requests.json.
