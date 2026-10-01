# Isolated consumer termination closure (#4992 / PR #4994)

The canonical Python consumer has no Node conservation request. The supervisor
constructs that request only in the Node branch; the Python payload retains its
independent owner credentials and exact source/runtime resources.

SIGTERM/SIGINT interrupt work with an exception so owned `finally` cleanup runs.
The stage forwards interrupted work to its own independent supervisor process
group. Repeated termination is ignored during cleanup; the parent retains a finite
forced-termination deadline. The stage and outer adapter allow up to 180 seconds
for the existing individually bounded inspect/remove/network cleanup calls. This
is cleanup time, not additional SQL execution authorization or an extension of the
provider resource deadline.

An interrupted network creation can complete before its ID reaches the caller.
Cleanup reconciles only this run's random owner name, verifies the owner label and
absence of attached containers, then removes that exact network ID. It never
sweeps or removes unrelated resources. A terminated run returns failure, even
when cleanup succeeds. SIGKILL, a hung daemon, and ambiguous mutation outcomes do
not establish verified cleanup or readiness.

`isolated_conservation_consumer_signal_test.py` exercises the actual
`run_stage -> actual_engine -> supervisor` Python branch and real OS signal/timeout
propagation with mocked Docker observations. It checks producer cleanup, stage
propagation to its independent supervisor group, and interruption after network
creation before ID assignment. No test performs cloud operations, SQL or real
Docker mutations. Restoring the pre-fix request construction and default signal
termination in a temporary copy produces the expected TypeError and missing
cleanup failures; those counterexamples do not alter the checkout.

Run the standard gate:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/vm/isolated-rehearsal.test.ts
```

Offline consumer and signal tests do not certify live restoration, conservation,
recovery, image availability, IAM installation, or production readiness.
