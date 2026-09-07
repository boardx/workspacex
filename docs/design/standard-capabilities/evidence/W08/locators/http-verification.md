# W08 production document locator acceptance

Test: `apps/api/tests/agent-runtime/standard-document-locators-http.test.ts`.

This test boots the production `createApp` composition and uses its real document controller/service, native session owner, permission grants, attachment repository, object store, and current input visibility checks. A local UDS relay only forwards each request unchanged into the specified sessions-only Docker container; no parser or file results are mocked. Four repository fixtures go through actual `uploadAttachment`, pinned read-only input mounting, AnyDoc Markdown generation, the native structure parser, and byte/hash-verified download.

Assertions cover PDF repeated-header cross-page fragments, DOCX table coordinates without invented page numbers, PPTX slide/table coordinates, XLSX formula and merged-range locations, original source hash preservation, absent grants/stale leases/forged paths, and a source permission revocation applied after actual sandbox execution but before its response. The latter must refuse all output references.

Scope: this is a real parser/service/HTTP/PG test with deterministic input files, not a real model-selection test or visual document QA. The sandbox container belongs to root; this test destroys only its own binding/session and local relay/temp directory. Its standard database wrapper must clean its own stack.

Final result: **6/6 passed**, standard isolation wrapper 23755 exit 0, 13 seconds total, peak 3 database connections. The rebuilt `workspacex-skill-sandbox:w08-locators` container `wx-w08-locators-skill-sandbox-sessions-1` ran every parser command. See `http-green.txt`. Root's full API typecheck 51059 passed including this new test before the additional fixture-only SQL seed.

Command:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-w08-locators-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-document-locators-http.test.ts
```

The first attempt (`http-fixture-red.txt`) was rejected in setup by the production MCP snapshot reader because generic `seedAgentRun` does not create actual agent/version rows. All six assertions were skipped and that run is not counted as acceptance. Adding genuine agent/version fixture facts, with no authorization or production changes, allowed the unchanged production service to execute. Final setup and tests use the production owner and MCP snapshot implementation.

Cleanup: test `afterAll` released the private binding/session, closed the app and UDS relay, removed its temp directory, and restored environment values. The standard wrapper removed its database resources. Root's shared container remains running deliberately; the DB slot was handed directly to the S018 worker.
