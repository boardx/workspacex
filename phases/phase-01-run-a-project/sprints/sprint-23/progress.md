# 进度日志 — Sprint 01/23

## 当前已验证状态(唯一真相)
- 仓库根目录: /home/user/workspacex
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（本 sprint 唯一 feature F1682 已 passing）
- 当前 blocker: 无（PR #2410 待 coord-main review 合并）

## 会话记录
### 2026-08-30 20:22:13
- 本轮目标: issue #2220（任务模式六态面板永远空账本）方案 B——deep-agent-service 用
  `tool_choice` 确定性强制 `write_todos`，补齐方案 A（提示词侧）之外不依赖模型服从
  概率的保证。
- 已完成:
  - `harness.py` 新增 `PlanFirstToolChoiceMiddleware`（三条件命中时
    `request.override(tool_choice="write_todos")`），接进 `build_middleware()`。
  - `_scripted.py` 的 `ScriptedChatModel` 补上 `tool_choice` 捕获 + 如实模拟（对
    TC1-5 零影响）。
  - 新增 golden TC-6（`test_tc6_task_mode_plan_first_forced_write_todos.py`）：
    "不合作"假模型 + 两条反证（无标记不强制 / 工具未挂载不强行指向）。
  - `test_harness.py` 新增接线看守。
  - 注册正式 feature F1682，`covers` 追加进已签核的
    `contracts/plan-control/design-signoff.md`（三条件证据见该文件注释）。
- 运行过的验证:
  - `cd apps/deep-agent-service && uv run pytest tests/golden/test_tc6_task_mode_plan_first_forced_write_todos.py -q` → 3 passed
  - `cd apps/deep-agent-service && uv run pytest tests/test_harness.py -q` → 35 passed
  - `cd apps/deep-agent-service && uv run pytest tests/golden -q --deselect ...tc5...` → 45 passed
  - `pnpm harness verify --sprint 01/23 --feature F1682` → passing（`WORKSPACEX_KEEP_TEST_STACK=1`，见下方已知风险）
- 已记录证据: `phases/phase-01-run-a-project/sprints/sprint-23/evidence/F1682.verify.log`
- 提交记录: `48f1bac`（实现+测试+登记）、`598b2fc`（verify→passing+证据）；分支
  `claude/task-mode-testing-evaluation-824p8e`；PR
  https://github.com/boardx/workspacex/pull/2410（`Closes #2220` `Closes #2406`）。
- 已知风险或未解决问题:
  - 本会话所在的 Claude Code Remote 沙箱容器没有可用 Docker daemon（`dockerd`
    因 `ulimit` 权限被拒无法启动）——`pnpm -w run verify:quick` 的
    `docker compose down -v` 清理步骤因此恒失败（0 个 JS/TS 包受影响，同样的失败
    在干净的 `origin/main` 上一样复现，已核实是沙箱环境限制不是回归）。本次验证
    加了仓库既有的 `WORKSPACEX_KEEP_TEST_STACK=1` 跳过这步清理才让 verify 跑完；
    CI 的真实 Docker runner 会独立复跑同一套检查，PR 描述里已如实说明。
  - 真实模型在方案 A 提示词下的实际服从率仍未在 devapp 用真实模型多轮验证过
    （本会话无 devapp 访问权限/真实模型凭据）——见 issue #2220 与本 sprint 的
    session-handoff.md。
- 下一步最佳动作: 等 PR #2410 CI 结果与 coord-main review；CI 绿后由 coord-main
  合并。合并后如有 devapp 访问权限，应实测任务模式多轮对话确认 write_todos 稳定
  被调用，并在 #2220 补一条最终确认评论后关闭该 issue（若本 PR 的 `Closes #2220`
  未自动关闭，需要人工核实原因）。
