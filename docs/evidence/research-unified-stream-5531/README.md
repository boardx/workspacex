# Unified generation stream — issue 5531

Research and interview share the `generation-stream.ts` wire vocabulary. Interview's existing output remains compatible. Research requests `Accept: application/x-ndjson`; its public stream contains only stage, delta, completed and failed. Blank lines serve as keepalives. Clients without NDJSON negotiation retain legacy SSE during rollout.

Examples:

```json
{"type":"stage","stage":"planning","source":{"sessionId":"s","requestId":"r","version":2,"revision":1}}
{"type":"delta","delta":"新增文本","source":{"sessionId":"s","requestId":"r","version":2,"revision":1},"sequence":1}
{"type":"completed","source":{"sessionId":"s","requestId":"r","version":2,"revision":2}}
{"type":"failed","reasonCode":"RESEARCH_WORKFLOW_UNAVAILABLE"}
```

Research needs small identity/order metadata for stale-event rejection and retries. Stream-reset descriptors contain sequence, offset and status only, no prose or runtime patches. Internal sources/tasks/plan, lease, diagnostics and quality projections stay on authenticated runtime/progress APIs. Pending command polling already updates those fields. Completion hydrates the authoritative runtime once; initial/restored nonempty text streams may also require a recovery read. Receipt completion means command completion, not necessarily report publication.

A zero-offset reset updates only the latest UI reportStream rather than synthesizing a full snapshot from an old baseline. Resets older than the synchronized sequence are ignored. This prevents concurrent polling metadata from being overwritten. Existing state synchronization, persistence, permissions, report checks and command idempotency remain.

Verification: research orchestration suite, interview unit/controller suite, fragmented Unicode NDJSON client tests, controller negotiation and legacy SSE regressions, request/session guards, terminal failure/interruption, reset/polling race, API/Web typecheck and pre-push lint. Print/export tests are outside this protocol change and waived by the user.

This changes the public transport format, not model execution latency. It does not claim a reduction in total traffic including state recovery reads or a measured real-provider speedup.

Verified results: research 687 tests, interview 421 tests, affected Web 27 tests, API/Web typechecks all passed. Independent read-only review accepted the reset/polling fix with no remaining blockers.
