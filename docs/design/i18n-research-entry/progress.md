# Progress — complete research journey #6198

Base: fetched develop `44aeac6e10b688471fe03536fc8490a353824976`, branch `worker/i18n-research-entry-6198` in the original checkout. Main coordinates merges; no additional worktree.

Standard init quick path passed. The entry RED cycle collected and executed nine tests: nine expected missing-English failures in 4.99 seconds. Logs are under `evidence/i18n-research-6198/`. Six additional workspace cases are written and have not run.

Entry implementation now covers ResearchHome status/actions/search/metadata, intake/import validation and pending creation, step navigation/unsaved dialog, shared Studio edit/delete dialogs, TagInput/TagField and InterviewVoiceInput. Translated notices retain semantic state; raw content, API payloads, IDs and ASR behavior are preserved. The five existing ASR reason descriptions now have one pure shared Chinese constant.

No GREEN, typecheck, browser, commit or PR claim yet. Third phase released its heavy window; phase2 owns one short provider RED, then explicitly hands off for entry GREEN and workspace RED. Next run workspace RED before implementing topic autosave, plan editing/confirmation, source/chapter/report chrome, history/regeneration and PDF/Word actions. Full research must be delivered in this PR; interview, recording and B6 survey follow as separate complete-journey PRs.

## Workspace and overlay implementation

Workspace first cycle: 6/6 RED followed by 6/6 GREEN (3.85 s). Overlay first cycle: 4/4 RED (2.54 s) followed by 4/4 GREEN (2.64 s). Four new-title cases then proved 2 English failures / 2 Chinese successes alongside the four existing overlay cases (3.26 s). Creation now localizes only the new editable title; existing titles and subsequent edits remain raw.

Main clarified that user-visible shortcuts prefill localized editable drafts, without automatically sending. Internal system/developer/tool instructions and fixed command prompts stay unchanged. The controlled assistant test verifies localized prefill, later user edits across locale changes, IME and confirmed-text send behavior.

First related regression: 67 files / 627 executed, 626 passed / 1 obsolete Contents expectation failed, 101.43 s. The test now distinguishes interface Contents from canonical report headings. Focused rerun after that correction and test option cleanup: 4 files / 32 passed, 9.09 s. Scoped ESLint passed before subsequent small resource reuse changes.

First web typecheck failed only on 38 redundant `exact: true` Testing Library role-query options in the new/updated tests. These were removed (string role names already match exactly); focused tests passed. Typecheck has not rerun, so type status remains unverified. No browser has run yet.

Remaining checks: latest source type/lint and registration, fresh complete regression, exact one-case Playwright discovery and isolated production-browser run with actual history regeneration, screenshots, independent review, normal push and green PR. No extra worktree or local service stack is active.

Route correction: ResearchTopicInformation focus/autosave is currently used by a historical prototype. Its component tests are supporting coverage only. The actual persisted /import route edits the goal; optional topic/time/region/focus are entered on /research/new. Browser acceptance must use that actual route tree.

## Final pre-browser checks

Final web typecheck and scoped ESLint exited0. The final affected regression ran10 files/112 tests, all passed in18.89s. Actual Vitest registration passed69 configs/12 live specs. Isolated Playwright discovery selected exactly1test/1file in2s,cleanup0s; standard init quick passed again. Original logs are indexed in evidence/i18n-research-6198/validation.json with committed normalized receipts. Browser execution is the next unverified gate. A fresh fetch of main/develop showed no new develop commits above this branch base.

## First browser and visual follow-up

Source e8ece66846e6edc82546bc3ec0f01f0140b5eddd completed the actual standard production-browser case:1/1 pass,59.7s; fresh build/wrapper4m59s,cleanup1s,own-scope containers0. All10 screenshots were viewed. Phase3 independently reviewed the exact source diff and found no actionableP1/P2 within that diff.

Visual QA nevertheless caught mobile step-label truncation at375px. Inspecting the actual indicator found its screen-reader completion text still hardcoded Chinese. A tenth entry unit counterexample (English completion/DOM identity) and real browser label-geometry checks are now written. They are not yet executed; no product follow-up has been applied. Phase3 currently owns its continuous validation window; request entry RED immediately after explicit release, then fix and rerun fresh browser on a new reviewed SHA. Preserve first-run evidence under browser-first/ as a finding, not final visual acceptance. The source/protocol/body contents remain unchanged by this planned fix.

Follow-up actual RED:entry10 executed9pass/1fail in3.78s. The original navigation contained Chinese completion text in English. After the bounded/wrapping label and ui.completed fix, the affected10-file suite passed113/113 in18.82s; webtype/scopedESLint exited0. Tag IME and voice stop control DOM-identity checks also passed. A new source commit and identical isolated fresh-browser run remain the next gate.

## Route-aware helper and current develop integration

The323c production build passed and all8 workflow geometry captures passed. The case timed out only when the new generic screenshot helper incorrectly waited for step navigation on the final /research list metadata dialog. Actual failure snapshot/callsite confirm this route mismatch. The test-only correction explicitly requires list nav0 and step-route nav1 while retaining every label bound; timeout/retries unchanged. Own scope6ee2b7c7e134ce4db180 was checked0 after cleanup1s (wrapper6m57s).

Current develop c49fee15b has been merged into the working tree. Only two dictionary-tail conflicts needed union resolution, retaining adminNavigation and both research namespaces. All41 owned product blobs match323c byte-for-byte; the route-aware spec is the only own code delta. Integrated type/scopedESLint passed; live catalog check found1532 keys in each language, all432 own namespace entries preserved with0 mismatches. The merge/source commit and fresh one-case browser are next; no final browser pass is claimed yet.
