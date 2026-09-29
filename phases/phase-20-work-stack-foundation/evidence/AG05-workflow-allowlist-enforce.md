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
| `nt.sh pnpm --filter api exec vitest run tests/agent/workflow-allowlist-enforce.test.ts`（feature verification） | 0 | 19/19 passed |
| 反证：关掉网关分流（`if (false && …)`）后重跑同一文件 | 1 | 11 failed / 1 passed（仅接线断言通过） |
| `nt.sh pnpm exec vitest run tests/agent/ tests/agent-run/ tests/workflow/ tests/kernel/permission-propagation-six-paths.test.ts tests/contract-single-source.test.ts` | 0 | 96 files / 588 tests passed |
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
| deep-agent-service `pytest tests/test_start_workflow.py tests/test_escalate_matter.py tests/test_native_tool_dispatch.py tests/test_native_tool_admission.py tests/test_native_factory.py` | 0 | 59 passed, 1 skipped |
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
12. 缺工具调用 id ⇒ 如实拒绝；DB 状态机 `running → queued(edit)` 只放行 `start_workflow`。
13. 存储不支持结果交回 ⇒ 在 WF03 start **之前** 以 `KERNEL_UNAVAILABLE` 失败 run，不建实例。
14. 恢复（无回执，崩在 start 之前）⇒ 以 edit 交回服务端的 `refused(workflow_runtime_unavailable)`，模型自填的 `outcome` 被丢弃，不建实例。
15. 恢复（有回执，崩在 start 之后、交回之前）⇒ 只读查回 `started` + 同一 instanceId，实例数不变。
    回执只 begin 未 finalize ⇒ `workflow_start_unconfirmed`（不说「未发起」）。
16. 通用裁决通路 approve / edit、工具授权通路 once / run / forever 对待决的 `start_workflow` 一律 409，run 原样不动。

## 真实保证（「结果只由服务端算出」）

- 交给 `start_workflow` 工具体的 `outcome` 只有两个来源，都由服务端算出、都以 **edit resume** 交回：网关
  （`workflow-start-gate.ts`，经 WF03 `start`）与恢复路径（`pg-run-recovery.ts`，**只读**查 WF03 回执
  `start:<requestId>`，`requestId` 与网关同一派生 `agentWorkflowStartRequestId(runId, toolCallId)`，不做任何新提交）。
  交回的参数由 `workflowStartEditedArgs` 重建：只取解析过的 `workflowId` / `input`，模型参数里的 `outcome` 一律丢弃。
- 恢复路径的回答与事实一致：无回执（WF03 从未受理）⇒ `refused(workflow_runtime_unavailable)`「未创建实例」；回执已 finalize
  且带实例 ⇒ `started` + 该实例；已 finalize 的 WF03 拒绝 ⇒ 同一拒绝码；回执 begun / reconciled / unresolved（begin、建实例、
  finalize 是三个事务，途中断了）⇒ `refused(workflow_start_unconfirmed)`「无法确认实例是否已创建，请核对，不要重复发起」——
  绝不在可能已建实例时说「未发起」。
- 人不能替服务端编结果：`decideAgentRun` 对 `start_workflow` 只接受 `reject`，`decideToolPermission` 只接受 `deny`；
  web 审批面板对 `start_workflow` 只显示「拒绝」。
- 模型写不了 `outcome`：`tools.py` 以 `SkipJsonSchema` 把它排除在模型可见 schema 之外（pytest 断言）；即便盲填，上面三条保证它
  到不了工具体。（不用 `InjectedToolArg`：ToolNode 会把注入参数从 edit 后的 args 里剥掉，服务端结果也送不进去。）
  `native_profile_tools.json` 只含工具名与中断标志、不含参数 schema，无需重新生成。

## 顺带修复（被正向用例抓到）

`WorkflowRuntimeService.dispatch` 在 agent run 的租约 ALS 上下文里被调用时，后台实例推进继承了该 run 的租约围栏，
run 一结束实例的每个事务都抛 `agent_run_lease_lost`（实例永远停在 running）。现以 `withoutRunLease` 脱离该上下文。

## 与 feature notes 的偏差（需人类知悉）

notes 写「E3 断言：D002 请求 W027 被拒、W001 成功」。研究线 W001 目前不是 Runtime 内置 Definition（`builtInWorkflowDefinitions()`
只含 demo、W027–W032、W002；W001 走 CT03 的 `runResearchToBrief`），所以「W001 成功」在今天的运行时上不可能：本测试断言
W001 过白名单后由 WF03 如实返回 `workflow_not_found`；正向「建实例并运行」改由 D003→W027 证明。W001 进入运行时注册表后，
把该断言改为 `status: "started"`。

## 评审

- 第 1 轮（rev-feature，SHA `9220b5a2f`）：ACCEPT，8 条 minor/nit。已修：②迁移边收窄到 `pending_tool_name='start_workflow'`
  （+DB 反证用例）；③缺 toolCallId 时拒绝而非用 workflowId 兜底（+用例）；④存储不支持结果交回时按稳定码失败 run 而非静默挂起；
  另补恢复路径（不叫醒人、approve ⇒「未发起」）与通用裁决通路拒绝伪造 edit 两条用例。①记录于本节。⑤⑥⑦⑧为可选/后续。
- 第 2 轮（SHA `60bb64b3d`）：REVISE。①恢复路径 approve 不诚实（崩在 start 之后会说「未发起」；approve 会回显模型自填的 outcome）
  ⇒ 恢复路径改为只读查 WF03 回执、以 edit 交回服务端结果（见「真实保证」），`ReconciledRemoteRun` 审批分支带 `toolCallId`；
  通用裁决通路只允许 reject、工具授权通路只允许 deny；`outcome` 移出模型可见 schema；回执未落定时如实「无法确认」；+用例 14/15/16。
  ②本文件与 `pg-run-recovery.ts` 注释改为上述真实保证。③能力检查挪到 WF03 start 之前，失败码改 `KERNEL_UNAVAILABLE`（+用例 13）。
  ④web 审批面板对 `start_workflow` 只给「拒绝」。⑤–⑧未改（可选/后续）。
