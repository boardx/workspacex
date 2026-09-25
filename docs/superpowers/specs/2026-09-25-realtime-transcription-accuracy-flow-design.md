# Accurate, smooth realtime transcription

Issue: #4173

## Decision

Realtime personal transcription keeps the current accuracy-first segmentation policy:

- input remains 16 kHz, mono, PCM16;
- browser-to-gateway frames remain fixed at 80 ms;
- long-form server VAD remains 800 ms by default;
- only durable, persisted finals enter the saved transcript.

Interim text is the low-latency feedback channel. A final segment deliberately waits
for VAD plus provider recognition and persistence; that normal confirmation period is
not reported as a transport failure.

## Problem

The system caps audio backlog at every hop, preventing unbounded stale audio, but it
does not make the source of visible delay observable. The worklet also forwards every
small render quantum to the main thread before main-thread batching; at a 48 kHz input
this is roughly 375 cross-thread messages per second even though the network emits only
12.5 frames per second. This can add avoidable scheduling pressure without improving
recognition accuracy or network latency.

## Scope

1. Move the 80 ms PCM aggregation boundary into the AudioWorklet. The main thread
   receives complete transport frames and still flushes the final partial frame on stop.
2. Add a per-capture latency timeline covering frame capture, browser transport
   backlog, gateway receipt, upstream transport backlog, provider interim/final, and
   durable-final publication.
3. Add an explicit non-terminal `slow` stream state. It communicates a sustained but
   recoverable transport/provider delay; `AUDIO_BACKPRESSURE` remains terminal after
   the one-second real-time budget is exceeded.
4. Present distinct UI copy for normal `confirming` finalization and `slow` delivery.
5. Keep VAD at 800 ms and record the effective VAD setting with each timeline sample.

## Non-goals

- Changing the default long-form VAD to 400 ms or implementing semantic/client-side
  endpointing.
- Silently dropping old audio to make a lagging stream appear current.
- Resumable stream protocol, acknowledged frame sequence numbers, or replay after a
  disconnect. Those need a separate protocol and idempotency design.
- Publishing a final before it is durable. That could present text which disappears
  after a crash.

## Data flow

```text
AudioWorklet (PCM resample + 80 ms batch)
  -> browser WebSocket (binary PCM; report local buffered milliseconds)
  -> gateway (record ingress cursor/time)
  -> provider WebSocket (record encoded buffered milliseconds)
  -> provider interim/final callbacks
  -> durable segment append
  -> browser final event
```

Each sample is associated with `captureId`; metrics contain timestamps, byte/cursor
counts, and enum states only. They never contain PCM, transcript text, credentials, or
provider error detail.

## State and error handling

The existing terminal states remain authoritative. `slow` is advisory and reversible:

- enter when either browser or provider outbound queue crosses a configured warning
  watermark below the existing terminal one-second cap;
- return to `recording` when both queues drain below a recovery watermark;
- emit `AUDIO_BACKPRESSURE` and close when a terminal cap is crossed;
- treat an 800 ms VAD wait with healthy queues as `confirming`, not `slow`.

The warning and recovery watermarks use audio duration, not arbitrary bytes, so they
remain meaningful if the PCM format changes. The current PCM16 mono 16 kHz conversion
is 32,000 bytes per second.

## Observability and success criteria

The implementation records enough information to calculate:

- capture-to-first-interim latency;
- provider-final-to-durable-final latency;
- browser and upstream queue high-water marks in milliseconds;
- slow-state duration and terminal-backpressure rate;
- the effective VAD duration for each capture.

Initial SLO candidates, to validate with production baselines rather than enforce as
facts, are p95 capture-to-first-interim under 1 second and p95 final confirmation after
the configured 800 ms silence under 1.5 seconds excluding user speech duration.

## Test plan

- Worklet tests prove an 80 ms frame is emitted from many small render quanta and that
  a stop flushes exactly one tail frame.
- Browser client tests prove warning/recovery state transitions, terminal backlog
  handling, and metrics do not include transcript text.
- Gateway/provider tests prove ingress/upstream observations are ordered and that
  durable final publication remains after persistence.
- UI tests distinguish recording, confirming, slow, and terminal error copy.
- Focused realtime smoke test confirms actual start, interim, final, and stop flow.

## Alternatives rejected

**Lower all frames to 20–40 ms.** It can marginally help VAD responsiveness, but the
current 80 ms frame already sits inside the 50–200 ms industry range. It would double
or quadruple message and JSON overhead before a measured bottleneck exists.

**Lower VAD to 400 ms.** The provider recommends it for fast conversational turns, but
the product decision for long-form transcription is fewer, more natural segments.

**Send provider finals before persistence.** It may improve visible final latency but
violates durable transcript semantics. Measure database contribution first; if it is
material, design a separately acknowledged provisional-final protocol.
