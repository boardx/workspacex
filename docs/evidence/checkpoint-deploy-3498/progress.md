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

Verification commands and results are recorded in verification.txt. Tests use
synthetic data and disposable PostgreSQL only; no external model calls or user
research content are used.
