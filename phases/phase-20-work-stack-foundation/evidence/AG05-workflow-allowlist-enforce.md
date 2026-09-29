# AG05 —— Workflow 白名单执行校验：验证证据

分支 `claude/tender-maxwell-dh21fg-ag05v2`（基于 origin/main `73f3d4874`，#4667 之后）。2026-09-29。
所有 DB 相关命令经原生隔离跑法 `nt.sh`（每次一次性库，PG 16 :55432）在 `apps/api` 下执行。

## 做了什么（端到端）

Agent 在聊天 run 里调 `start_workflow({workflowId:"W0xx", input})`（deep-agent / native 两种 runtime 都注册，
`interrupt_on` 恒真）⇒ 内核在工具执行前中断 ⇒ `tool-permission-gate.ts` ⇒ `workflow-start-gate.ts` ⇒
`request-agent-workflow-start.ts`：读 **该 run 钉住的 Agent 版本快照** `workflow_allowlist`，未命中 ⇒
`workflow_not_allowed`（不建实例、不改走其它 Workflow）；命中 ⇒ 以请求人身份调用 **WF03 运行时单例**
`WorkflowRuntimeService.start`（`startInstance → runStartCore`：可见性 / 可运行 Agent / 已发布白名单 /
已发布版本 / Skill 版本固定 / 输入校验 / A1 幂等）⇒ 结果写 run 账本（审计）并以 edit resume 交回同一个工具调用，
工具体把中文结果句（「该角色不能发起此流程（W027）…」/「已发起流程 W027（实例 …）」）告诉 Agent。
没有新 HTTP 面、没有新契约面；唯一的状态机补丁是迁移 `20260929140000_ag05_tool_result_requeue.sql`
（`running → queued` 仅当 `pending_decision='edit'` 且带服务端结果参数）。

## 命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `nt.sh pnpm --filter api exec vitest run tests/agent/workflow-allowlist-enforce.test.ts`（feature verification） | 0 | 12/12 passed |
| 反证：关掉网关分流（`if (false && …)`）后重跑同一文件 | 1 | 11 failed / 1 passed（仅接线断言通过） |
| `nt.sh pnpm exec vitest run tests/agent/ tests/agent-run/ tests/workflow/ tests/kernel/permission-propagation-six-paths.test.ts tests/contract-single-source.test.ts` | 0 | 96 files / 581 tests passed |
| `pnpm --filter @repo/contracts typecheck` | 0 | |
| `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @repo/api typecheck` | 0 | |
| `pnpm --filter web typecheck` | 0 | |
| `pnpm --filter @repo/api lint`（error-leak / permission-paths / arch-deps …） | 0 | |
| `pnpm --filter web lint`（`next lint --max-warnings 0` + design） | 0 | |
| `node .harness/scripts/lint-contract-source.mjs` | 0 | |
| `node .harness/scripts/lint-ui-wiring.mjs` | 0 | |
| `nt.sh ./scripts/verify-migrations.sh` | 0 | rebuild from empty + replayable |
| `nt.sh ./scripts/verify-rls.sh` | 0 | RLS-ASSERT-OK |
| `pnpm --filter web exec vitest run tests/lib/chat-workbench/tool-label.test.ts` | 0 | |
| deep-agent-service `pytest tests/test_start_workflow.py tests/test_escalate_matter.py tests/test_native_tool_dispatch.py tests/test_native_tool_admission.py tests/test_native_factory.py` | 0 | 58 passed, 1 skipped |
| deep-agent-service `pytest tests --ignore=tests/golden` | 1 | 667 passed；3 failed = 需要 `DEEP_AGENT_TEST_POSTGRES_URL` 的 PG 恢复用例，main 基线同样失败（环境项，与本改动无关） |

## `workflow-allowlist-enforce.test.ts` 覆盖

1. 生产合成：`AGENT_RUN_EXECUTOR.workflowStarts === WORKFLOW_RUNTIME_SERVICE`（不是替身）。
2. 命中（D003→W027）：建 1 个实例（agent=D003、initiator=请求人、trigger manual），Skill 版本由 Workflow 固定
   （`S061@1.0.0` 等），实例真的在跑：首阶段执行到人工门 G1（`awaiting_gate_decision`，事件含 `gate_opened`）；审计行。
3. E3：D002→W027 ⇒ `workflow_not_allowed`，handoff `["D003","D011"]`，文案含「该角色不能发起此流程」且不含错误码；
   任何 Workflow 都无新实例；审计行。
4. E3：D002→W001（白名单内）⇒ 过白名单、交给 WF03 判定：本组织没有 W001 Definition（研究线 W001 不是 Runtime
   内置 Definition，见 CT03）⇒ 如实 `workflow_not_found`，不建实例。
5. 钉住快照 ≠ 头版本：钉 v1（无 W027）、头 v2 含 W027 ⇒ 仍拒绝。
6. WF03 同样把关：钉住快照含 W027、已发布版本不含 ⇒ Runtime `workflow_not_allowed`。
7. 未发布：W028 只有 Definition ⇒ `workflow_version_not_published`。
8. 无权限：请求人被移出组织 ⇒ WF03 准入拒绝；Agent 停用 ⇒ `workflow_not_allowed`。
9. 参数无效 / 用非内容线 key（`demo-brief`）绕白名单 ⇒ `trigger_input_invalid`。
10. 同一次工具调用重放 ⇒ WF03 A1 幂等，同一实例、实例数不变。
11. 运行时未接线 ⇒ 如实 `workflow_runtime_unavailable`，不建实例。

## 顺带修复（被正向用例抓到）

`WorkflowRuntimeService.dispatch` 在 agent run 的租约 ALS 上下文里被调用时，后台实例推进继承了该 run 的租约围栏，
run 一结束实例的每个事务都抛 `agent_run_lease_lost`（实例永远停在 running）。现以 `withoutRunLease` 脱离该上下文。
