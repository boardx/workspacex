# Complete research UI internationalization — #6198

Final runtime source: `74c46f0e05d2fc23e1f1bd9ffc18ddd7acac0832`, branch `worker/i18n-research-entry-6198`, develop target. All work used the original checkout, serialized with peer workers.

| Check | Observed result |
|---|---|
| Standard ./init.sh | exit0 quick path; not full repository verification |
| Focused regressions after stepper fix | 10 files,113/113 pass,18.82s |
| Integrated web typecheck and scoped ESLint | exit0 each |
| Catalog continuity after develop merge | 1532 keys/language,432 own namespace keys,0 mismatch;41 own product blobs unchanged from323c |
| Vitest reachability | 69 configs,12 live specs reachable |
| Final exact isolated Playwright discovery | 1 test/1 file,2s,cleanup0 |
| Final fresh production browser | 1/1 pass,case display1.0m,total4m56s,cleanup1s,own scope0 containers |
| Final visual QA | All10 final screenshots viewed at375/1280; workflow step and document bounds asserted |

Final artifacts: browser-final/, browser-route-final.txt, route-playwright-list.txt and validation.json. Receipts normalize ANSI; validation.json retains hashes and local paths of full original logs and observed process exits.

Historical failures remain evidence: the first browser passed but visual QA found truncated steps and untranslated completion text. The stepper counterexample then failed1/10 before the fix and focused113/113 passed afterward. The second browser built successfully and passed8 workflow screenshots but timed out at180s because its helper incorrectly expected step nav on the list metadata modal. The final test explicitly checks list nav0 versus workflow nav1, retaining full label bounds. No product or timeout changes addressed that helper bug. See browser-first/ and browser-geometry-323/.

An earlier broad627-case run had626pass/1 obsolete Contents locale expectation; the corrected focused reruns pass. This is not a claim that all627 were rerun. Canonical Markdown/report headings/body, user/model content, API enums and internal prompts remain raw. UI contents controls/actions/status/errors follow locale. Localized shortcuts prefill editable drafts without auto-send or overwriting an edited draft; editable plan/chapter defaults localize only at creation.

The real lane uses login/API/PostgreSQL and the existing deterministic model fixture. Report-file wrappers and controlled ASR events have component evidence; actual native Skill conversion bytes and external ASR/model providers retain their separate lanes. Prototype-only topic focus/autosave is supporting component evidence, not actual persisted import-route acceptance.

Source CI follow-up:5a3825bfb failed lint-ui-wiring because the extracted pure ASR text table imported a type from the live adapter. The correction references the identical contract schema directly. It changes only erased type imports/annotation; TypeScript ES2022/ESNext transpileModule output is byte-for-byte identical to5a. Existing final browser behavior evidence therefore has unchanged runtime code; the new source still requires fresh CI. The route manifest/scanner remain unchanged. See ci-control-plane-red.txt and the subsequent correction receipts.

Second source-CI correction: the later real-repository testid gate could not resolve the dynamic history report anchor. Spec now scopes the unique article inside research-report-history and asserts count1, preserving both raw-title assertions across locale changes. No product/gate/absence/timeout change. Exact gate35/35 passes6.56s, scoped specESLint0, isolated discovery1test/1file3s/cleanup0; source products equal69f. Fresh sourceCI and browser remain required; no new local browser claimed. Interview WIP saved in stashd429b8076eaee03937b49487fcd7cc689f9f088c, superseding earlier66ae WIP for restore.
