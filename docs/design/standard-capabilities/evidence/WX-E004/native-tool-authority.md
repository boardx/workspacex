# Native dispatch-time authority, WX-E004

`create_native_graph` now requires an explicit trusted `tool_authority`. Production factories supply `HttpNativeToolAuthority`; tests explicitly supply `FakeAuthority` from the test fixture module. There is no runtime environment test bypass or missing-authority default.

`NativeToolAuthority` is the innermost tool wrapper, after the existing middleware. Every dispatch calls check/acheck again, then invokes the handler exactly once only if the check returned successfully. HttpNativeToolAuthority succeeds only for the schema-validated response `{allowed:true}`. Its context comes from LangGraph configurable.run_control_callback; org/run/attempt/epoch/key/permission request are never copied from model arguments. The real ToolCall supplies id/name/full args. The peer authority continues to derive skill identity and approval argument identity; no local permission engine is added.

Input and output JSON schemas are generated from `@repo/contracts/run-control` via `generate-tool-authority-schema.ts`, with a freshness test. Identity errors, missing callback, denied responses, unexpected HTTP status, redirects, invalid response schema and transport failures raise sanitized ToolAuthorityError. The native ToolRetryMiddleware excludes this error, so unknown authorization cannot be retried into a side-effect dispatch. Sync and async HTTP clients disable redirects and environment proxies and use HTTPX 5-second network timeouts. This timeout is the HTTPX phase/inactivity bound, not a claim of atomic permission+execution or a hard whole-request wall-clock deadline.

Red baseline: test_native_tool_authority.py initially failed importing the absent module (1 failed). Green command:

```
WX_NATIVE_SANDBOX_CONTAINER=wx-tool-authority-test apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_native_tool_authority.py apps/deep-agent-service/tests/test_native_graph.py apps/deep-agent-service/tests/test_native_skill_activity.py apps/deep-agent-service/tests/test_native_image_read.py apps/deep-agent-service/tests/test_skill_packages.py -q --timeout=60
```

74 passed; shared schema freshness 1 passed. Real loopback HTTP covers sync/async allowed/denied/invalid/extra-field/401/302/nonobject responses, repeated dispatch rechecks, trusted org versus model argument override, and actual request path/identity. Timeout tests verify no handler and no secret error details; graph denial proves one check/no retry/no side effect. Existing real sandbox native/Skill/image tests now use explicit test-only FakeAuthority, so they prove capability behavior without pretending to exercise production permission state.

This does not modify the peer API permission judgment, main provider, parent cancellation or Skill fact logic. It does not claim the permission check and subsequent execution are a single database transaction. Owned wx-tool-authority-test compose container and volume are removed after verification.

## Total deadline and response bound follow-up

The earlier phase-timeout limitation above is now addressed: both entry points use the same AsyncClient.stream operation inside `asyncio.timeout(5.0)`. Sync callers drive it with asyncio.run; calling the synchronous entry point from an already-running event loop refuses and requires acheck. No background watchdog threads or private socket patches are introduced. Raw JSON response is capped at 16 KiB; compressed responses are refused, avoiding unbounded decompression. Redirects remain disabled. Network, total timeout, oversized or malformed responses cannot dispatch.

26 authority tests passed, including real loopback slow-drip (one byte every 50ms) and oversized-body cases in sync/async. Tests reduce the deadline to 0.2s and assert refusal before 0.8s, proving an inactivity timeout alone cannot satisfy the test. Every loopback server is closed; no Docker resources were created for this follow-up. Raw result: native-tool-authority-deadline-tests.txt.
