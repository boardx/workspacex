# Recording endpointing — issue #3741

User-directed optimization: reduce fragmented punctuation without buffering interim text or rewriting transcript words. The default 400 ms server VAD is shared with short chat dictation; personal recording now requests an independent 800 ms profile. This adds 400 ms to the default silence decision window, not to application interim delivery. Model/audio framing, final persistence-before-publish, and explicit stop commit are unchanged.

`KERNEL_ASR_RECORDING_TURN_SILENCE_MS` accepts integers 200–2000 ms, default 800 for absent/invalid values. `KERNEL_ASR_TURN_SILENCE_MS` still controls ordinary/chat sessions; it no longer tunes personal recording. Set the new variable to 400 to restore its old endpointing value. Manual file transcription still disables VAD. No production config was changed.

The profile only affects upstream services honoring `silence_duration_ms`. Local Sherpa gateway uses its own endpoint rules; no claimed quality improvement there. No existing saved transcript is rewritten. No personal audio or text is published.

Validation: ./init.sh passed; red tests reproduced 3 failures (provider recording default/override and gateway profile). Green: 48 tests across 6 ASR provider/gateway/manual/local-compat files; API lint/typecheck passed. Fixed an existing test's zero-timeout socket-close race by waiting for its abort condition. See verification.txt.

Real-provider comparison NOT RUN: all four KERNEL_ASR configuration keys are MISSING in this execution environment. Synthetic tests verify immediate interim delivery, verbatim final punctuation/numbers, stop-tail handling, profile isolation, and bounded overrides; they do not establish acoustic accuracy or punctuation-quality gains. Actual deployment and 400/800 ms audio comparison remain acceptance boundaries.

Coordination: readiness read; direct user bugfix outside queue recorded in issue. Existing requested identity loaded from local credentials but gateway status/tick both failed with network errors; no lease claimed and no coordinator ownership asserted. Work is isolated on codex/recording-punctuation.
