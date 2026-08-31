# 进度日志 — Sprint 01/23

## 当前已验证状态(唯一真相)
- 仓库根目录: /home/user/workspacex
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（本 sprint 唯一 feature F1682 已 passing）
- 当前 blocker: 无（PR #2421 待 coord-main review 合并）

## 会话记录
### 2026-08-31 01:31:22
- 本轮目标: issue #2417 生产回归后续——`PlanFirstToolChoiceMiddleware`（#2220 方案 B）
  第一版（PR #2410）只实现了同步 `wrap_model_call`，在 `deep-agent-service` 实际使用的
  `langgraph dev` 异步 runtime 下被框架直接 `NotImplementedError`，导致生产 100% 请求
  失败（真实容器日志实锤）。PR #2410 已被 PR #2423 紧急回滚。本 sprint 是同一个
  feature（F1682）的重做：补齐 `awrap_model_call`，同步 + 异步双路径验证。
- 已完成:
  - `harness.py` 重新引入 `PlanFirstToolChoiceMiddleware`，`wrap_model_call`（同步）与
    `awrap_model_call`（异步）都实现，共享 `_prepare_forced_request` 判断逻辑；两个入口
    各自的 try/except 降级路径（provider 拒绝具名 tool_choice 时退回不强制重试一次，
    放行 `GraphBubbleUp`）。
  - `graph.py` 重新从 `harness` 导入 `TASK_MODE_MARKER`。
  - `_scripted.py` 补上 `bind_tools`/`_generate` 的 tool_choice 捕获、显式 `_agenerate`、
    `reject_forced_tool_choice` 开关。
  - `test_tc6_task_mode_plan_first_forced_write_todos.py` 重写：同步/异步各一条强制生效
    测试、两条反证（无标记/工具未挂载）、同步/异步各一条 provider-reject 降级重试反证。
  - `test_harness.py` 恢复接线看守 + 两条多轮对话回归测试 + `TASK_MODE_MARKER` 跨语言
    一致性看守（指向新的 web 侧单一事实源 `apps/web/lib/copilotkit-v2-task-mode.ts`）。
  - web 侧 `applyTaskModePrefix()`（issue #2417 里确认的独立真 bug：任务模式前缀无幂等
    检查，会被拼两遍）+ 单测。
  - **控制变量验证**（两次）：①临时删除 `awrap_model_call` 方法体，确认新增的异步强制
    生效测试原样复现生产 `NotImplementedError`，其余同步测试仍绿；②临时去掉
    `awrap_model_call` 的 try/except 降级逻辑，确认新增的异步 provider-reject 反证会红。
    两次都在恢复修复后转绿——证明测试真的钉住了对应的 bug 形态，不是空转断言。
  - 重新登记 F1682（第一次登记随 PR #2410 一起被 PR #2423 revert 撤销）：`covers` 追加
    进已签核的 `contracts/plan-control/design-signoff.md`（三条件证据同第一次登记时的
    论证，未触发重签）。
- 运行过的验证:
  - `cd apps/deep-agent-service && uv run pytest tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py -q` → 7 passed
  - `cd apps/deep-agent-service && uv run pytest tests/test_harness.py -q` → 38 passed
  - `cd apps/deep-agent-service && uv run pytest tests/golden -q --deselect ...tc5...` → 15 passed, 1 deselected
  - `cd apps/web && pnpm exec vitest run tests/lib/copilotkit-v2-task-mode.test.ts` → 4 passed
  - `pnpm harness verify --sprint 01/23 --feature F1682` → passing（含 `pnpm -w run
    verify:quick` 基础验证，本次会话的沙箱容器手动起了 `dockerd` 后可用，268 个测试
    文件 / 2406 个用例全绿）
- 已记录证据: `phases/phase-01-run-a-project/sprints/sprint-23/evidence/F1682.verify.log`
- 提交记录: 见分支 `worker/claude-2417-taskmode-regression`；PR
  https://github.com/boardx/workspacex/pull/2421（`Refs #2417` `Refs #2220` `Refs #2410`
  `Refs #2423`——不用 `Closes #2417`，生产 100% 失败本身已由 PR #2423 回滚止血，本 PR
  是安全重新实现能力的后续工作，是否/何时关闭 #2417 留给 coord-main 判断）。
- 已知风险或未解决问题:
  - 真实模型在方案 A 提示词下的实际服从率、以及真实 devapp/`qwen-plus` 端点是否真的
    能正确处理具名 `tool_choice`，仍未在 devapp 用真实模型多轮验证过（本会话无 devapp
    访问权限/真实模型凭据）。
  - 任务模式标记仍是拼在消息正文里的固定中文前缀，没有跨 web→api→deep-agent-service
    的结构化字段——本 feature 有意不碰这条（范围裁剪见 F1682 notes），若要做需要新的
    design-delta。
- 下一步最佳动作: 等 PR #2421 CI 结果与 coord-main review；CI 绿后由 coord-main 判断
  是否合并、以及是否/何时关闭 #2417。合并后如有 devapp 访问权限，应实测任务模式多轮
  对话确认 write_todos 稳定被调用、且不再复现 `NotImplementedError`。
