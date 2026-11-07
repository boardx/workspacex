# Draft VAD stop handshake — #6323

The user reported recognized text followed by an error on `/research/new` when stopping voice input. Read-only CN gateway diagnostics at 2026-11-06T08:04:11Z and 08:04:41Z classified the error as `ASR_PROVIDER_UNAVAILABLE`, with committing/buffer/invalid keywords. No original transcript, audio, credentials or raw provider errors are included here.

The default provider VAD branch sent `input_audio_buffer.commit` and waited for another final. Recording/manual modes already had the explicit session completion handshake. The current Qwen-ASR protocol disables commit in VAD mode and requires `session.finish` followed by `session.finished`: https://www.alibabacloud.com/help/en/model-studio/qwen-asr-realtime-client-events .

Every provider mode now waits for the explicit session receipt; only manual mode commits before finishing. Prior text cannot prove that the tail finished. Missing acknowledgements, peer closes and actual provider errors still fail, preserving confirmed text for explicit recovery. The API contract and UI error handling are unchanged. Rates and accounting admission are unchanged.

The local ASR gateway previously rejected `session.finish` in VAD mode. It now flushes the current engine tail and acknowledges either mode; legacy local commit support remains. The empty legacy tests which treated prior text or an empty-buffer error as successful session completion were replaced with receipt-based success/failure cases.

## Red evidence

- New default-draft protocol regression failed before the implementation: `ASR_PROVIDER_UNAVAILABLE`, fixture rejects commit in VAD mode. After the change it preserves both delayed tail finals and the session receipt.
- The actual API-to-local-gateway compatibility test failed at stop after changing the provider alone. Two direct local-gateway tests then failed: no `session.finished` for silence, no final tail for 500 samples. Extending the local gateway made both direct and cross-adapter tests pass.

## Fresh verification

| Command | Observed result |
| --- | --- |
| `pnpm --filter @repo/api exec vitest run --config vitest.recording-protocol.config.ts` | 58 passed, 4 files |
| `pnpm --filter @repo/api exec vitest run --config vitest.usage-unit.config.ts tests/recording/file-asr-manual.test.ts tests/auth/asr-request-accounting.test.ts` | 20 passed, 2 files |
| `pnpm --filter @repo/api exec vitest run --config vitest.local-desktop-unit.config.ts tests/recording/local-asr-gateway-compat.test.ts` | 2 passed |
| `pnpm --filter @repo/local-asr-gateway exec vitest run` | 6 passed |
| `pnpm --filter web exec vitest run tests/lib/asr-draft-cleanup.test.ts tests/lib/asr-draft-reconnect.test.tsx tests/ui/interview-voice-input.test.tsx tests/ui/survey-inline-voice.test.tsx` | 43 passed, 4 files |
| `pnpm --filter @repo/api typecheck` | exit 0 |
| `pnpm --filter @repo/api lint` | exit 0 |
| `pnpm --filter @repo/local-asr-gateway typecheck` | exit 0 |
| `./init.sh` | quick path exit 0 |
| `git diff --check` | exit 0 |

These 129 passing tests include real local HTTP/WebSocket transports and in-memory/fake upstream models, not a real-model production acceptance. No Docker stack or extra worktree was created. The user's existing research draft was read without editing it.

## Release boundary

This code has not been deployed to CN/US. Production still runs its prior provider until the reviewed change is merged and released. Real browser acceptance must cover research and chat: speak, stop while a tail is pending, wait for idle, retain the final text, and verify no false provider error. Genuine loss of the completion receipt must retain the recovery UI. Local test success must not be described as recovered production speech.
