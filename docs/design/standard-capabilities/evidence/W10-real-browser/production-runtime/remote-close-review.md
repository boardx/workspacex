# Independent runtime review and remote session close

The confirmed lifecycle defect was RemotePlaywrightMcpSessionFactory.close calling only Client.close. The installed SDK StreamableHTTPClientTransport.close only aborts the local stream; terminateSession sends DELETE. Official Playwright MCP HTTP transport retains its session map until server transport close, which triggers backend disposal. Active browser sessions have a 5-second heartbeat fallback (plus the 3-second interval); an initialized session failing tool-schema discovery has not started that heartbeat yet. Thus local close was not evidence of remote termination.

The factory now memoizes close, sends a DELETE with an independent deadline using the existing STANDARD_BROWSER_LIMITS.deadlineMs, rejects redirects and non-2xx termination responses, and closes the local client in finally. Explicitly checking response.ok prevents the SDK's special 405 acceptance from being reported as termination. Initialization failure follows the same cleanup path. Fire-and-forget adapter release sites consume rejection so failed remote cleanup cannot create an unhandled rejection; direct release/close still reports failure.

Actual controlled-runtime acceptance: two separately initialized sessions receive different synthetic routed pages. Closing A sends exactly one DELETE even under repeated concurrent close calls; using A's old session ID returns 404, while B still returns its own page. Schema-discovery failure also deletes the initialized session before any browser call. Explicit 405 and bounded timeout fixtures reject close rather than claiming success, and test teardown separately deletes those remaining real sessions. These are session invalidation and independent-context facts; DELETE acknowledgment does not mean rollback of already executed page actions, and upstream backend disposal itself is asynchronous.

Final command:

```sh
WX_BROWSER_RUNTIME_ENDPOINT=http://127.0.0.1:58931/mcp pnpm --filter @repo/api exec vitest run --config vitest.browser-adapter.config.ts tests/agent-runtime/playwright-mcp-browser-real.test.ts tests/agent-runtime/playwright-mcp-browser-adapter.test.ts tests/agent-runtime/pg-browser-execution-receipts.test.ts tests/agent-runtime/playwright-mcp-upstream-contract.test.ts tests/agent-runtime/browser-runtime-deployment.test.ts
```

Result: **26 passed / 3 intentionally skipped** (the already-proven separate in-process/sandbox browser lane), 5 files. The three real remote-lifecycle tests are included among the 26. No DB was used. Every test-created remote session/local relay was cleaned; root's runtime stack remains intact.

Read-only network review: the actual compose overrides the image's unsafe default entrypoint, enables Chromium sandbox as non-root with no capabilities and NNP, isolates the browser network, and uses fixed-path/fixed-host ingress. Squid's destination ACL, rather than the API's earlier hostname check, is the enforcement point for redirect/subresource DNS resolution. Existing egress evidence proves literal private/link-local/mapped denial and direct-route denial; it does not itself demonstrate changing/mixed DNS records. No DNS-rebinding bypass was established in this review, and no additional network test or configuration change was made. Avoid describing that finite evidence as exhaustive address/DNS coverage.
