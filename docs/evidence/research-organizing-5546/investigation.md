# 用户研究 organizing failure — #5546

## Verified read-only facts (2026-10-10)

- Worktree reused; fetched and fast-forwarded to origin/main bd75d4f413ca3585c6c8258f1501121c53ebc89f. Branch worker/coord-deep-research-5546-organizing.
- Existing authenticated Chrome report page reproduces the visible failure after reload. No report command or external model rerun issued during investigation.
- Captured runtime GET HTTP 200 through Chrome CDP, after Network.loadingFinished (1,451,997 encoded bytes). Session grs_3d2fadcc01ff433dbcea1335e6f3b09b, version 5, revision 7.
- errorCode RESEARCH_WORKFLOW_UNAVAILABLE; progress organizing completed 15 total 23. Evidence timeline attempts 16, start 2026-10-10T07:01:06.768Z, end 07:02:52.108Z. No chapter/review/synthesis/validation started. reportCheckpoint has empty chapters.
- Last failed report model call b61a3dbd-e2bc-4ba9-9383-420e01642748 created at 07:02:31.978Z; preceding 15 report calls marked succeeded. Model qwen3.7-plus.
- 23 accepted sources, 22 include fetched documents (2,871–60,000 characters). Existing runtime has zero questionEvidence and claimEvidence. Private ledger is not exposed by the public runtime response; its absence cannot be inferred.
- Three earlier executions on October 9 likewise recorded 15 report successes followed by one failed report call. This suggests a repeatable boundary, but does not prove parser, provider, or persistence cause.
- Runtime activity shows source reading completed at 07:01:05.971Z; failure occurs in report evidence extraction, not necessarily source retrieval.
- Existing real-model-chat-evidence workflow runs latest October 7, outside incident window. No unrelated workflow run triggered.

## Access and inference limits

Direct browser API navigation was blocked by browser/client policy, not a verified server 403. Public runtime XHR succeeds. Normal platform-admin/inbox entry is being checked. Debug recorder /system/debug/events requires PlatformOperatorGuard; app_diag_ro CLI credentials or an authorized server connection are not yet established. Running deployment SHA is unverified. Main membership does not establish deployment.

The initial investigation had not established the root cause; see the dated local reproduction below. Do not weaken citation, evidence or publication checks based on generic error code.

- Normal platform-admin/inbox UI is accessible and system-exception filter shows 62 grouped entries. Visible newest front-end groups last occurred October 5; no October 10 research incident shown in the first page. This proves existing platform UI access, not absence of private debug events.

## Independent local analysis

Applying current main canonical-document selection and 6,000-character chunks / 24,000-character batch boundary to the captured source data yields exactly 23 batches, matching runtime total. Zero-based batch 15 contains Jiangmen post_3245984 chunk 0; BBC cdj792z4j74o chunks 0–1; designmarathon /task chunks 0–1 (21,501 characters). Batches 12–14 include the 60,000-character oral.cuc.edu.cn document. Concurrency/completion order means completed=15 does not uniquely identify the failed batch without per-call diagnostics. No schema cap of 15/16 exists for modelCalls or timeline attempts.

Existing pure-unit evidence tests pass: `pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts tests/research/guided-report-evidence.test.ts --maxWorkers=1 --minWorkers=1` (14 tests). This exercises bounded batches, invalid JSON repair, unknown references, non-verbatim quotes and deterministic ordering; it does not reproduce the incident. An initial invocation using the default config was rejected before any test because database isolation was absent; rerun used the repository's pure research config, without starting Docker.

Primary checkout .env.local exists and includes model configuration, but no DIAG_DB_USER/DIAG_DB_PASSWORD/PGHOST/PGPORT/PGDATABASE keys; process environment also lacks those. No actual app_diag_ro connection is established. No fixture contains provider secrets. No model replay had occurred at this initial investigation stage.

## Pending diagnostic input

Historical API diagnostics remain unavailable. Current local reproduction and fixes below are independently verified; they do not assert the exact historical failed request payload.

## Current public deployment marker

At 2026-10-10T07:50:39Z, GET /.well-known/workspacex-deployment returned HTTP 200, cache-control no-store, marker bd75d4f413ca3585c6c8258f1501121c53ebc89f matching current origin/main. This is the Web runtime marker read now, not independent API build identity or evidence of the version at 07:02:52Z failure. Historical incident API SHA remains unverified. Marker JSON saved alongside this document.

## Local reproduction and correction (2026-10-10, after initial investigation)

Development base was updated to origin/main 647a6532e51214b92fe767aa645a319b5fb58958. A bounded real-provider replay at the suspected extraction boundary returned HTTP 400 with exact error.code `data_inspection_failed`. The prior adapter discarded this category and propagated a generic model failure. Two of three reread public documents matched captured hashes; the BBC page had changed. This reproduces a concrete failure mechanism, not the inaccessible historical API trace.

The configured provider now exposes only an owned content-rejection enum for this exact status/code. Source relevance and evidence extraction exclude the rejected request batch and retain a bounded, schema-validated rejection record (request digest, source/chunk IDs, content hashes and question IDs). No provider message, source body or token is stored in rejection diagnostics. Identical actual request/model-instance bases are not resent; changed content, questions, instructions or model instance invalidate reuse. Content refusals neither trigger retries/provider fallback nor enter validated irrelevance caches. Other errors/cancellation retain their failure behavior. All-refused/insufficient-basis paths retain the evidence gate.

First full local service execution after that fix saved a four-chapter formal report; regeneration retained a four-chapter draft because the independent reviewer found two omitted chapter-level questions. This was NOT accepted as completion. The writer had expanded only subsectionPlan; chapter questions existed elsewhere in input but had no explicit placement. Immediate repair feedback was named review while the system instruction only referred to previousReview. The correction derives questionCoveragePlan from the same deduplicated IDs as evidence/review, places main questions in chapter lead prose, and maps missing review verdicts to exact questionsToRepair. Existing two-attempt limits and independent citation/quality checks remain. The no-evidence draft branch now retains chapter questions as unresolved scope, without promoting placeholder content.

Regression red/green: missing coverage plan 1 failed / 123 passed before fix, 124 passed after fix; no-evidence main-question preservation separately failed before correction. Research suite 32 files / 712 tests passed before final no-evidence scope correction (final rerun recorded separately). API/Web TypeScript checks passed. Initial ./init.sh quick verification passed; it does not constitute the full repository test suite.

Real fixture uses seven publicly reread sources, original 32 questions and four chapters, with reportPartial=true. Source titles/task IDs and omitted optional chapter metadata differ from the online runtime. Five public document hashes match captured hashes; two pages changed. File store validates PersistedResearchRuntimeSchema on reread. This is a local model/service/persistence replay, not a full 23-source devapp or database acceptance. No unrelated workflow was triggered. Latest first→regeneration verification is in progress and must be recorded truthfully before review handoff.

## Follow-up: repair feedback hid the machine rejection

The next real run after main-question placement still produced drafts: first 313.119 seconds / 27 calls / three quality warnings; regeneration 235.725 seconds / 21 additional calls / one quality warning. Both four-chapter drafts persisted and reread correctly, but neither was a formal report. Main questions were present. The machine gate rejected `answered && evidence.gap`, while its issue contained only the reviewer's positive rationale. The repair selector also only selected `missing`. Thus the writer did not receive the actual direct/context conflict as a targeted repair item.

A failing regression showed `q: Claim an answer.` instead of the missing-direct machine reason. The correction keeps the same failure predicate, supplies its owned explanatory reason, adds the exact per-question quote scope/direct-context status to questionCoveragePlan, maps answered/no-direct questions into questionsToRepair, and tells the independent reviewer that other questions' quotes can support background without establishing this question. No `answered` verdict is rewritten to `gap`; revised prose must pass independent review. First and regeneration service entry points both exercise this feedback and durable formal save in controlled tests. Final research suite: 32 files / 714 tests passed; API typecheck passed after feedback correction. One final bounded real first→regenerate replay (60-call cap, independent per-round persisted snapshots) is in progress. There will be no unbounded further model reruns if it fails.

The captured online runtime has reportPartial=false and four succeeded tasks. Removing only the three source IDs in the suspected evidence batch would leave accepted source associations per chapter 8, 4, 4, 5 (before exclusion 8, 4, 6, 6; shared associations can overlap). This is a static calculation on captured data, not a new source-relevance verdict or proof of full online recovery. The seven-source local fixture deliberately uses reportPartial=true because it loses the only chapter-four assigned source on screening refusal.

## Release verification boundary

Affected API lint and Web ESLint passed. verify:release exited 1 after 13 seconds at the repository's oss-secret-scan gate (before full repository tests). It reported five baseline-external assigned-secret locations: `.harness/scripts/vm/test_isolated_conservation_evidence_producer.py`, `.harness/scripts/vm/test_retained_backup_helper.cjs`, `apps/api/tests/auth/runtime-model-usage.test.ts`, `apps/api/tests/research/guided-chapter-citation-repair.test.ts`, `apps/web/tests/whiteboard/board-primary-failure.test.ts`. All five files are byte-equivalent to development base 647a6532e51214b92fe767aa645a319b5fb58958 per git diff --quiet. No credential values were emitted, and no unrelated file/baseline was changed to bypass the gate. The isolation wrapper completed cleanup; this run started no Docker stack. Full release validation remains blocked, not passing.

## Why the local sample is partial

The initial bounded provider probe targeted the suspected three-source extraction batch. Four additional publicly readable sources were added to exercise the entire service/persistence path with the original chapter/question scope. Only public URL rereads and metadata/hashes were transferred into the local replay; the large captured authenticated runtime stayed in the browser tooling. Historical API diagnostics and a lawful complete local runtime export were not established. The fixture was consciously limited to seven source pages and reportPartial=true; it must not be presented as original 23-source acceptance. That reduction removes the only fixture source assigned to chapter four on source screening rejection, whereas the captured online session retains five chapter-four associations after only the suspected three-source exclusion. Local quality failure therefore is a boundary of this sample/candidate, not proof the online full-data session has the same quality failure. The final replay retains all 32 original questions and every planned subsection; it does not narrow the question scope to make a report pass.

## Frozen final replay results (exit 1, no further real-model reruns)

First: 269.603 seconds, 25 model calls, one source request refusal excluded, four persisted draft chapters, zero formal chapters, one quality warning (chapter four/question seven: context-only evidence while reviewer says answered). Independent first snapshot reread validates both report/draft fields. Regeneration: 231.740 seconds, 19 additional calls, no additional refusal (total one), four persisted draft chapters, zero formal chapters, three quality warnings. Regeneration warning details are in final-real-results.json; they include a no-direct answered conflict and a chapter with no usable verified excerpts. Both snapshots retain partial=true. Log and summarized warning metadata are saved beside this document; complete runtime/source bodies remain outside Git. The local sample does NOT establish successful formal first/regenerated reports or full online recovery.

The remaining observed boundary is independent question-quality/evidence coverage in a consciously reduced seven-source fixture. The production repair is frozen. No adjudication scope change, increased model attempts, forced answered→gap rewrite, fabricated direct evidence, or quality/publication bypass was introduced. No PR was created pending main-session exact-SHA review; issue #5546 remains open.

## Evidence handling correction

While checking the relocated replay script, it was inadvertently executed without the child model environment. Two adapter invocations returned MODEL_PROVIDER_NOT_CONFIGURED before any provider HTTP dispatch; no additional real model calls occurred. That invocation overwrote the local first full-runtime snapshot. The archived final-real-replay.txt/final-real-results.json were copied BEFORE this event and retain the authentic first result, warning and successful reread observation. The authentic first draft, sources, outline and quality warning remain in reportPrevious of the independent final regeneration snapshot; that exact history is saved as /tmp/research-5546-first-report-history.json. It is a recovered history record, NOT the lost full first-runtime snapshot. The independent final regeneration snapshot remains unchanged. The replay script now rejects a missing model key before source reads or local writes. No more replay execution was performed. Reviewers must account for this limitation.
