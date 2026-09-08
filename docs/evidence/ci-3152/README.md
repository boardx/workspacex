# CI lane deduplication evidence (#3152)

User authorized CI strategy implementation and explicitly waived agent identity bootstrap for this task.

The observed duplicate dispatches #5212/#5213 checked the same commit and same lanes. #5215 requested a different scorecard but repeated smoke.

This change serializes identical non-PR SHA/lane jobs, then reuses an actually executed producer with retained artifacts for up to 24 hours. Different lanes remain independent. Source PR runs are excluded because their head SHA differs from the checkout merge SHA. Newer failed/incomplete attempts invalidate older successes. Failed producer verdicts remain failures. `fresh_run` and native reruns request independent measurements. Queue capacity is 100; this does not add runner capacity.

Validation:
- `./init.sh`: passed in isolated worktree.
- `pnpm run verify:harness:raw`: 84 files, 974 tests passed; see harness-validation.log.
- Final dedup regression suite: see dedup-tests.log (includes follow-up review corrections).
- Independent review found and verified fixes for newer-failure fallback and PR merge-SHA reuse; no remaining false-green blocker.

Live duplicate-dispatch evidence will be added after branch validation. No branch rules or production deployment were changed by this patch.

Live follow-up: producer 34256842458 executed smoke and uploaded non-expired artifact 10068559343. Duplicate 34256866540 was canceled by the GitHub account before receiving a runner (annotation saved by the reviewer). This exposed an overly conservative invalidation: an unstarted canceled request is not a new measurement. The resolver now ignores only an explicit runner_id=0 plus empty steps cancellation; unknown runner metadata and in-flight cancellation still invalidate reuse. A real API probe using patched resolver returned producer 34256842458/success for the repeated request. Full workflow reuse remains to be reconfirmed at the final revision.
