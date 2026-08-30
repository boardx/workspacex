# 会话交接 — Sprint 01/23

## 当前已验证
- F1682（任务模式确定性强制 write_todos，issue #2220 方案 B）：`passing`。
  跑过 `tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py`、
  `tests/test_harness.py`、`tests/golden`（全体，deselect 需真 Postgres 的
  TC-5），以及 `pnpm harness verify --sprint 01/23 --feature F1682`。

## 本轮改动
- `apps/deep-agent-service/src/deep_agent_service/harness.py`：新增
  `PlanFirstToolChoiceMiddleware`，接进 `build_middleware()`。
- `apps/deep-agent-service/tests/golden/_scripted.py`：`ScriptedChatModel` 补
  `tool_choice` 捕获与如实模拟。
- 新增 `apps/deep-agent-service/tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py`。
- `apps/deep-agent-service/tests/test_harness.py`：新增接线看守。
- `phases/phase-01-run-a-project/feature_list.json`：新增 F1682（passing）。
- `phases/phase-01-run-a-project/contracts/plan-control/design-signoff.md`：
  `covers` 追加 F1682（三条件证据见文件内注释，未重签）。
- PR：https://github.com/boardx/workspacex/pull/2410（`Closes #2220` `Closes #2406`），
  已 `subscribe_pr_activity` 订阅其 CI/review 事件。

## 仍损坏或未验证
- 真实模型在方案 A（`SYSTEM_PROMPT` 提示词侧规则）下的实际服从率——需 devapp
  多轮真实模型实测，本会话没有 devapp 访问权限/真实模型凭据。
- 任务模式标记仍是拼在消息正文里的固定中文前缀，没有跨 web→api→
  deep-agent-service 的结构化字段——本 feature 有意不碰这条（范围裁剪见
  F1682 notes），若要做需要新的 design-delta。
- 本沙箱容器没有可用 Docker daemon，`pnpm -w run verify:quick` 依赖
  `WORKSPACEX_KEEP_TEST_STACK=1` 才能跑完（详见 progress.md「已知风险」一节）——
  下一个有真实 Docker 的环境应该能不加这个变量直接跑通，如果不能，说明这不只是
  沙箱限制，需要重新排查。

## 下一步最佳动作
- 盯 PR #2410 的 CI 结果（自建 runner 应该有真实 Docker，能验证不依赖
  `WORKSPACEX_KEEP_TEST_STACK` 也能过 verify:quick）与 coord-main 的 review。
- 不要在本 sprint 再开新 feature——F1682 是本 sprint 唯一目标，已完成。
- 合并后：如有 devapp 访问权限，实测任务模式多轮对话，在 #2220 补最终确认评论。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/23`
- 调试:`cd apps/deep-agent-service && uv run pytest tests/golden -k task_mode -v`
