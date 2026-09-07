# W14 audio transcription delta — design, not delivery evidence

## Existing runtime facts

`application/recording/asr-ports.ts` defines the actual AsrProviderPort: configured/open, PCM frames, commit/finish/abort, final text and optional confidence. `ConfiguredRealtimeAsrProvider` is the single actual vendor WebSocket adapter. It does not expose timestamp, diarization or language-selection parameters. Reusing it must not invent those capabilities. Existing personal recording transcripts have their own capture lifecycle; an uploaded attachment is not an active personal recording capture.

`NativeRunInputs.read` already reauthorizes the server-derived run actor against current organization/thread visibility and returns digest-verified original bytes. The native owner holds the immutable input manifest. The new adapter must match both before any remote ASR call, and again before confirming a result. Models supply attachmentId only, never storage URL, user identity or vendor configuration. Current ToolExecutionAuthority controls the real arguments and actual toolCallId; local-only organizations cannot send recordings externally.

## Proposed bounded vertical slice

Input preserves catalog `attachmentId`, optional `language`, optional `diarization`. Initially reject explicit diarization and unsupported language selection instead of ignoring them. The first decoding path uses Python standard-library wave in the existing bound sandbox for PCM16, mono, 16kHz WAV, limited to 120 seconds and the shared 8MiB original-file limit. Invalid, empty, silent and unsupported-format input must be distinguished from successful transcription. No external dependency is required for this first path.

Source audio is divided at actual sample offsets into at most 30-second PCM chunks. One existing ASR session per chunk aggregates its actual final text. Segment startMs/endMs describe the complete source chunk, explicitly not provider word/utterance alignment. Unknown speakers remain absent. Empty final text does not invent speech. Every session is aborted on timeout, owner cancellation or provider error. Streaming frame sizes and audio format must reuse existing recording contracts.

Output uses workspacePath, sha256, sourceHash, segments and warnings so the existing artifact publisher can create a real deliverable. It does not return a transcriptId or fabricate a personal recording entity. The accepted catalog delta must record this output adjustment. Final artifact identity comes only from the existing staged/writeback path. Durable intent is fixed by trusted organization/run/source hash plus normalized parameters, persisted before the first provider operation. Same source/arguments replay returns identical transcript bytes and hash; an incomplete intent is unknown outcome and does not automatically send audio again. New object prefixes have no proven automatic GC and require integration with the existing retention policy.

## Next supported-format increment

The current sandbox Dockerfile does not install FFmpeg. Arbitrary authorized MP3/M4A and other compressed audio need maintained offline decoding, preferably fixed distro FFmpeg/ffprobe packages in the existing image, not a new ASR engine. This is within the authorized development scope and requires explicit codec/duration/decoded-size limits, exact package/license evidence, actual container tests and preservation of the current isolation and resource limits. Longer files also need bounded execution scheduling rather than pretending the first synchronous 120-second slice satisfies hour-long audio.

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
