# Long audio consumer — isolated source verification complete; G-SKILL remains separate

The consumer uses the fixed, verified FFmpeg image and the existing ASR provider. It supports WAV/MP3 up to 60 minutes within the unchanged 8MiB original-file limit; other codecs, forced language, speaker identification, and calibrated confidence are not claimed.

## Dynamic evidence

- `first-service-tests.txt`: seven initial service tests passed, including 120 chunks, bounded concurrent ASR, stable order, no duplicate submission, and failed-peer cancellation.
- `first-real-failure.txt`: the actual full chain exposed exclusive sandbox file reads (`native_session_read_failed`). The existing session manager rejects concurrent file operations; the consumer now serializes reads while ASR remains concurrent. No sandbox lock or resource limit was weakened.
- `60min-fullchain.txt`: after that repair, real uploaded 7200369-byte MP3 → fixed readonly inputs → installed FFmpeg → 120 existing-provider WebSocket sessions / 115200000 PCM bytes → final JSON artifact writeback passed. Replay does not resubmit; foreign organization, removed membership and changed private-thread owner are rejected. Test duration 65.78 seconds, standard wrapper cleanup completed, peak DB connections five.
- `corruption-container.txt`: real damaged WAV and MP3 are rejected by the installed decoder; original bytes remain unchanged.
- `interrupted-overlap-not-acceptance.txt` is explicitly excluded from acceptance: the worker started before confirming the next DB slot. The owned wrapper was interrupted and its remaining owned PostgreSQL container removed with the wrapper's normal Compose down command. It also exposed two test defects (expecting exactly four concurrent sessions despite serial reads, and an omitted MP3 MIME specimen); both are corrected and covered by the final isolated regression below.

## Semantics and limits

Only ASR calls run concurrently, at most four. The parent tool deadline is 240 seconds. All chunks must complete before a receipt is persisted; incomplete intents are unknown outcomes and cannot trigger automatic resubmission. Empty chunks are preserved and warned explicitly. Timestamp ranges are source chunks, not recognized utterance or word alignment. The new prefix still has no independently verified automatic GC integration.

The 60-minute fixture is compressed silence and the local upstream supplies deterministic bilingual final text. This proves the actual adapter, transport, permissions and writeback chain, **not external ASR recognition accuracy or G-SKILL**. The complete S009/S016 `standard-audio@1.1.0` package uses the existing importer; `1.0.0.json` remains immutable. Final real-model representative scenario validation is separate.

## Ownership / review manifest

- `packages/contracts/src/standard-audio-tools.ts` (including decoder schema single source), generated `apps/deep-agent-service/src/deep_agent_service/generated/standard_audio_schema.json`.
- `apps/api/src/infrastructure/agent-run/{audio-wav-decoder,standard-audio-service}.ts`.
- `packages/contracts/src/chat-file-upload.ts`, existing `apps/api/src/domain/chat/attachment-mime-sniff.ts`.
- `apps/deep-agent-service/src/deep_agent_service/standard_audio_tools.py`.
- Audio service / MIME tests; `apps/api/tests/agent-runtime/native-full-chain.test.ts`; new `apps/skill-sandbox/tests/audio-corruption-container.mjs`.
- `skills/standard-audio/`, `skills/starter-packs/standard-audio/1.1.0.json`, audio delta and this evidence directory.

Dockerfile and installed decoder Python source remain frozen from the separately verified FFmpeg increment. No shared kernel/factory or parent-run lifecycle changes were made in this increment.

## Final isolated regression

`final-regressions.txt`: 32 API tests passed (audio service, MIME and actual upload, manual ASR protocol), followed by the old WAV real full chain 1/1. The run used the explicitly handed-off isolated DB slot and exited zero; wrapper cleanup completed in one second, peak connections three. New consumer tests include exclusive file-read enforcement, partial no-speech warning, and decoder failure before any ASR submission. `contracts.txt` has 2/2, `python.txt` 5/5, and the actual starter loader verified both four-file skills plus tamper rejection.

The `wx-audio-long` sandbox was removed with `down --volumes` after the final group. No self-owned database or build is left running.

Exact final command: `WX_NATIVE_SANDBOX_CONTAINER=wx-audio-long-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-audio-tools.test.ts tests/chat/attachment-mime-sniff.test.ts tests/chat/attachment-upload.test.ts tests/recording/file-asr-manual.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'`. The long variant uses `WX_AUDIO_LONG_FIXTURE=/private/tmp/w14-long-source.mp3` and the same actual native full-chain test. The fixture is generated by fixed FFmpeg with a seekable output so MP3 gapless metadata preserves exactly 3600 seconds.
