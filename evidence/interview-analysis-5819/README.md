# Interview analysis #5819

The generator now requests input-specific research design, concrete interview actions, falsifiable hypotheses and evidence limits. A shared CommonMark projection preserves nested sections and checks seven required sections with at least three substantive action list items. An incomplete completed candidate receives at most one correction; failed correction does not overwrite the saved document. Interrupted/partial generation semantics remain unchanged. Legacy documents show a regeneration entry rather than invented frontend advice.

## Verification

- Contracts: 74 tests passed (70 existing Markdown tests plus 4 analysis tests).
- API generation: 7 tests passed, including failed/paused/truncated correction.
- UI: 11 tests passed, including nested content and legacy missing guidance.
- Isolated API/PG: 23 passed, opt-in real model skipped; saved analysis survives unsuccessful regeneration.
- API standard lint and typecheck passed; contracts/web typecheck passed.
- Fullstack Playwright seeded test `contextual analysis advice survives persistence and responsive rendering`: 1 passed. Actual sanitized live output saved through authenticated API, rendered at 375/768/1280px without horizontal overflow, exact Markdown preserved after reload; legacy content exposes enabled regeneration. This renderer test does not call a model.
- Two explicitly authorized synthetic analysis-only real-model calls total, each one HTTP dispatch, both succeeded and persisted. Final receipt and unmodified sanitized output accompany this record. No customer interview modified. No PDF/Word calls.

## Interpretation and limits

Final output provides contextual timeline reconstruction, scenario separation, intention probes and environmental observations instead of the old empty suggestion notice. The first run informed stricter guidance about proposed recruitment parameters, self-report and causal inference. The final output correctly labels hypothetical answers as intentions and diaries as self-report, but some language remains overly strong (e.g. “证明” in success criteria and time windows not individually qualified). Additional semantic findings: retrospective CIT is described as unmodified real behavior; narrated environment is called objective; the success criteria preassign group drivers. After this review the final source prompt was tightened to forbid those descriptions and require comparable evidence rather than proof of preset drivers. This final prompt revision has deterministic checks but was NOT run against a real model again: the two-call budget is exhausted. The captured output remains unmodified. Structural checks do not prove research methodology or factual correctness; human review remains necessary. No claim that all future model output is semantically guaranteed. No deployment or merge performed by this worker.

Live receipts and outputs are scrubbed with the existing canonical scrub-file CLI. No credential values are included.
