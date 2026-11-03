# Complete interview localization — #6206

Original checkout; branch `worker/i18n-interview-journey-6206`; develop target; stacked on research #6205 `4aa2a1e08443d9cfa1bec718a15e282126098899`. No new worktrees or child agents. Main coordinates the native merge queue.

The route surface includes `/itv`, `/itv/new`, private expert profiles, canonical intake/analysis/experts/outline/runs/report, reachable setup fallback, quick and live. UI tests cover locale changes, retained drafts/selections, no unintended requests, editable shortcut prefills, unknown diagnostic preservation, source quotation guards, approval blocks, and canonical category filter values. Browser acceptance is separately pending.

Validation receipts, including actual historical failures, are in `validation.json`. Logs are recorded by absolute local path and SHA-256. Latest results:

- 38 affected UI files: 327/327 passed, including 42 initial localization cases (9 subsequent unknown-lookup cases passed separately).
- API typecheck passed; web typecheck passed after correcting missing metadata in a new test fixture.
- All changed web files scoped ESLint passed; route wiring and static testid gates passed (18 existing shell routes unchanged).
- Deterministic workflow model fixture: 6/6 passed, including strict operation/system/context rejection and grounded-report assessments.
- Existing dictionary parity test failed before correction; catalog/export/legacy/workspace subset then 21/21 passed.

Raw authored/private/model content, canonical Markdown headings, generation prompts/seeds, identifiers, request enums, source/version/hash/span matching, CAS and session/cache identities stay intact. Existing source helper comparisons confirm `reportFor`, `analysisMarkdown`, `buffersFrom` and `skillContext` are unchanged. Known UI quality reasons translate by code; unknown diagnostics and authored goal text remain raw. Chinese backend diagnostic strings remain verbatim. Fixed expert taxonomy filters retain their canonical values.

The browser case uses actual login, APIs, Postgres and saved documents. Its model upstream is a deterministic test fixture. It does not establish real-model quality, external ASR, report download bytes, or native Skill execution. No completion, green PR or merge claim is made before those signals exist.

First fresh production browser at fa1d63c91fd: build succeeded; case failed7.8s because its parent dialog locator retained the English accessible name after switching Chinese. Screenshot and error context show the Chinese dialog and exact authored values intact. Selector now uses one dialog plus explicit English/Chinese headings; draft assertions remain. Total4m4, cleanup1s; dynamic own compose scope wsx-233aacc74a7a61388690 was empty afterward. This is a retained failure, not browser acceptance. A separate read-only audit found inherited-object-property names could bypass three unknown-value fallbacks;9 new counterexamples await actual RED before changes.

Prototype-name regression:9actualRED/7GREEN across16cases7.09s, with render errors caused by inherited object properties. Three Object.hasOwn checks restrict mappings to declared entries. Related16/16PASS3.75s; affected webtype0 and scopedlint0. No API/Markdown/enum/ID changes. The locale-dependent parent dialog selector is corrected and keeps both locale heading assertions. A fresh browser run is required for this final runtime source.
