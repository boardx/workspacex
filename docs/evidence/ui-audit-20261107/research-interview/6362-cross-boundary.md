# #6362 native report approval boundary evidence

A production report's missing `execute` grant must not become an unhandled ToolAuthorityError. The native authority bridge emits a recoverable approval interrupt. The host either applies its existing pinned-L0-document/strict-command inheritance or persists the exact pending call for user approval; report status retains the same job and run.

`apps/api/tests/fixtures/report-native-approval.json` is captured from the patched real `create_native_graph` + `Runtime`, using a scripted model, checkpoint memory saver, MemoryLedger, and controlled sandbox test transport. It contains the actual emitted values/updates/metadata SSE events and checkpoint action_requests/review_configs. No real report or user data is in the fixture. The command remains pending; it does not generate a PDF.

The native test regenerates that shape into a temporary file and checks its pending tool call and review payload against the API fixture. The API test sends those recorded SSE events through the real `DeepAgentModelProvider`, then passes its actual completion to `executeQueuedRuns`. It invokes the real `PgAgentRunRepository` writer method against a capturing DatabasePort and checks tenant/run/call ID/digest SQL parameters and the guarded running-to-awaiting/queued transition. Both missing provenance -> awaiting and pinned L0 PDF + allowlisted command -> exact-call requeue paths are covered, with no new grant.

ReportFileService separately verifies waiting then completion uses one job, one accepted run and one insertion. Existing ReportFileActions tests verify the chat approval link, no premature download, and rechecking the same job after approval.

## Reproduce

```sh
pnpm --dir apps/api exec vitest run --config vitest.report-approval-unit.config.ts
uv run --project apps/deep-agent-service pytest apps/deep-agent-service/tests/test_native_report_approval.py apps/deep-agent-service/tests/test_native_tool_authority.py apps/deep-agent-service/tests/test_native_tool_failure_reporting.py -q
pnpm --filter web exec vitest run tests/ui/report-file-actions.test.tsx
# Optional: recapture controlled native Runtime output into an explicit temporary destination.
uv run --project apps/deep-agent-service python apps/deep-agent-service/tests/export_report_approval_fixture.py /tmp/report-native-approval.json
```

Local evidence before integration: host security 24 pass; generated schema 1 pass; native authority/tool failure regression 42 pass, plus the new Runtime fixture check (native report file now 14 pass); cross-boundary selected cases 3 pass; existing report UI 17 pass. Two existing dependency deprecation warnings remain.

## Verification limits

DatabasePort captures real repository queries but is not PostgreSQL. No production permission was approved or modified. No real model, native-live sandbox, rendered PDF/Word, file download, or actual browser approval is proven. The service completion sample retains its existing fake validator and bytes; it proves job identity, not file validity. Full PG persistence/state-trigger and real PDF/Word export acceptance remain required beyond these checks. Parallel multiple pending approval recovery is not newly proven here.
