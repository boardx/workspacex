# Accurate, smooth realtime transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personal realtime transcription feel natural and reliable by reducing avoidable capture-pipeline overhead, reporting where latency/backpressure occurs, and clearly distinguishing normal final confirmation from a slow delivery path—without changing the accuracy-oriented 800 ms server-VAD policy.

**Architecture:** Keep the existing PCM16/16 kHz/mono wire format and 80 ms network frame. Move frame aggregation from the main thread into the AudioWorklet so only transport-sized frames cross that boundary. Add a small, privacy-safe flow-observation port to the ASR provider/gateway, propagate its advisory state through the existing WebSocket contract, and derive the UI state from browser and upstream queues with hysteresis. Final transcript persistence remains the single `persistThenPublishFinal` path.

**Tech Stack:** TypeScript, React, AudioWorklet, browser WebSocket, Nest/`ws`, Zod contracts, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-realtime-transcription-accuracy-flow-design.md`

## Global Constraints

- Preserve `PCM_TARGET_SAMPLE_RATE = 16_000`, mono PCM16 LE, and an 80 ms (`2,560` byte) transport frame.
- Keep `KERNEL_ASR_RECORDING_TURN_SILENCE_MS` defaulting to 800 ms, with its existing 200–2,000 ms validation bounds. Do not lower it to chase perceived responsiveness.
- Do not persist or log PCM, interim/final text, API credentials, or upstream error bodies as latency telemetry.
- Do not add replay/retry audio buffering or publish a final transcript before its durable append succeeds.
- Advisory slow state must recover automatically; the existing bounded terminal `AUDIO_BACKPRESSURE` safeguards stay in place.
- Change the public stream protocol only in `packages/contracts`; web and API must consume the same Zod schema.

## Review Focus

Review the implementation as five independently diagnosable inputs, not as one vague “slow ASR” symptom:

| Input/failure | Expected ownership | Planned tasks |
| --- | --- | --- |
| Browser capture/main-thread churn | AudioWorklet emits 80 ms frames and flushes its tail exactly once | 1 |
| Browser WebSocket queue growth | Client measures queue duration, emits advisory slow/recovered state, then retains terminal cap | 2 |
| Gateway startup/provider queue growth | Provider reports advisory upstream flow; gateway relays only state/queue duration | 3, 4 |
| Provider/model or persistence delay | Gateway records stage timestamps and final persistence duration without content | 4 |
| Normal VAD finalization mistaken for transport slowness | UI labels interim text as confirmation-in-progress; actual slow state receives separate copy | 5 |

---

## Task 1: Batch PCM inside the AudioWorklet

**Files:**
- Modify: `apps/web/lib/PcmAudioWorklet.ts`
- Modify: `apps/web/tests/lib/pcm-audio-worklet.test.ts`

- [ ] Add failing unit assertions first: the generated worklet source owns a `PCM_FRAME_BYTES`-sized pending buffer, posts transport-sized frames rather than per-render-quantum microframes, and accepts a `flush` control message.
- [ ] Run `pnpm --filter web vitest run tests/lib/pcm-audio-worklet.test.ts` and confirm the new assertions fail for the current main-thread batching implementation.
- [ ] Move the `PcmFrameBatcher` algorithm into `PCM_AUDIO_WORKLET_SOURCE` as processor state. It must preserve byte ordering, create a fresh transferable buffer after every full frame, and post only complete 2,560-byte frames during ordinary `process()` calls.
- [ ] Add a `port.onmessage` handler in the processor for `{ type: "flush" }`; it posts the exact non-empty tail once and resets its pending state. It must not emit an empty `ArrayBuffer`.
- [ ] Change `startPcmAudioWorklet` so its main-thread message handler forwards only valid non-empty worklet frames directly to listeners; remove the second main-thread batching layer.
- [ ] Make `stop()` request worklet flush before disconnecting. Keep its idempotence and ensure the source/node/tracks/context cleanup runs even if the flush acknowledgement or context close fails. Use a small explicit flush acknowledgement message rather than timing-dependent sleep, and ignore late worklet messages after cleanup.
- [ ] Update deterministic tests to cover full frames, a cross-boundary tail, and double-flush/no-tail behavior through the extracted batching helper/source invariants; retain the existing downmix/PCM tests.
- [ ] Re-run `pnpm --filter web vitest run tests/lib/pcm-audio-worklet.test.ts` and record the passing output.

## Task 2: Add browser-side flow state and privacy-safe timing samples

**Files:**
- Modify: `apps/web/lib/realtime-asr.types.ts`
- Modify: `apps/web/lib/BoardxRealtimeAsrClient.ts`
- Modify: `apps/web/tests/lib/boardx-realtime-asr-client.test.ts`
- Add: `apps/web/lib/realtime-asr-flow.ts`
- Add: `apps/web/tests/lib/realtime-asr-flow.test.ts`

- [ ] Write pure-helper tests before implementation for byte-to-PCM-duration conversion, a warning/recovery hysteresis transition, and a terminal threshold that remains stricter than advisory slow state.
- [ ] Run `pnpm --filter web vitest run tests/lib/realtime-asr-flow.test.ts tests/lib/boardx-realtime-asr-client.test.ts` and confirm the new tests fail.
- [ ] Implement `realtime-asr-flow.ts` with named constants expressed in PCM duration: warning at 400 ms, recovery below 200 ms, terminal at the existing 1,000 ms browser cap. Convert duration using the established 32,000 bytes/sec PCM16 mono invariant; do not introduce a competing sample-rate constant.
- [ ] Define a discriminated advisory flow type (`normal` / `slow`) plus a compact timing sample containing only capture id, stage, elapsed/queued milliseconds, and outcome. Explicitly exclude text, PCM bytes, headers, and raw provider errors from its type.
- [ ] Extend `BoardxRealtimeAsrHandlers` with optional `onFlow` and `onTiming` callbacks so existing callers remain source-compatible. Add `slow` to `RealtimeAsrStreamState`; state remains terminally `error` for actual backpressure failure.
- [ ] In `openBoardxRealtimeAsr`, record timestamps for socket open, provider ready, capture started, local queue high-water mark, stop request, and completed/error. Emit timing samples on terminal cleanup exactly once.
- [ ] Check `socket.bufferedAmount` before each `send`: enter/recover browser advisory flow using the pure hysteresis helper; retain the present `AUDIO_BACKPRESSURE` failure once the hard cap is crossed. Do not drop/reorder frames in the advisory path.
- [ ] Parse the contract-level upstream flow event introduced in Task 3 and merge it with local browser flow: any slow source makes the public client flow slow; recovery occurs only once every observed source is normal.
- [ ] Update client tests for warning/recovery, protocol-propagated upstream slow, hard-cap error, no duplicate terminal timing callback, and startup race behavior.
- [ ] Re-run the two focused test files and record their passing output.

## Task 3: Make provider upstream queue pressure observable without changing failure semantics

**Files:**
- Modify: `apps/api/src/application/recording/asr-ports.ts`
- Modify: `apps/api/src/infrastructure/recording/configured-realtime-asr-provider.ts`
- Modify: `apps/api/tests/recording/configured-realtime-asr-provider.test.ts`

- [ ] Add failing provider tests for advisory slow/recovered callbacks based on upstream queued audio duration, verify they contain no transcript/error detail, and prove the existing terminal backlog still calls `onError("AUDIO_BACKPRESSURE", ...)`.
- [ ] Run `pnpm --filter api vitest run tests/recording/configured-realtime-asr-provider.test.ts` and confirm the new tests fail.
- [ ] Extend `AsrSessionHandlers` with a narrow `onFlow` callback whose payload contains only `state`, `source: "upstream"`, and `queuedMs`. Keep it optional only if all provider fakes/tests can remain compatible; do not add a general metrics dependency to the application port.
- [ ] Replace byte-only provider queue decisions with a single helper that derives queued PCM duration from the same fixed audio format used by this provider. It should emit `slow` once at the advisory threshold, emit `normal` only below recovery, and retain `MAX_UPSTREAM_AUDIO_BACKLOG_BYTES` as the terminal bound.
- [ ] Ensure the flow callback is best-effort: an observer exception cannot interrupt recognition or convert a healthy session into failure.
- [ ] Preserve the recording VAD selection and `resolveRecordingTurnSilenceMs` default/bounds exactly; add a regression assertion that a recording session sends `silence_duration_ms: 800` when no override is configured.
- [ ] Re-run the focused provider test file and record the passing output.

## Task 4: Relay provider flow and record per-capture server timings

**Files:**
- Modify: `packages/contracts/src/personal-realtime-transcription.ts`
- Modify: `packages/contracts/tests/personal-realtime-transcription.test.ts`
- Modify: `apps/api/src/interface/ws/personal-realtime-asr.gateway.ts`
- Modify: `apps/api/tests/recording/personal-realtime-asr-gateway.test.ts`

- [ ] Add contract tests first for a strict server `flow` event: `{ type: "flow", captureId, state: "slow" | "normal", source: "upstream", queuedMs }`. Reject extra properties and invalid state/source values.
- [ ] Run `pnpm --filter contracts vitest run tests/personal-realtime-transcription.test.ts` and confirm the new test fails.
- [ ] Add that exact Zod union member to `RealtimeAsrServerEvent`; do not create duplicate web/API protocol shapes.
- [ ] Add gateway tests using a provider fake that invokes `onFlow`, asserting the client receives the parsed contract event, normal recovery is relayed, and a flow observer cannot cause a capture failure.
- [ ] Add a gateway-local, injectable best-effort observation callback to `PersonalRealtimeAsrGatewayDeps`. Its event must contain capture id and numeric stage timings/high-water values only. The default composition remains no-op so no external telemetry service, database table, or user-content export is introduced in this change.
- [ ] Capture server timestamps at `start` received, provider open resolved, first PCM accepted, final received, final durable append complete, stopping requested, and terminal completed/failed. Emit one summarized terminal observation with stage durations and outcome. Do not log or attach the transcript, PCM, ticket, organization/user identifiers, raw exception message, or provider response.
- [ ] Relay provider `onFlow` through `send({ type: "flow", ... })`, validating it via the contract like every other server event. Maintain current startup pending-audio and terminal error limits unchanged.
- [ ] Preserve `persistThenPublishFinal` ordering. Add a regression assertion that the final WebSocket event is still absent until the repository append resolves, including while timing observation is enabled.
- [ ] Re-run contracts and gateway tests:
  `pnpm --filter contracts vitest run tests/personal-realtime-transcription.test.ts`
  `pnpm --filter api vitest run tests/recording/personal-realtime-asr-gateway.test.ts`

## Task 5: Present normal confirmation separately from a slow path

**Files:**
- Modify: `apps/web/components/rec/realtime-transcription-workspace.tsx`
- Modify: `apps/web/tests/ui/realtime-transcription-workspace.test.tsx`
- Modify: `apps/web/tests/e2e/personal-realtime-transcription-smoke.test.ts`

- [ ] Add UI tests first that assert: an interim result is visibly labelled as a provisional result awaiting normal final confirmation; a `slow` flow state shows non-alarming “audio is still being delivered/confirmed” copy; and terminal `AUDIO_BACKPRESSURE` keeps its existing actionable error path.
- [ ] Run `pnpm --filter web vitest run tests/ui/realtime-transcription-workspace.test.tsx` and confirm the new tests fail.
- [ ] Store flow state separately from recording/stopping state in the workspace. Wire `onFlow` from `openBoardxRealtimeAsr` to it, clear it for a new capture and terminal cleanup, and do not let an advisory slow state disable the stop control.
- [ ] Label interim text as temporary: it is being confirmed and will be durably saved after the natural server-VAD pause (about 800 ms). This is explanatory copy, not an invented client-side endpoint detector.
- [ ] When flow is slow, show a distinct advisory status explaining that audio delivery or server confirmation is lagging while capture continues. Keep normal “receiving audio” and manual-stop “waiting for tail result” copy distinct from this state.
- [ ] Update the mocked realtime client/UI fixtures for optional flow callbacks and add a Playwright smoke assertion for the normal interim-to-durable-final path. Do not make e2e depend on a real upstream slowdown; deterministic unit coverage owns that branch.
- [ ] Re-run focused UI tests and the transcription smoke spec.

## Task 6: Run the full verification and prepare the issue/PR evidence

**Files:**
- Modify only if required by an actual test discovery/configuration change: `apps/web/package.json`, `apps/api/package.json`, or repository test configuration.
- Update GitHub issue #4173 with implementation decisions and verification evidence; do not mark it complete before the PR is merged.

- [ ] Run the complete affected test suite in this order and stop to diagnose failures before changing unrelated code:
  - `pnpm --filter contracts vitest run tests/personal-realtime-transcription.test.ts`
  - `pnpm --filter api vitest run tests/recording/configured-realtime-asr-provider.test.ts tests/recording/personal-realtime-asr-gateway.test.ts`
  - `pnpm --filter web vitest run tests/lib/pcm-audio-worklet.test.ts tests/lib/realtime-asr-flow.test.ts tests/lib/boardx-realtime-asr-client.test.ts tests/ui/realtime-transcription-workspace.test.tsx`
  - `pnpm --filter web playwright test tests/e2e/personal-realtime-transcription-smoke.test.ts` (or the repository’s documented equivalent command if this package delegates Playwright elsewhere).
- [ ] Run the repository-required typecheck/lint commands identified by the touched package scripts, followed by `./init.sh` if its baseline remains runnable in this worktree.
- [ ] Review `git diff --check`, inspect the final diff for accidental transcript/PCM/error-detail observability, and confirm the 800 ms default regression test is present.
- [ ] Post a concise issue #4173 comment with the selected 80 ms frame/800 ms VAD decisions, slow-vs-terminal behavior, commands run, and links to the eventual PR. Do not paste user content or audio data.
- [ ] Commit implementation on `codex/rec-accurate-smooth`, push it, open one PR with `Closes #4173`, request/review feedback, remediate required checks, and merge only after CI is green.
