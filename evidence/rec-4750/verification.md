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

No production deployment, real-provider network interruption test, or browser screenshot fidelity claim is made. Connection recovery does not replay unacknowledged audio: the UI explicitly warns that the disconnected interval was not transcribed. Cancellation retains late ticket responses and issues capture-scoped cleanup, never delayed session-wide cleanup that could stop a newer capture. A completely lost ticket response cannot identify its capture and remains a backend expiry/reconciliation limitation.

## CI follow-up

The first CI run flagged internal retry reason extraction in a UI source file via `lint-user-facing-error-text`. Classification is now in the transport helper, separate from the existing user-facing `streamErrorText` mapping. No gate exemption or baseline change was introduced. `node .harness/scripts/lint-user-facing-error-text.mjs` now exits 0.

## P1 review follow-up — cancellation reservations

- RED: delayed ticket response after cancellation did not release its capture; the new assertion failed with `[]` instead of `[late]`.
- Retain the ticket POST response on local cancellation and release the returned capture ID. The existing stop contract accepts optional captureId; SQL scopes by tenant, owner, transcription and capture, and preserves recording status while another active capture exists. Legacy unscoped stop remains compatible.
- Database verification: isolated management and owner-boundary suites passed 6/6, including release canceled capture → start new capture → repeat old cleanup → new capture remains active/recording. The isolation wrapper released its owned stack.
- Contract verification: personal-realtime-transcription suite passed 8/8. API and web lint passed.
- Independent review caught blocking cancellation on a stalled cleanup POST. RED: provider cancellation with never-settling cleanup timed out after 15 seconds. Canceled startup now dispatches capture-scoped cleanup without waiting; noncancellation startup failures retain awaited recovery.
- Cleanup waits also observe cancellation after cleanup starts, while preserving the original startup error. Final transport suite: 25/25 passed; broader affected suite: 78/78 passed before this additional regression. Final API/web typecheck passed. Independent rereview: ACCEPT, no remaining Critical/Important findings.
