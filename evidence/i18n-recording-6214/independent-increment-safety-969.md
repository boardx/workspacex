# Recording 6214 limited integration, spec and safety review

Reviewer: /root/review_github_import_6194 (reused independent reviewer).
This file archives the reviewer's returned findings. No test, type, lint, init, browser or service was run for this review.

## Exact scope

- Prior full recording source review: 2dfcf827d84bc8992c830a615643b4aacb548064 -> 026d8dcac5c044fcafa8b5c33a5d633b346223b6: STATIC CLEAN, no actionable P1/P2.
- This limited integration: e953145fdc228977c09122ba8b985213cd13aadd -> c54c30396 (normal merge of published develop 3644ae2c8213770614866c1c39ac4df2b8920c05).
- Selector/spec increment: c54 -> bf6e0b4e69bed566c51e657ce98df638521ecf2c.
- Safety reconstruction: c54 -> 625ec8e3557e1292097f2d559aa94a095c44fc0f -> 969bfd76f8affc0bbb679eecbfd69b0f374f743e. The immediate parent of 969 is 625e, not c54.

## Integration and spec: STATIC CLEAN

No actionable P1/P2 in the integration or E2E selector increment. e953 product bytes equal reviewed 026; normal merge preserves 466 worker and 33 upstream nonoverlapping blob/mode entries. Registration preserves 81 spec literals as a multiset.

The default microphone is selected by role=option plus exact current-language system-default accessible name, distinct from the native Fake Default Audio Input. Assertions additionally preserve the native option's aria-selected=false and the trigger's empty canonical selected-device ID. Original PCM, WS, stop, raw transcript, edit, persistence and deletion guards remain; original 180/120-second budgets and retry=0 remain. No shared Mic runtime or test hook changed in this increment.

The stored 2767-key dictionary dynamic-evaluation proof was read, not rerun as a fresh validation command.

## Original evidence finding on bf6: P1

browser-first/trace.zip / 0-trace.network line 46 onward contained actual Authorization/Bearer values (boolean confirmation only; no values copied). The raw trace, original command and original error context must stay private. Field-name/source-code references alone were not classified as actual credentials.

## New exact 969: P1 ADDRESSED, limited new-history/text evidence STATIC CLEAN

- Both unsafe dda94af and bf6e0b4 are not ancestors.
- Independent inspection of 107902 reachable objects found all five distinct original sensitive blobs unreachable; proof OIDs match actual old objects.
- apps/ and packages/ are byte-equivalent to reviewed bf6.
- Neither of the two new commits includes original trace, command or context files.
- Twelve new text files contain no detected actual Bearer/JWT values.

This clears the reported P1 for the new unpublished chain, not arbitrary published repository history. An inherited older kg trace in published ancestry was not content-audited; published 2df/3644 history must not be rewritten for this scope.

Six PNGs were not independently viewed by this reviewer. Their QA attribution remains the author; do not claim independent full-image safety acceptance. Remote 404 and private directory/file permissions were not independently rechecked by the reviewer.

## Four published 6205 contexts: limited boolean scan

Exactly these four files at 2dfcf827d84bc8992c830a615643b4aacb548064 were scanned:
- evidence/i18n-interview-6206/browser-first/error-context.md
- evidence/i18n-interview-6206/browser-second/error-context.md
- evidence/i18n-interview-6206/browser-third/error-context.md
- evidence/i18n-research-6198/browser-geometry-323/error-context.md

Actual Bearer values=false, JWT values=false, explicit storage-credential assignments=false. The first two interview contexts contain storage source references, not detected credential values. This check does not justify resetting their validated candidate or rewriting published history.

## Unverified boundary

Current reconstructed-head type, lint, second real browser and CI are not verified by this static review. Historical 206/25, prior 208, or the first failed browser do not substitute for current acceptance. Static source CLEAN and P1 ADDRESSED are not READY_TO_MERGE.
