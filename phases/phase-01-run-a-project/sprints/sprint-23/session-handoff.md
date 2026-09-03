# 会话交接 — Sprint 01/23

## 当前已验证
- F1682（任务模式确定性强制 write_todos，issue #2220 方案 B，issue #2417 重做）：
  `passing`。跑过 `tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py`
  （同步+异步双路径）、`tests/test_harness.py`、`tests/golden`（全体，deselect 需真
  Postgres 的 TC-5），`apps/web` 的 `copilotkit-v2-task-mode.test.ts`，以及
  `pnpm harness verify --sprint 01/23 --feature F1682`（含 `verify:quick` 基础验证）。

## 本轮改动
- `apps/deep-agent-service/src/deep_agent_service/harness.py`：重新引入
  `PlanFirstToolChoiceMiddleware`，这次 `wrap_model_call`（同步）与 `awrap_model_call`
  （异步）都实现——issue #2417 的教训是只实现同步入口在 `langgraph dev` 异步 runtime
  下会被框架直接 `NotImplementedError`，不区分任务模式还是普通对话。
- `apps/deep-agent-service/src/deep_agent_service/graph.py`：重新从 `harness` 导入
  `TASK_MODE_MARKER`（单一事实源）。
- `apps/deep-agent-service/tests/golden/_scripted.py`：`ScriptedChatModel` 补
  `tool_choice` 捕获、显式 `_agenerate`、`reject_forced_tool_choice` 开关。
- `apps/deep-agent-service/tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py`：
  重写——强制生效/反证/provider-reject 降级重试三类场景，各自同步+异步都有测试。
- `apps/deep-agent-service/tests/test_harness.py`：恢复接线看守、两条多轮对话回归、
  `TASK_MODE_MARKER` 跨语言一致性看守（改指向 `apps/web/lib/copilotkit-v2-task-mode.ts`）。
- `apps/web/lib/copilotkit-v2-task-mode.ts`（新增）：`applyTaskModePrefix()`，issue
  #2417 里确认的独立真 bug（前缀无幂等检查）的单一事实源修复。
- `apps/web/components/chat/copilotkit-v2-panel-body.tsx`：`send()` 改用
  `applyTaskModePrefix()`。
- `phases/phase-01-run-a-project/feature_list.json`：重新登记 F1682（status: passing）。
- `phases/phase-01-run-a-project/contracts/plan-control/design-signoff.md`：`covers`
  重新追加 F1682（三条件证据见文件内注释，未重签）。
- PR：https://github.com/boardx/workspacex/pull/2421（`Refs #2417` `Refs #2220`
  `Refs #2410` `Refs #2423`），已 `subscribe_pr_activity` 订阅其 CI/review 事件。

## 仍损坏或未验证
- 真实模型在方案 A（`SYSTEM_PROMPT` 提示词侧规则）下的实际服从率、以及真实 devapp/
  `qwen-plus` 端点是否真的能正确处理具名 `tool_choice`——需 devapp 多轮真实模型实测，
  本会话没有 devapp 访问权限/真实模型凭据。
- 任务模式标记仍是拼在消息正文里的固定中文前缀，没有跨 web→api→deep-agent-service
  的结构化字段——本 feature 有意不碰这条（范围裁剪见 F1682 notes），若要做需要新的
  design-delta。

## 下一步最佳动作
- 盯 PR #2421 的 CI 结果与 coord-main 的 review（已有一轮 exact-SHA review BLOCK，
  已按其反馈补了异步 provider-reject 反证与本次的正式 feature 登记）。
- 不要在本 sprint 再开新 feature——F1682 是本 sprint 唯一目标，已完成。
- 合并后：如有 devapp 访问权限，实测任务模式多轮对话，确认 write_todos 稳定被调用、
  且不再复现 `NotImplementedError`，在 issue #2417 补最终确认评论，由 coord-main 判断
  是否/何时关闭该 issue。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/23`
- 调试:`cd apps/deep-agent-service && uv run pytest tests/golden -k task_mode -v`
