# CI-wired collaboration regressions

Runtime commit: fa47ee3f1. Main-session verification on 2026-09-27.

Command:

```sh
WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=board-collaboration-regressions --no-deps --workers=1
```

Exit 0; 2 passed, 1m34s including isolation and cleanup. No explicit PGUSER/PGPASSWORD overrides were supplied: the ACL helper used the application migration configuration, with isolation database/port/loopback assertions and app_rw role retained.

- Real PostgreSQL lock-wait permission recheck: passed (1.2s).
- Same-browser shared durable outbox without duplicate commits: passed (7.8s).

The project is now a dependency of seeded-github-import in the existing fullstack CI configuration. The local run selected it directly with --no-deps; remote CI remains a separate gate. This proves these two regressions only, not overall Board acceptance or a 9/10 experience score.
