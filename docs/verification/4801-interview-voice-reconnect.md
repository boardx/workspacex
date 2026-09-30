# Interview voice reconnect — issue #4801

## Scope and behavior

User-approved bounded fix, based on main `4518a6fcdd217f6094fdc3bbcebfa251afbdda16`.
Interview input opts into the existing bounded reconnect policy; chat does not.
Temporary provider/transport errors retry at 1/2/4/8/8 seconds, pause offline,
and retain confirmed text without replaying interim text. Stable connections reset
the retry budget after 30 seconds; short repeated failures do not.
Stopping, cancelling and unmounting cancel recovery. Startup cancellation closes
the socket and releases late microphone acquisition; after acquisition, cancellation
is detached so established streams still flush their tail through `stop()`.
Configuration, format and microphone permission failures do not auto-retry.
Exhaustion offers manual reconnect, explicit retention or discard of confirmed text.
The UI warns that disconnected audio may be missing; it does not claim lossless recovery.

## Verification

- RED: initial reconnect tests failed on absent recovery, stop/cancel during backoff
  and retry exhaustion (4 failures); the new UI recovery test failed on absent status.
- RED: pending-startup abort test failed with socket state 1 instead of 3.
- Independent review found startup abort could interrupt established-stream tail flush.
  Added regression first: RED socket state 3 instead of 1; detached the startup listener
  after capture initialization. Independent re-review: ACCEPT, no remaining findings.
- `pnpm --filter web test tests/lib/asr-draft-reconnect.test.tsx tests/lib/asr-draft-start-lifecycle.test.ts tests/lib/asr-draft-cleanup.test.ts tests/ui/interview-voice-input.test.tsx tests/ui/use-asr-draft-error-reason.test.tsx tests/lib/use-asr-draft-sanitize.test.ts`
  — 6 files, 45 tests passed, exit 0.
- `pnpm --filter web typecheck` — exit 0.
- `pnpm --filter web lint` — exit 0, including design/token checks.

## Boundaries and handoff

Full web suite: `pnpm --filter web exec vitest run --maxWorkers=2 --minWorkers=1`
on this worktree's default Node 22.14.0 returned exit 1: 764 files passed / 1 failed;
6418 tests passed / 8 failed / 5 skipped. All eight failures are in the unchanged
`tests/whiteboard/board-content-tools.test.tsx`: durable image creation, retaining
shared image assets, clipboard paste, file drop, HTTPS image validation, JPEG/GIF/WEBP
verification and SVG sanitization, image rehydration, and upload-failure handling.
The explicit error is Node SubtleCrypto rejecting a cross-realm buffer argument.
The primary checkout using Node 22.21.0 passed that file (29/29). Re-running the
same file on this branch with the existing Node 22.21.0 binary also passed 29/29:
`/Users/shenyangjun/.nvm/versions/node/v22.21.0/bin/node node_modules/vitest/vitest.mjs run tests/whiteboard/board-content-tools.test.tsx --maxWorkers=1 --minWorkers=1`
(cwd apps/web), exit 0. No whiteboard code, test or dependency was changed.
This is not a claim that the full suite was rerun green under Node 22.21.0.
No production restart, deployment or real-provider outage drill was performed.
Transport tests inject sockets/capture, UI tests inject the streaming boundary and
exercise the real hook/composer/interview components. These do not prove the upstream
provider was restarting in the user screenshot.
No gateway calls or production settings were changed. No new worktree or Docker stack
was created. Existing unrelated untracked payment files in the primary checkout remain
untouched. Next: commit/push, create PR against main, follow CI/review.
