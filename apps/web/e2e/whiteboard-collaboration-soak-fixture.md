# Board collaboration soak fixture

This fixture proves issue #4144 against a running full-stack environment. The acceptance profile is pinned in
`support/whiteboard-collaboration-soak.ts`; it opens 50 independent browser contexts, exercises at least 20 writers for
30 minutes, forces a 30-second outage, and requires recovery within five seconds. The resulting report compares every
browser, a fresh browser, and a direct server snapshot against the unique operation ledger. It also enforces the
controlled-environment remote-observation latency budget.

Run the acceptance profile explicitly:

```bash
pnpm run verify:whiteboard-collaboration-soak
```

The GitHub workflow exposes the same lane through the `run_board_collaboration_soak` manual input. Ordinary pull
request CI does not start it. The workflow uploads `apps/web/test-results/whiteboard-collaboration-soak/`, including the
machine-readable `report.json`. The verifier accepts only a complete acceptance report for the exact checked-out SHA;
failure and diagnostic reports cannot pass the lane.

For local algorithm diagnostics, select the diagnostic profile and explicitly shorten its dimensions:

```bash
WHITEBOARD_SOAK_PROFILE=diagnostic \
WHITEBOARD_SOAK_CLIENTS=3 \
WHITEBOARD_SOAK_WRITERS=2 \
WHITEBOARD_SOAK_DURATION_MS=15000 \
WHITEBOARD_SOAK_OFFLINE_MS=1000 \
pnpm run verify:whiteboard-collaboration-soak:raw
```

That run may exercise the browser scenario quickly, but its report status is `diagnostic-passed` and is never valid
acceptance evidence. The pure test `tests/whiteboard/collaboration-soak.test.ts` covers ledger convergence, fork,
duplicate, missing-operation, latency, reconnect, writer-coverage, and false-acceptance rules without starting services.
