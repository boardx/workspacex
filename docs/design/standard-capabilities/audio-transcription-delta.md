# W14 audio transcription delta — implementation boundaries; evidence linked separately

## Existing runtime facts

`application/recording/asr-ports.ts` defines the actual AsrProviderPort: configured/open, PCM frames, commit/finish/abort, final text and optional confidence. `ConfiguredRealtimeAsrProvider` is the single actual vendor WebSocket adapter. It does not expose timestamp, diarization or language-selection parameters. Reusing it must not invent those capabilities. Existing personal recording transcripts have their own capture lifecycle; an uploaded attachment is not an active personal recording capture.

`NativeRunInputs.read` already reauthorizes the server-derived run actor against current organization/thread visibility and returns digest-verified original bytes. The native owner holds the immutable input manifest. The new adapter must match both before any remote ASR call, and again before confirming a result. Models supply attachmentId only, never storage URL, user identity or vendor configuration. Current ToolExecutionAuthority controls the real arguments and actual toolCallId; local-only organizations cannot send recordings externally.

## Proposed bounded vertical slice

Input preserves catalog `attachmentId`, optional `language`, optional `diarization`. Initially reject explicit diarization and unsupported language selection instead of ignoring them. The original WAV-only increment used Python wave. The current consumer uses the installed fixed FFmpeg adapter for authorized WAV/MP3 up to 60 minutes, retaining the shared 8MiB original-file limit. Invalid, empty, silent and unsupported-format input must be distinguished from successful transcription. FFmpeg is installed at build time; no runtime network installation is allowed.

Source audio is divided at actual sample offsets into at most 30-second PCM chunks. One existing ASR session per chunk aggregates its actual final text. Segment startMs/endMs describe the complete source chunk, explicitly not provider word/utterance alignment. Unknown speakers remain absent. Empty final text does not invent speech. Every session is aborted on timeout, owner cancellation or provider error. Streaming frame sizes and audio format must reuse existing recording contracts.

Output uses workspacePath, sha256, sourceHash, segments and warnings so the existing artifact publisher can create a real deliverable. It does not return a transcriptId or fabricate a personal recording entity. The accepted catalog delta must record this output adjustment. Final artifact identity comes only from the existing staged/writeback path. Durable intent is fixed by trusted organization/run/source hash plus normalized parameters, persisted before the first provider operation. Same source/arguments replay returns identical transcript bytes and hash; an incomplete intent is unknown outcome and does not automatically send audio again. New object prefixes have no proven automatic GC and require integration with the existing retention policy.

## Current long-audio consumer

The fixed FFmpeg decoder and packaged image are independently verified under the existing sandbox isolation. It emits 30-second PCM chunks, then the service serializes session file reads (the existing session API is exclusive) while at most four existing manual ASR sessions run concurrently. Results are indexed by source chunk order. A failed chunk aborts peers and prevents a completed receipt; a persisted unknown intent is not resubmitted. The whole tool has a 240-second deadline. Slow upstream execution fails explicitly rather than extending the parent run deadline.

Supported file formats are WAV and MP3, not arbitrary codecs. Forced language and diarization remain explicit unsupported modes. Empty individual chunks remain empty and receive a warning; all-empty confirmed results are marked separately. No names or word timestamps are invented. The fixed decoder/Docker evidence is `evidence/W14/audio-ffmpeg/`; long-audio consumer evidence is `evidence/W14/audio-long/`.

## Skills

S016 audio-transcription will guide original selection, supported-mode checking, actual ASR tool, transcript review and artifact publication. S009 meeting-minutes consumes an existing transcript up to 60 minutes and records decisions/action items with source segment references, distinguishing suggestions from decisions and unknown owners from facts. Neither package claims a second ASR implementation, autonomous task creation or external sharing. Source packages must be read at fixed upstream revisions with adjacent license retained before adaptation.

## Required verification

Real existing WS adapter against deterministic local upstream; actual WAV bytes decoded in the bound sandbox; current attachment ACL and changed membership denial; silence/corruption/unsupported mode rejection; source chunk offsets derived from sample counts; intent before provider call; replay/no duplicate transcript; late cancellation denies success; final JSON/Markdown bytes through existing publication/writeback. This fixture evidence is distinct from actual external ASR accuracy and G-SKILL.

## Provider final identity compatibility

Before this increment the parser dropped upstream item_id/event_id (recorded failing assertion). The adapter now preserves these as optional fields in the existing transcript port; all current consumers remain compatible. The file adapter replaces revisions sharing an item identity, ignores a repeated event identity, and never deduplicates by text (real speech may repeat). Multiple finals without stable item identity fail explicitly instead of silently guessing whether they are revisions or additional speech. Partial snapshots never enter final text.

## Official manual completion protocol

[Official client events](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-asr-realtime-client-events) specify explicit turn_detection:null for manual mode and session.finish/session.finished for terminal completion. The file-only optional manual branch issues one commit per source chunk then session.finish, waiting for session.finished rather than the first transcription final. Existing realtime clients retain the default VAD behavior. A server-confirmed silent session may contain no transcription final; a timeout without session.finished is failure.

## Actual upload prerequisite discovered by integration

The first native integration attempt failed before ASR: actual uploadAttachment rejected audio/wav because the existing chat-file-upload ATTACHMENT_MIME_ALLOWLIST has no audio entries. No direct database insert is accepted as a substitute for the user upload path. The minimal correction is the shared MIME allowlist plus its existing byte-family sniffer (RIFF/WAVE), with forged binary/WebP rejection. Ordinary attachment text extraction remains unsupported for audio, avoiding automatic external ASR calls outside the authorized tool. Frontend upload types derive from the same allowlist.
