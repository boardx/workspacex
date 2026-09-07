# T021/T040/T041 native entry integration

Cloud patch component results alone do not establish a reachable production capability. Local registration red evidence shows the admitted tools absent; the factory now registers all three shared tools only when their names appear in the persisted native policy snapshot. wx_run_status is L0, download grant issuance and cancellation remain L2. All three gateway error classes are excluded from native retries; actual official graph tests prove unknown outcomes dispatch once.

Python tests use actual loopback HTTP to verify trusted callback org/run/attempt/epoch, actual ToolRuntime call id, strict rejection of model identity fields, and no redirect following. No external model is called by these tests.

## Existing mechanisms reused

- T040 reads existing readAgentRun and then applies existing getArtifact version/source visibility to every candidate artifact. A run's visibility alone does not authorize all artifact versions produced by it. Current resolveVisibility and discloseDecided protect returned references.
- All three internal controllers use AuthorizedNativeEntryScope → withAuthorizedStandardToolRun to verify the current human requester, current thread visibility, actual attempt/epoch and tool authority. No model identity fields are accepted.
- T041 calls existing cancelAgentRun and ParentRunControl. The durable parent cancellation is the linearization point; child propagation reports the existing confirmed/pending/unavailable state. This is not a new cancellation engine or a claim that remote cancellation is atomic. Existing parent row/store arbitration prevents later child admission and result publication. The input reason/key are passed as real toolArgs to the existing authority; this adapter does not separately persist them or claim a new audit record. The key is not a new receipt ledger: existing target run cancellation is already idempotent.
- T021 reuses download_grants, token hashing, subject binding, expiry, atomic consume and provenance. AgentArtifactDeliverySource adds only an existing Agent artifact/attachment/staging source resolver. It requires the selected version to pass getArtifact and exact org/run/storage key to match persisted staging SHA256, attachment MIME/size and version size. Missing hash/source is refused.
- Issuance checks existing ObjectIntegrityChecker. Agent redemption resolves current source visibility again inside the same PgDatabase tenant transaction as consume, reads actual stored bytes and verifies SHA256/size before committing provenance/consumption. Any failure rolls consumption back.
- `/downloads/:token` returns attachment bytes for the newly supported Agent artifact domain. Existing file-domain JSON redemption remains compatible. The existing download_grants table gains source_kind=file|agent (legacy default file), so a deleted Agent version can never downgrade into a generic JSON success. No new public route, duplicate grant table or unexpired attachment link was added; the existing isolated URL builder remains authoritative.

## Evidence so far

- native-registration-red.txt: admitted registration fails before wiring (1 fail/1 pass).
- python-green.txt: 11 passed including actual HTTP and official graph no-replay tests.
- contracts-green.txt: 3 passed.
- permission-green.txt: tenant permission lint passes, 208 tables, no new allowlist.

Actual production HTTP/PG results and resource cleanup must be appended after execution. The PG integration fixture supplies fixed bytes at the session read boundary; staging, immutable ObjectStore persistence, writeback, current authorization and download HTTP are real. This fixture does not claim actual model or browser execution.

Initial production PG attempt: 27 existing component/file tests passed; the new HTTP suite failed in setup before its five then-defined behavioral tests. The test had seeded a tool_call rather than the real context_built attempt anchor; actual authority correctly refused staging. This fixture was corrected to use the current attempt/lease protocol, with no production authority relaxation. The initial failure is retained in pg-initial.txt.

## Final local acceptance

Standard command (actual `createApp`, real PostgreSQL app role, real filesystem ObjectStore):

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-standard-entries-http.test.ts tests/agent-runtime/native-run-artifact-visibility.test.ts tests/agent-runtime/native-standard-entry-policy.test.ts tests/agent-runtime/workbench-standard-artifact-download.test.ts tests/agent-runtime/workbench-standard-run-status.test.ts tests/agent-runtime/workbench-standard-run-cancel.test.ts tests/files/download-url-short-lived-onetime.test.ts
```

Result: **35 passed / 7 files**, exit 0, 11 seconds, peak four DB connections. `pg-green.txt` includes expected HTTP denial logs (403/404/409/410/422); these are asserted counterexamples, not unresolved failures. Wrapper 51256 cleaned its database stack and the test removed its own filesystem directory. The DB slot was handed to the retrieval worker; no owned DB/sandbox/model process remains.

The seven new HTTP tests exercise real staging→writeback→download bytes, independent per-artifact visibility, stale attempt/epoch/org denial, principal binding, concurrent one-winner consumption, current-source revocation with rollback, expiry, corruption with rollback, the legacy file-domain JSON branch, migration replay twice preserving Agent tags, missing Agent version rejection, an adversarial cross-org grant referencing the same version id, and existing queued-parent/pending-child cancellation (repeated stop, late enqueue and late result refusal). Version deletion is deliberately simulated by test-owner DDL within the isolated DB; production immutability permissions are not relaxed.

No claim is made that the three operations form a new globally atomic control system. Parent cancellation uses its existing durable row arbitration and child propagation outcome; native unknown errors remain non-retryable. Source resolution and consumption share the existing PgDatabase tenant transaction; denied or corrupt Agent redemption never commits token consumption. Source-domain identity is persisted in the existing grant row to prevent deletion from changing the redemption path.
