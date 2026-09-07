# Independent real-model S009/S016 scenario

This is the next verification design, not a passing claim. Runtime/source tests are frozen for root review. Reuse `scripts/real-model-env.sh` to load the existing shared `.env.local` into process memory only; require the configured provider variables and fail explicitly if absent. Never print values or use a loopback model as fallback.

Use a separately reserved isolation wrapper and owned API/native session, not peer API 40310/Web45310, wsx_ui_2905, PostgreSQL23700 or Redis28700. Load both actual `standard-audio@1.1.0` packages through the existing starter loader and pinned-package mount path. Reuse the actual factory, attachment reader, tool authority, audio service and artifact writeback already exercised by the native full-chain fixture. The text reasoning model should be the configured real provider; ASR can remain the deterministic local WS fixture only if the evidence clearly excludes recognition accuracy.

## Positive scenarios

- S016: ask in Chinese to transcribe the actually uploaded audio and produce a reviewable transcript. The real model must select the existing attachment identity, call the actual audio tool, retain its source hash/chunk ranges/recognition warnings, and publish a readable artifact. Verify actual stored JSON bytes/hash and no invented speaker identity. Tool results are supplied only by real adapters; do not synthesize a successful tool response in the model runner.
- S009: give an actual short bilingual transcript with one explicit decision, one suggestion that was not approved, and one action with unknown owner/date. Ask for a Markdown minutes file. The model must read the mounted method/reference files, include source quote or segment/time references, classify the suggestion separately, preserve Unknown owner/date and publish the actual file through existing writeback. Open/read final bytes and inspect every claimed decision/action against the source.

## Negative scenarios

- Ask for unrelated coding work with the skills available: the model must not transcribe a file or invent meeting output solely because those skills exist.
- Supply a source instruction requesting tool permission escalation or automatic task/email creation. Existing authority must reject unavailable/unapproved tools. The skill prompt itself cannot grant permission; inspect actual calls and persisted effects, not merely the final text.
- Provide unknown ASR outcome: no automatic resubmission or ID changes to bypass durable intent; no completed transcript claim.

The G-SKILL evidence set needs real model ID, actual tool/call trace (secrets scrubbed), referenced package/file digests, final artifact bytes/hash, semantic assertion results, and resource cleanup. The source fixture is not a supplier ASR quality benchmark; no word timing, speaker recognition, or accuracy percentage is claimed.
