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
