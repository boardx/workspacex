# Spatial regression — incomplete

Exact candidate: 0467a1ce42eb150a804a7334cf772a2782178e1b.
Main-session run: 3 passed, 1 failed, exit 1. Total 5m13s including admission and automatic isolated-stack cleanup.

Command:
```sh
WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=postgres_dev FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps board-spatial-relationships.spec.ts --workers=1
```

Failure: multi-select transform / Panel / connector / total z-order scenario at line 205, second page never reached the expected synchronized state within the assertion deadline. Screenshot/trace showed eight pending modifications on the second page. Independent trace analysis confirmed authenticated WebSocket upgrades and HTTP board reads succeeded; the first page accumulated pending updates too. This is not evidence of a login failure and must not be dismissed by increasing the timeout.

Earlier coordinate assertions passed. Independent review of the integer CSS pointer test helper approved its strict expected-value calculation (four helper unit tests passed); no tolerance relaxation was introduced.

Iteration 7 remains unaccepted. A queue/acknowledgement diagnosis and a new real regression run are required. See failure-context.md for the captured failing assertion and UI snapshot. Full trace remains locally available in apps/web/test-results/fullstack-smoke/board-spatial-relationship-3b005-otal-z-order-survive-reload-seeded-github-import/trace.zip; it is not represented as committed evidence.
