# W14 audio — verified WAV vertical slice, long audio outstanding

This is a verified bounded component, not a completed full audio capability claim. Initial implementation supports PCM16 mono16k WAV up to120 seconds. Compressed formats and 60-minute audio remain outstanding. No new transcript entity or ASR vendor client is created.

## Actual results so far

- `identity-red.txt`: direct parser assertion failed (`undefined` versus upstream item-1), then the same assertion passed after optional identity projection.
- `protocol-first-tests.txt`: standard isolation wrapper,21/21 passed including original realtime provider11, parser6, manual terminal1 and collector3.
- `service-tests.txt`: later standard wrapper26/26 passed including service4, existing provider/parser, collector and manual early-close rejection.
- `upload-blocked-chain.txt`: production DI/service/manual7/7 passed. Complete native chain **failed** at actual uploadAttachment with FILE_TYPE_REJECTED for audio/wav. It never reached ASR; no false passing evidence. Wrapper cleanup completed. A true upload allowlist/sniffer change is required; directly inserting an attachment would hide the product gap.
- `python.txt`:5/5 thin trusted callback tests passed.
- `contracts.txt`:2/2 input/output identity tests passed.
- `skill-package.txt`: both four-file S009/S016 packages loaded through the existing FileSkillStarterPackSource; tampering refused. This is not G-SKILL or external ASR accuracy evidence.

`wav-live-tests.txt`: final6 API files41/41 and actual native fullchain1/1 passed, exit0. This includes normalized default replay, silence, manual terminal/early close and the real upload allowlist/sniffer regression. Actual production DI had already passed1/1 in upload-blocked-chain.txt. First failing upload evidence is retained.

## Commands

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/recording/configured-realtime-asr-events.test.ts tests/recording/configured-realtime-asr-provider.test.ts tests/recording/file-asr-manual.test.ts tests/agent-runtime/audio-final-collector.test.ts tests/agent-runtime/standard-audio-tools.test.ts

WX_NATIVE_SANDBOX_CONTAINER=wx-audio-tool-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-audio-tools.test.ts tests/agent-runtime/audio-production-di.test.ts tests/recording/file-asr-manual.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'

PYTHONPATH=apps/deep-agent-service/src apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_audio_tools.py -q
pnpm --filter @repo/contracts exec vitest run tests/standard-audio-tools.test.ts
pnpm exec tsx skills/standard-audio/scripts/build.ts
pnpm exec tsx skills/standard-audio/scripts/verify.ts
```

The independently owned wx-audio-tool sandbox uses existing workspacex-skill-sandbox:w08-ocr image. No image dependency or security budget changed. All database wrappers and the independently owned sandbox have now been cleaned up; docker compose down --volumes completed.

## Sources

- OpenAI transcribe49f948faa9258a0c61caceaf225e179651397431, Apache-2.0; exact source metadata retained.
- GitHub awesome-copilot meeting-minutes87ba8b1780d0e2655fc19fa3f8d4fc7879881744, MIT; exact source metadata retained.
- Official ASR manual/session.finished protocol linked in audio-transcription-delta.md. The real WebSocket tests use a deterministic local upstream; no paid ASR accuracy claim.

## Pending integration and limits

Actual upload→readonly original→standard wave decoder→existing ASR→native tool→artifact publication/writeback passed. The real WS upstream received PCM bytes equal to the original WAV payload; persisted transcript bytes match the actual returned SHA256. Four artifacts/attachments exist after writeback. Replay makes no second vendor submission; foreign organization, revoked organization membership and private-thread owner change are rejected. Real sandbox decoding rejects damaged non-audio bytes and a wrong source hash. The audio fixture is a one-second generated tone and the WS fixture emits deterministic bilingual text: this proves protocol/integration, not recognition accuracy. New audio-transcription object prefix has no demonstrated automated GC; unreferenced objects await integration with retention policy. Speaker identification, word timestamps, forced-language configuration and60-minute recording support are not claimed.


## Final WAV command

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-audio-tool-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/chat/attachment-mime-sniff.test.ts tests/chat/attachment-upload-domain.test.ts tests/chat/attachment-upload.test.ts tests/chat/attachment-extraction-domain.test.ts tests/agent-runtime/standard-audio-tools.test.ts tests/recording/file-asr-manual.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
```

## WAV worker-owned manifest

- packages/contracts/src/standard-audio-tools.ts
- packages/contracts/scripts/generate-standard-audio-schema.ts
- packages/contracts/tests/standard-audio-tools.test.ts
- packages/contracts/src/chat-file-upload.ts (WAV MIME aliases only)
- apps/api/src/domain/chat/attachment-mime-sniff.ts (RIFF/WAVE family only)
- apps/api/src/application/recording/asr-ports.ts (optional upstream IDs/modelRef/manual options)
- apps/api/src/infrastructure/recording/configured-realtime-asr-provider.ts (compatible IDs and file-only manual terminal branch)
- apps/api/src/application/agent-run/standard-audio-tools.ts
- apps/api/src/application/agent-run/audio-final-collector.ts
- apps/api/src/infrastructure/agent-run/standard-audio-service.ts
- apps/api/src/infrastructure/agent-run/audio-wav-decoder.ts
- apps/api/src/infrastructure/agent-run/audio-asr-chunk.ts
- apps/api/src/interface/controllers/standard-audio.controller.ts
- apps/deep-agent-service/src/deep_agent_service/standard_audio_tools.py
- apps/deep-agent-service/src/deep_agent_service/generated/standard_audio_schema.json
- apps/deep-agent-service/tests/test_standard_audio_tools.py
- apps/api/tests/agent-runtime/{standard-audio-tools,audio-production-di,audio-final-collector,native-full-chain}.test.ts
- apps/api/tests/recording/{configured-realtime-asr-events,file-asr-manual}.test.ts
- apps/api/tests/chat/{attachment-mime-sniff,attachment-extraction-domain}.test.ts
- apps/deep-agent-service/tests/native_full_chain_runner.py
- apps/api/tests/fixtures/audio/source.wav
- skills/standard-audio/ (two complete4-file skills and build/verify scripts)
- skills/starter-packs/standard-audio/1.0.0.json
- docs/design/standard-capabilities/audio-transcription-delta.md
- docs/design/standard-capabilities/capability-catalog.json (T037 output identity correction only)
- docs/design/standard-capabilities/evidence/W14/audio/

Root-owned kernel/factory/profile/noRetry registration and future seed are separate shared-file integration. No git operation was performed. No Docker image change belongs to this WAV increment.
