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

## PR review follow-up

PR #3746 review identified that failed report regeneration could discard a completed report. The replacement now retains the authorized report snapshot (also in its completed command receipt) and restores its content and timestamp on streaming/provider, validation or finalization failure. Restoration is conditional on the attempt request ID and running state; the session is restored only while it still points at that report. Restored content is not published as a successful append-only stream. The browser reloads the preserved report and retains the failure notice.

Red/green: provider-failure retention and UI failure-notice tests failed before the change. Runtime suite 14 tests and setup/report UI 27 tests passed after restoration, including provider, validation and concurrent-version finalization failures. Browser fixture verification additionally passed for expert profiles, hidden unbound details, confirmation and no-write cancel; it used mocked API responses, not production data.

Observer follow-up: a failed replacement exposes both the restored completed report and failed attempt through the existing workflow contract. The projector emits an error before append-only checks, including for observing GET streams; clients reload the workflow, and page refresh retains the failure notice. Final targeted validation: UI 49 passed; API interview suite 464 passed; web/API typechecks passed. Independent re-review confirmed the observer issue is closed with no further P1/P2. Full web baseline above predates this follow-up; related tests were rerun rather than claiming that baseline covers subsequent edits.

## Process termination recovery

A second review identified that catch-based restoration alone cannot protect a completed report when the worker process exits. A nullable `previous_report` JSONB column now stores the last completed report atomically before replacement clears its working fields. It remains durable until replacement succeeds or ordinary failure restores it. Five minutes without durable progress projects a failed attempt and the preserved report; an explicit retry must use a new request ID. Progress and completion verify request ownership and freshness under row locks, so a delayed old attempt cannot modify a replacement. GET observation keys include status and request identity; cross-attempt/incompatible projections emit an error and terminate for client reload.

DB regression simulates a suspended worker without invoking its catch handler, verifies durable content, rejects early/same-ID takeover, retries after timeout, preserves content even if recovery fails, and rejects old delayed writes. Observer regression covers timeout with an unchanged timestamp; projector regression covers takeover directly to running or completed. Independent review found no remaining P1/P2. This requires applying the additive migration before application rollout.

Final process-termination follow-up validation: clean isolated DB suite 65 files / 466 tests passed, exit 0 in 69.88s; API typecheck passed. No frontend implementation changed in this follow-up.

History recovery follow-up: automated review found that stale-report recovery projected completed only in detail, leaving history and its filters pending. `DIGITAL_INTERVIEW_READ_STATUS_SQL` now supplies the same current-revision recovery state to visible item reads, history projections, history filters and workflow detail. Regression first reproduced report_pending vs completed, then passed all 24 runtime/controller tests including completed-filter inclusion and pending-filter exclusion.
