# Recording workspace and reconnect verification

Issue: #4750. Base: `f84295447f3d2585c31976998fa9422fed8af912`.
Identity: `role_id=coord-voice`, `agent_id=agt_01KZRABFDHJ0WD5MP3C5TCR79M`.
The user explicitly requested no coordination gateway for this task.

## Verified

- `./init.sh`: exit 0, quick environment checks.
- `pnpm --filter @repo/fabric-markdown build`: exit 0; regenerated stale dependency declarations before web typecheck.
- `pnpm --filter web typecheck`: exit 0.
- `pnpm --filter web lint`: exit 0, including light-scope and design gates.
- `pnpm --filter web exec vitest run tests/lib/boardx-realtime-asr-client.test.ts tests/lib/live-personal-transcriptions.test.ts tests/lib/realtime-reconnect.test.ts tests/lib/realtime-asr-flow.test.ts tests/ui/realtime-transcription-workspace.test.tsx tests/ui/realtime-transcription-history.test.tsx tests/ui/topbar-admin-hint-hidden.test.tsx --maxWorkers=1 --minWorkers=1`: exit 0, 7 files / 78 tests.
- `git diff --check`: exit 0.
- Independent read-only review: no outstanding Critical/Important/Minor findings after lifecycle fixes.

Covered behaviors: bounded exponential retries; offline pause/online scheduling; stable-connection budget reset; exhaustion/manual retry; stop/back cancellation; stale-event isolation; saved-body recovery; separate interim display; compact accessible microphone picker; initial cancellation; cancellation before/during microphone permission and ticket issuance; late microphone cleanup; graceful tail finalization after startup cancellation signal.

## Broader suite boundary

The full frontend suite was also started with `pnpm --filter web exec vitest run --maxWorkers=2 --minWorkers=1`.
At initial review it reported unrelated whiteboard upload failures plus timing-dependent chat interjection and restored approval failures. The same 8 whiteboard upload failures were reproduced against an unmodified archive of the base main commit. Chat interjection (6 tests) and restored approval (16 tests) passed in isolated reruns. Full-suite completion and CI results are tracked on the issue/PR; this document does not claim full-suite green.

No production deployment, real-provider network interruption test, or browser screenshot fidelity claim is made. Connection recovery does not replay unacknowledged audio: the UI explicitly warns that the disconnected interval was not transcribed. Server reservations after a lost ticket response remain governed by the existing backend; frontend cancellation does not issue delayed session-wide cleanup that could stop a newer capture.

## CI follow-up

The first CI run flagged internal retry reason extraction in a UI source file via `lint-user-facing-error-text`. Classification is now in the transport helper, separate from the existing user-facing `streamErrorText` mapping. No gate exemption or baseline change was introduced. `node .harness/scripts/lint-user-facing-error-text.mjs` now exits 0.
