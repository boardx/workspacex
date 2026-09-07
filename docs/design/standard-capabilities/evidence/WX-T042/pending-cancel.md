# Pending-only child cancellation (WX-T042)

`POST /agent-runs/:runId/subtask-runs/:id/cancel` uses the existing authenticated principal and `authorizeSubtaskParent(..., write:true)`. Invisible parent, wrong org and mismatched parent/child are 404. Observer and archived thread writes are 403. No internal-key endpoint, main-run state, provider cancellation or ready event is added.

Success is HTTP 200 with shared `CancelSubtaskRunResult`: `{subtaskRun: {..., status:"cancelled"}}`. Pending cancellation and repeated cancelled requests both succeed; repeats retain the original updatedAt. Running returns HTTP 409 with reasonCode `cancellation_not_supported_for_running`; completed/failed return HTTP 409 `terminal_conflict`. Only these shared schema enum values were added to the existing sanitized error-response whitelist. Cancelled remains terminal and is not retryable by the existing failed-only retry endpoint.

Postgres takes the matching org/parent/id row lock inside `withTenant` transaction, then changes pending to cancelled. Claim uses its existing row lock + SKIP LOCKED, so only cancellation or claim wins. Existing finish predicates still require running, preventing late completion/failure overwrites. The in-memory adapter matches these transitions. The new migration replaces only the status/result checks, can replay twice, and does not modify RLS/tenant/freeze policies.

Verification followed red→green: first two cancellation tests failed with `store.cancel is not a function` (tool session37781). Final standard isolation command:

```
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/agent-runtime/subtask-cancel.test.ts tests/agent-runtime/subtask-cancel-real-db.test.ts tests/agent-runtime/subtask-run-queue.test.ts tests/agent-runtime/subtask-run-store-real-db.test.ts
```

23 tests passed (4 files). Evidence `pending-cancel-tests.txt` includes actual output. Coverage: 12 concurrent claim/cancel races, duplicate cancellation, late finish, cross-org and parent mismatch, private owner/intruder real HTTP, observer and archived denial, running/failed HTTP reason codes, migration double replay with FORCE RLS/tenant policy retained, plus existing enqueue/idempotency/executor tests. API and web typecheck passed; corresponding logs retained. The test isolation wrapper completed cleanup; no owned stacks remain.

Necessary peer UI compatibility only: `apps/web/lib/mock/subtask-run.ts` gained cancelled label/tone, `apps/web/components/chat/subtask-run-panel.tsx` gained the Ban icon mapping. No buttons, layout or peer lifecycle behavior changed. Cancelled is inactive via the existing pending/running predicate and does not trigger completed notification.

This endpoint cancels one child only. Parent cancellation cascade and rejection of enqueue arriving after parent cancellation are not integrated; this delivery does not guarantee that all children stop starting after a parent cancellation.
