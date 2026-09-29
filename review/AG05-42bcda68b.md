VERDICT: ACCEPT

Reviewer: rev-feature (independent; I did not write this code). This is round 3, at the exact SHA `42bcda68b` on branch `claude/tender-maxwell-dh21fg-ag05-fixes`. It is one commit on top of `origin/main` `0130fc49a`, which already contains AG05 (#4672).
Diff reviewed: `git diff 0130fc49a..42bcda68b` (11 files, +210/−46). Previous round: `review/AG05-60bb64b3d.md`, verdict REVISE.

## What I ran

- `pnpm install --frozen-lockfile`: 0.
- Feature test `pnpm --filter api exec vitest run tests/agent/workflow-allowlist-enforce.test.ts`: **19/19 passed** (39 s). It ran on native PG16 with pgvector and AGE installed from PGDG, using `WORKSPACEX_NATIVE_POSTGRES=1 PGPORT=5432 WORKSPACEX_DB=wsx_rev_ag05 WORKSPACEX_REUSE_INFRA=1`. The result matches the evidence file.
- Counter-check A: I made the recovery ignore the receipt (`if (!row || true)`) and let `decideAgentRun` accept approve again.
  - Result: **3 failed / 16 passed**: the crash-after-start case, the begun-receipt case, and the generic approve/grant case.
  - I then restored the code.
- Counter-check B: I checked out `pg-run-recovery.ts` and `workflow-start-gate.ts` from `0130fc49a`. That brings back the recovery approve and puts the capability check after the WF03 start.
  - Result: **4 failed / 15 passed**: all three recovery cases and the `KERNEL_UNAVAILABLE` case.
  - I then restored the code.
- `pnpm --filter api typecheck`: 0.
- `pnpm --filter api lint`: 0. This includes lint-arch-deps (1795 files, all dependencies point inward).
- `pnpm --filter web typecheck`: 0.
- `apps/deep-agent-service`, after `uv sync --frozen --all-extras`: `uv run pytest tests/test_start_workflow.py tests/test_native_tool_dispatch.py` gave **37 passed**.
  - Counter-check C: I replaced `SkipJsonSchema[dict | None]` with plain `dict | None`. `test_outcome_is_not_model_visible` then fails (1 failed / 3 passed). I restored it.
  - The edit-resume tests (`started` / `refused` outcome delivered through edit) still pass. So the hidden arg survives ToolNode: `args_schema` keeps `outcome`, and only `tool_call_schema` drops it.

## Round-2 fix status (truthfulness checked against the code, not just the tests)

| # | Status |
|---|---|
| ① Recovery approve was not truthful | **Fixed.** Details are listed after this table. |
| ② Evidence and comments overstated the guarantee | **Fixed**, with one gap in the web claim (finding 1). |
| ③ Capability check came after WF03 start | **Fixed.** The check now runs before `requestAgentWorkflowStart`. The failure code is `KERNEL_UNAVAILABLE`, and a test proves no instance is created. |
| ④ Approval card offered approve/edit for `start_workflow` | **Fixed** in `agent-approval-panel.tsx`. The workbench restore card was not changed (finding 1). |

How ① is fixed, and what I checked:
- `pg-run-recovery.ts:58-61` no longer approves. It calls `recoverAgentWorkflowStart`, which reads the receipt through `PgWorkflowReceiptStore.find`. That is a SELECT only; there is no begin or resolve.
- The key is `start:${agentWorkflowStartRequestId(run.id, toolCallId)}`. This is the same derivation the gate uses, and `startInstance` uses `start:${requestId}` at `instance-commands.ts:305`.
- The reconciler's approval branch really does carry `toolCallId`: see `deep-agent-model-provider.ts:1207`, which now matches the widened `ReconciledRemoteRun` type.
- `workflowStartEditedArgs` rebuilds the args from `parseWorkflowStartArgs`, so any model-supplied `outcome` is dropped.
- `decideAgentRun` accepts only reject, and `decideToolPermission` accepts only deny.
- If the requeue loses the race, the run falls back to `markAwaitingToolPermission`. A human there can only reject, so the fallback cannot approve.

The individual receipt cases, each checked for truthfulness:
- **No receipt ⇒ "未创建实例" is true.** `beginOrReplay` is the first write in `idempotent`, and `createPinnedInstance` runs strictly after it. The only things that run before begin are `resolveActor` and the zod parse, and neither of them creates anything.
- **Begun but not finalized ⇒ `workflow_start_unconfirmed`, which is correct.** Begin, instance creation, and finalize are separate transactions. `instance_id` on a begun row is always null, so recovery cannot know whether an instance exists, and it rightly says it cannot confirm.
- **Stored WF03 rejection ⇒ the same code.** The shape matches `StoredRejection` (`instance-commands.ts:106-113`), including `details.allowlistHint.handoffCandidates`.
- **Reconciled or unresolved ⇒ unconfirmed.** This is conservative and correct.
- **Race between a stale executor and recovery: no hole.**
  - `PgDatabase.inTx` checks run-lease ownership (`lease_epoch` + `FOR UPDATE`) in every transaction opened under `withRunLease`. See `pg-database.ts:67-73`.
  - Recovery bumps the epoch before it reads.
  - So a stale executor cannot begin a receipt or create an instance after recovery has answered "no receipt". Its later `requeueToolCallWithResult` also fails, both on the lease and on `status='running'`.

## Findings

1. **minor: the evidence overstates the web guard, and one approval surface still offers buttons that are bound to fail.**
   - Where: `apps/web/components/chat/workbench/restored-run-approval.tsx:237`, and the evidence file line 72, which says "web 审批面板对 `start_workflow` 只显示「拒绝」".
   - The problem:
     - `RestoredRunApproval` is used by `copilotkit-v2-panel-body.tsx` and by `copilotkit-v2-agent-interrupts.tsx`.
     - A pending `start_workflow` has no restorable interrupt, so this card renders the tool-permission card with once / run / always.
     - All three of those options now return 409.
     - This surface is only reachable when the recovery requeue loses a race, so it is rare.
   - Fix: either apply the same `rejectOnly` guard there (deny only), or narrow the evidence sentence to `AgentApprovalPanel`.
2. **minor: the stored-rejection branch of recovery has no test.**
   - Where: `apps/api/src/application/agent/request-agent-workflow-start.ts:206`.
   - The evidence says "已 finalize 的 WF03 拒绝 ⇒ 同一拒绝码", but none of cases 14–16 exercise it.
   - Fix: add a recovery case where WF03 has already finalized a rejection for the same requestId. For example, run `requestAgentWorkflowStart` with toolCallId X on a workflow that WF03 rejects, then `recoverAt(..., X, ...)`. Assert the same `code` and `handoffCandidates`, and that the instance count is unchanged.
3. **minor: the no-receipt branch misstates the cause.**
   - Where: `request-agent-workflow-start.ts:199`.
   - If the gate refused before WF03 was ever called (allowlist, `workflow_not_found`, missing requester), there is no receipt. Recovery then says "流程运行时暂不可用，未创建实例".
   - The claim about the instance is true. But the stated cause is wrong, and the handoff candidates are lost.
   - Optional fix: in the no-receipt branch, recompute the pure pre-WF03 checks from `readRunWorkflowContext`, `workflowAllowlistRefusal` and `contentWorkflowKeyOf`. These are read-only, with no submission. Return the same refusal the gate would have given, and fall back to `workflow_runtime_unavailable` only when those checks pass.
4. **carried, process (blocks `passing`, not this code review):** at this SHA `feature_list.json` still has `AG05.github_issue = null`.
   - Round-1 ① (the W001 deviation) and these review rounds still need to be recorded on the AG05 issue before `harness verify` (AGENTS.md DoD 5/7).
5. **carried (optional), unchanged:**
   - ⑥ A native-graph pytest for edit resume.
   - ⑦ Move the `start_workflow` name into contracts at the next re-sign. The web now duplicates the literal; this is acknowledged in the web comment.
   - ⑧ The workflow module imports `agent-run/run-lease`.

## Summary

The round-2 blocker is fixed properly.
- Recovery never approves `start_workflow`. It hands back a server-computed outcome from a read-only lookup of the WF03 receipt, using the gate's own `requestId` derivation.
- A begun-but-not-finalized receipt is reported as "无法确认", not as "未发起".
- The model cannot see `outcome`, and every path that could execute the model's own args is closed: recovery approve, generic approve/edit, and grant once/run/forever.

The guarantee holds under the stale-executor race because of the DB-level lease fence. Every new guard is covered by a test that fails when the guard is reverted. The remaining findings are minor: one evidence/UI overstatement, one untested branch, and one misstated refusal cause. None of them affects the "never claims not started when an instance may exist" guarantee.
