# Checkpoint deployment recovery — #3498

The public main deployment run 34682276375 failed with
`DEEP_AGENT_CHECKPOINT_DB_REQUIRED`. Passing application CI did not establish that
the research recovery changes were deployed.

The fix provisions a dedicated checkpoint database only when no DSN is configured,
preserves external DSNs, joins the PostgreSQL container network, and derives the
runtime port from the built image. A bounded preflight verifies ledger setup and
async graph checkpoint write/read/reconnection before removing the old service.

The self-hosted graph uses async execution. Its synchronous PostgreSQL saver now
has async adapters and an explicitly owned connection; the research graph is
compiled once with the persistent saver. Platform-managed graph exports retain
their existing behavior.

PR review identified a same-thread collision between different assistants. Guided
Research now prefixes only its durable storage namespace, keeping LangGraph root
and nested-subgraph routing unchanged. Scoped deletion cannot remove another
assistant's checkpoints. The deployment preflight also verifies same-thread
isolation, reconnection, history routing, and scoped deletion with synthetic data.
HTTP state and interruption reads select the latest run's persisted assistant;
the full run request is not exposed in that projection.

Verification commands and results are recorded in verification.txt. Tests use
synthetic data and disposable PostgreSQL only; no external model calls or user
research content are used.

Further review covers restricted and native execution paths. Restricted graphs
reuse the durable saver; invalid assistant/configuration requests are rejected
before becoming the latest run. HTTP restoration retains the persisted execution
mode. Native async contexts are entered before persistence and released on
success, failure, cancellation, and shutdown. These changes close execution
and recovery failures that a checkpoint-only database probe could miss.

The deployment probe now exercises the real restricted graph selector, runtime,
durable ledger, and local HTTP state/thread endpoints with a synthetic model.
It does not start Runtime recovery against an existing service's active runs.

Native completed/interrupted runs persist the actual graph state projection in
the existing ledger before reporting completion. HTTP reads restore that
projection after runtime restart or binding expiry; internal projection events
are not emitted to SSE clients. Legacy native runs without a projection retain
the live-binding read path; expired legacy bindings are not fabricated as valid.

Final deployment review corrected the legacy /ok poll to the ASGI /healthz
route. Regression tests bind the deployment poll to the registered route and
verify bounded failure. Assistant-registration messages no longer claim that
production graph compilation or external model availability was proven.
