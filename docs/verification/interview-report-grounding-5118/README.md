# Report source grounding — issue #5118

Baseline: caf445c3c65eab8e614ea9ecd60cfaa112879f46. Implementation commit is recorded by this document's Git history. The unrelated return-entry change is PR #5270 and is excluded from this PR.

## Behavior

Saved executions now record server task/expert offsets and SHA256. Report citations bind document ID/version/hash, exact UTF16 range and complete verbatim line. Markdown role claims never determine identity. Legacy and unspanned gaps remain available for exact citation with unknown identity. The bounded repair/CAS/failure-preservation path remains.

The report view shows the exact saved quotation, answer version and trusted expert label, or an explicit unverifiable-source warning. Existing citation links target these quotations with scrolling and keyboard focus. This proves quotation/location, not that a quoted statement entails a synthesis, causal claim or frequency.

## Verification

- API exact-commit full unit: 48 passed; final targeted grounding/recovery: 26 passed, including negative consensus and mixed legacy/new spans. Logs `/tmp/wsx-5118-api-unit-exact.txt`, `/tmp/interview-5118-gaps-green.txt`.
- Real PostgreSQL execution/recovery/diagnostics: 27 passed. Controller: 22 passed on isolated rerun. The original four-suite attempt hit a 120-second controller bootstrap timeout; no timeout was changed. Logs `/tmp/interview-5118-db-final.txt`, `/tmp/interview-5118-controller-retry.txt`.
- Web source/report suites: 15 passed, including exact quote, pinned-version mismatch, unknown legacy identity, citation scroll/focus. Log `/tmp/wsx-5118-web-ui-final2.txt`.
- API final typecheck exit 0. Web typecheck/pre-push are checked again after the final commit; CI is authoritative for the exact PR tree.
- Local owned API/Next/PGlite at 15470/15460/15475, migration applied by the owner path. A synthetic fixture was written through the real execution store control/claim/finish and report validator/store: one trusted answer span, two exact references. No external model was called for this fixture. The fixture deliberately includes a conflicting body role claim and a counterexample.
- Browser rendered the saved report and both original quotes under the confirmed server expert label. Screenshot `synthetic-report.jpg`. Initial high-level clicks did not establish activation. After documented browser troubleshooting, ordinary native CDP mouse events successfully activated the same visible citation. DOM confirmed focus itv-source-answer-2, source top181, sticky header bottom165, with the exact server identity and quote. Screenshots citation-desktop.jpg and citation-mobile.jpg. Mobile390x844 also focused the same target at top285 with complete identity and quote visible. The target reuses the existing header-height variable for scroll clearance. This is real browser activation of a synthetic persisted fixture, not real-model report acceptance. No production acceptance or semantic PASS is claimed.

## Review and compatibility

Independent review found an omitted legacy-gap issue; it was fixed and regression tested. Final exact-SHA review/CI are required. Metadata fields are optional for reading old records; old strict compiled clients require the matching updated web/API. Apply the migration before the matching runtime update. No merge or deployment is authorized in this task.

Locator IDs are identifiers, not the ordinal of a displayed citation card. The fixture contains references `answer-2` (installation quote, first displayed card) and `answer-3` (counterexample, second displayed card); `answer-1` is an uncited body heading. `citation-dom.json` records the real rendered IDs, link text and positions. Do not infer a locator ID from screenshot order.
