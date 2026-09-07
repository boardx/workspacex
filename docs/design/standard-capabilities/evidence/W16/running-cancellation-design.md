# W16 / T042 running child cancellation

Reuse the existing durable `subtask_runs` queue and parent cancellation reader.
Do not add a main-run journal or UI state machine. The five existing task statuses
remain; additive cancellation facts distinguish requested, confirmed and unknown.
A cancellation request is durable before a worker attempts interruption.

The original `finish` operation lacked a parent-cancel fence. The red regression:
claim a child, commit parent cancellation, complete the old worker, and require
null output. The fix locks parent first, then writes the child, sharing the same
order used by enqueue/claim and parent cancellation propagation.

Deep-agent text tasks use their own deterministic thread identity (child ID),
not their parent's thread. Persist the existing onRemoteRunStarted callback
before polling. Reuse DeepAgentEngineRunController's explicit interrupt request,
wait for response completion, and verify authoritative interrupted status.
No Promise.race can establish remote cessation. A lost reply or missing handle
is unknown, never confirmed; later tenant kicks can retry cancellation with the
persisted handle without recreating a model run.

Configured HTTP models receive an optional nonserialized AbortSignal. It only
cancels the local HTTP request. Successful transport cancellation does not prove
vendor computation stopped: terminate local bookkeeping as failed with an
explicit unknown cancellation fact and no result. Do not automatically replay
unknown calls. Existing retry must reject an unknown cancellation outcome.

No row is reclaimed for execution: stale work already becomes failed and user
retry creates a new ID. This existing rule plus terminal CAS fences old workers;
remote handle binding is immutable. Unknown terminal cancellation may later be
confirmed as an observational fact, without republishing output or changing a
terminal execution status. Parent child-cancellation reports unavailable while
any child has unknown cancellation, rather than inferring success from zero
running rows.

Scope: current parent visibility/write authorization, tenant ownership and
private-thread checks are preserved. New kernel wiring only injects the existing
engine controller into SubtaskRunExecutor. ModelCallInput.signal is never placed
in model JSON, LangGraph configurable, persisted request data or logs.

Validation distinction: the HTTP adapter tests exercise real sockets and worker
cessation against a controlled server; they are not evidence of the LangGraph
runtime implementation. `subtask-langgraph-cancel.probe.ts` separately launches
locked langgraph-api 0.12.4, uses the actual existing TS control adapter, and
requires both an observed CancelledError/finally marker and authoritative
interrupted status. Its ephemeral dev storage only tests execution interruption;
persistent cancellation and restart facts are tested separately against PostgreSQL.

Shared-file commit boundary: `kernel.module.ts` only adds EngineRunController's
existing type/token to the SubtaskRunExecutor provider and its final constructor
argument. Other kernel changes belong to peers/root. `ports.ts` adds only the
optional signal field. The configured provider changes one request signal;
the deep-agent provider adds per-call ALS signal binding, scoped fetch signal
composition and abortable poll delay. No existing provider test or main-run
control implementation is edited by W16.
