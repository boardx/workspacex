# Interview feedback — issue #3745

User approved four bounded corrections on 2026-09-19: hide unbound material metadata; accurate history expert counts; readable Skill expert proposals; confirmation before regeneration.

## Implemented

- History reads selected, completed runs only from the current revision, preserving tenant and actor visibility.
- Expert details/catalog suppress the material section without a bound context pack; bound metadata remains available.
- Structured assistant messages/proposals resolve expert roles and descriptions; active proposals show additions/removals relative to the current draft. Historical unknown IDs get an unavailable label instead of an internal identifier.
- Topic/expert/question/report repeat actions require confirmation describing downstream replacement. Cancel preserves drafts without API writes; a synchronous lock prevents duplicate submission.
- Report regeneration previously rejected completed rows. A new request with the current aggregate version can now regenerate; in-flight rows and stale versions are still rejected.

## Validation

- Init quick health check passed using Node 22.21.0.
- UI red tests reproduced unbound metadata, raw JSON and absent confirmations before implementation.
- DB-backed count test failed at 0 vs 1 before implementation; report regeneration test reproduced CONCURRENT_MODIFICATION before implementation.
- Web/API typecheck passed.
- All API interview tests: 463 passed in 46.43s, isolated database wsx_itv_feedback.
- Targeted UI tests: 46 passed before the additional report cancellation test.
- Web/API lint and the design gate passed.
- Independent review found no actionable P1/P2, including completed-report regeneration concurrency and revision isolation.
- Full web suite: 465 files passed; 4085 tests passed, 5 skipped (existing), exit 0 in 377.51s.
- Report cancellation targeted suite: 4 tests passed.
- Pre-push dependency builds, affected typechecks/lint and design gates passed.

## Operational boundary

No production data or deployment changed. No Docker stack was started. Coordination tick cannot register a lease because COORD_GATEWAY_URL is not configured; no identity or lease was invented. This is a user-directed ad-hoc issue, outside the readiness queue.
