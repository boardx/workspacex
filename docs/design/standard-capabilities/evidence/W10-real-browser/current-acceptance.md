# W10 incremental browser acceptance

`playwright-mcp-browser-real.test.ts`: **3/3 passed** in actual installed Chromium and official Playwright MCP (log `chromium-preview-green.txt`). This closes the previously reproduced boolean fill and screenshot path defects on the integrated adapter.

- Navigate/snapshot/fill/click and separate browser-context storage are actual browser actions.
- The screenshot test creates an independent real session inside root's `wx-w08-locators-skill-sandbox-sessions-1`. Actual UDS upload/download proves PNG bytes, dimensions and hash; destroyed-session read fails. It closes its browser, UDS relay and temp directory and destroys only its own session.
- Preview HTML is a deterministic in-memory workspace fixture. Desktop/mobile PNG dimensions match shared limits. Inline JavaScript runs while fetch and image requests to the otherwise permitted local HTTP server are blocked by actual CSP; the server receives neither leak request. This does not claim preview source permission proof or real PG receipt behavior.

This in-process test explicitly acknowledges `allowInProcessBrowserWithoutNetworkNamespace: true` solely for localhost synthetic HTML. It is not evidence of production OS network isolation, deployed browser runtime, proxy policy or actual external site browsing. Production isolation is a separate root-owned acceptance path. Browser owner/authority/receipts are explicit fixtures here; the new `browser-execution-receipts-real-db.test.ts` separately tests real persisted receipts.

Command:

```sh
WORKSPACEX_REAL_BROWSER=1 WX_NATIVE_SANDBOX_CONTAINER=wx-w08-locators-skill-sandbox-sessions-1 pnpm --filter @repo/api run test:browser-real
```

Real PG receipt acceptance: **6/6 passed**, standard wrapper 94558 exit 0, 7 seconds, peak 3 connections. See `pg-receipts-green.txt`. The tests use `PgDatabase(appConfig())` and the actual installed claim/finish functions under app_rw. They cover fresh-connection success replay and argument conflict, two-connection single claim, wrong attempt/lease/org, expiry and late finish, parent cancellation, and a real row-lock race. The race waits until `pg_stat_activity` reports the independent claimant blocked on a Lock, commits parent cancellation, then asserts no receipt row exists. Unknown pending is reported as unconfirmed and is not re-admitted.

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/browser-execution-receipts-real-db.test.ts
```

The standard wrapper exited cleanly and the DB slot was handed to the S004 worker. No browser, session, local relay or DB resources remain owned by this worker. Do not count the older Map-based `pg-browser-execution-receipts.test.ts` as a database test. This receipt test does not claim real remote cancellation or an OS process stop; those remain the actual browser runtime/control acceptance scope.
