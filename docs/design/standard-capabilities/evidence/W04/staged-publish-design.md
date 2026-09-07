# T020: explicit staging, existing artifact writeback

The model invokes `wx_artifact_publish` with a workspace path, filename/title, supported MIME and idempotency key. Official ToolRuntime supplies the actual tool call ID. Identity, lease and native binding come exclusively from trusted configurable callback/ref. The strict generated contract rejects project/sourceRefs and other unsupported inputs rather than ignoring them.

The API checks the current tool authority (including existing L2 approval), resolves the bound session and reads the selected file. MIME signature checks reuse `sniffAndCheck`; UTF-8 text is decoded strictly. OOXML additionally passes the existing archive safety inspection and checks the actual Content Types namespace, matching main part and main content type. Its metadata reader reuses the existing central-directory parser with a bounded single-entry inflater. DTD/entities and unsupported XML syntax are refused. PDF/image signatures are MIME checks, not a claim that every document opens or renders correctly.

`collectNativeOutputs` writes real bytes through existing `ObjectStore.putOnce`, then reads back and checks size/hash. Only after that does the staging transaction persist a RunOutputFile and return `{publishId,sha256,sizeBytes,status:staged}`. It returns no ready artifact ID. The run lock and transaction serialize same-run requests and current authority; same idempotency key with changed arguments or current file bytes is a conflict. Failed object writes leave no staged record. A database failure can leave an unreferenced immutable object; retry may reuse it only after verified readback.

On successful model completion, the executor reads persisted staging files and passes them to existing `storeOutputAwaitingWriteback`. Session cleanup can then run without losing bytes. Existing `commitWriteback` creates the assistant attachment and calls `registerRunArtifacts` inside the same transaction. That existing version/attachment identity provides readiness and continuation-version behavior; no parallel artifact repository exists. On writeback retry, no sandbox or model rerun is needed. Staged files from cancelled/failed runs are not ready artifacts.

The catalog output changes from unconditional ready to the two lifecycle variants. Final ready/UI-preview/hash acceptance remains required; staging success alone does not satisfy it. Cross-project/source-ref publication is explicitly deferred, not completed. Supported initial types: PDF, PNG, JPEG, UTF-8 TXT/Markdown/CSV, DOCX/XLSX/PPTX. Other MIME types and ambiguous OOXML are refused.

## Verified commands and boundaries

- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-output-staging.test.ts tests/agent-runtime/native-output-staging-real-db.test.ts tests/agent-runtime/native-session-files.test.ts`: 13 passed. Real PostgreSQL, real Nest HTTP endpoint, real filesystem ObjectStore, existing attachment/version writeback; UDS transport tests use a real local HTTP socket fixture. Staging database test injects a BoundSessionFiles fixture, so this is not a single end-to-end container-to-Python-to-API run.
- `apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_native_artifact_publish.py apps/deep-agent-service/tests/test_native_factory.py apps/deep-agent-service/tests/test_graph_selector.py -q --timeout=60`: 31 passed, 1 skipped. Publish tests exercise actual HTTP and official StateGraph/ToolNode sync and async ToolRuntime injection. The existing factory's owned-container test is explicitly skipped without its opt-in environment; no claimed container evidence for this run.
- `pnpm --filter @repo/contracts exec vitest run tests/native-artifact-schema.test.ts`: 1 passed, shared/generated freshness.
- `pnpm --filter @repo/api typecheck`: passed.

The first attempted test command was refused by the repository isolation gate before collecting tests. It is not counted as a red behavioral test. A later official ToolNode direct-call test failed because it omitted the required graph runtime; enclosing the node in official StateGraph fixed the test harness, with no product bypass.

## Tenant discovery and custody regression

Both new migrations put `org_id` on its own column line, so the existing migration scanner discovers both tenant tables: `node apps/api/scripts/lint-permission-paths.mjs` reports `tenant-tables=201`, `allowlisted=91`. No allowlist entry or placeholder guard was added.

`node --test apps/api/scripts/tests/workbench-repository-boundary.test.mjs`: 41 passed, including planted removal/reordering of authority before read, fake denial guard, wrong tenant parameters, missing parent predicate, forged binding/arguments, public listFiles exposure and recovery without fencing. The new repository's actual runtime authorization remains ToolExecutionAuthority and the existing tenant transaction; the structural checks are regression detection, not an authorization grant.

The existing `tests/capability/model/credential-never-echoed.test.ts` passed all 23 tests using a temporary config selecting only that purely static suite (no database setup). No scanner exemption was added. Native session tokens are a separate reversible custody class, AES-GCM bound to session/org/run/binding and disclosed only by the internal authenticated resolver; the model credential vault's one-way port remains unchanged. This scanner result does not by itself prove session custody: the owner authority/encryption/HTTP tests provide that evidence.

The temporary-config credential run above is supplementary only: it did not use the repository's normal isolation globalSetup. The coordinator will include `tests/capability/model/credential-never-echoed.test.ts` in the standard isolation-wrapper regression; that run is the acceptance evidence. Do not use the temporary configuration as a replacement for the standard gate.
