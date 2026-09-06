# Native factory cross-runtime integration

The dedicated `native-full-chain.test.ts` runs one official Python native graph with a scripted model. It uses real Nest controllers, `PgNativeSessionOwner`, `PgParentRunControlReader`, `ToolExecutionAuthority`, persisted run grants, `PgNativeOutputStaging`, `FsObjectStore`, and existing `PgAgentRunRepository` writeback. The model scripts read_file → execute → wx_artifact_publish → final; its grader is also scripted. This is not paid/live model quality evidence.

A test-owned local UDS relay forwards bytes using the existing `native_sandbox_fixture.py` Docker UDS relay into the isolated E003 sessions container. Neither Python nor Node replaces its production sandbox HTTP client. No FakeAuthority or fake session owner is used. The test preauthorizes tool grants through the actual PG repository and checks missing grant and stale lease rejection.

Expected assertions: actual SKILL metadata/body-read facts, three successful tool responses, exact UTF-8 bytes in the real filesystem object store, one artifact version and attachment through idempotent existing writeback. Session cleanup runs before Nest/relay shutdown. Dedicated Docker project/volume must also be removed by the invoking shell.

Invocation (from repository root, with the dedicated E003 container already started):

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-native-chain-audit-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api test:native-chain
```

The final raw test result is recorded separately. The existence of this test is not passing evidence. This fixture bypasses the production HTTP enqueue/provider orchestration and uses an in-process minimal Nest module; it does not establish deployment availability or live model behavior. It validates the real components' cross-language protocol and actual sandbox-produced file delivery.

The default API suite excludes this opt-in lane. `test:native-chain` inherits canonical DB global setup/environment and refuses to start without a named sandbox; it never reports a skipped chain as passing.

## Executed result

`tests.txt`: 1/1 passed, command 20 seconds, wrapper cleanup 1 second. The emitted report records metadata_discovered/body_read and all three actual tool results, one artifact version and one attachment. `typecheck.txt`: API TypeScript exit 0. `cleanup.txt`: dedicated sandbox container and volume removed.

The test exposed the Nest default POST status mismatch against Python authority's exact HTTP 200 requirement. `RunInterjectionController.checkTool` now explicitly returns 200; actual stale-epoch HTTP response is asserted as 200/allowed:false, and three official Python authority checks exercise the positive path. No change to permission decisions or poll semantics.

## Adjacent regression reconciliation

`drift-tests.txt` first execution: 4 files passed plus 6 application scope cases; six new PG cases failed because the fixture attempted queued→awaiting directly. The real state trigger correctly refused. After adding the legal running transition, `scopes-tests.txt` records 12/12 pass (six application delegation and six real PG scope/CAS/rollback cases). Together the final affected set is 39 passing tests; this is two executions, not a claimed single all-green run. No production permission rule was weakened. The PG negative case deliberately makes grant insertion fail and verifies the run decision rolls back.

The other four reconciled fixtures assert explicit legacy recovery profile, required custom event stream, rejection of cross-tenant queue submission, and visibility-before-atomic-decision (not separate post-decision grant writes). Permission lint passed with 1,263 sources, 201 tenant tables and the unchanged 91 allowlist entries.
