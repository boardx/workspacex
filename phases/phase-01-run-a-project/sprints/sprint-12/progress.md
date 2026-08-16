# 进度日志 — Sprint 01/12

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyangjun/boardx/workspacex/.worktrees/coord-deep-research-langgraph-workflow`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F195 / Guided Research LangGraph 持久化基础与单页工作流投影
- 当前 blocker: 无

## 会话记录
### 2026-08-16 07:21:47
- 本轮目标: 交付 F195 的 LangGraph 持久化基础与单页工作流投影。
- 已完成: 人类签核已确认；创建 Sprint 01/12；harness sync 投影 Issue #1432；F195 已由 `coord-deep-research` 认领。
- 运行过的验证: `pnpm harness doctor --phase 01`（认领前基线）；GitHub issue 与 active feature 状态只读核对。
- 已记录证据: https://github.com/boardx/workspacex/issues/1432
- 提交记录: 待提交。
- 已知风险或未解决问题: 实现尚未开始；必须先 rebase 最新 `origin/main`，再按 RED→GREEN 顺序推进。
- 下一步最佳动作: 写共享契约失败测试，确认 RED 后实现最小契约与 Graph state。

### 2026-08-16 21:26:00
- 本轮目标: 按 F195A/B/C/D 拆分推进 Guided Research LangGraph 持久化、brief→directions、directions→outline 与前端单页状态同步。
- 已完成: F195A/B/C/D 均已落地到当前 worktree；新增统一 workflow API、node command receipt、LangGraph state/checkpoint、qwen3.7-plus 结构化 directions/outline generator、前端 workflow client 与无刷新步骤同步。
- 运行过的验证:
  - `pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts`（13 tests ✅）
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-workflow-command.test.ts tests/research/guided-session-list-and-recovery.test.ts`（11 tests ✅）
  - `cd apps/deep-agent-service && uv run pytest tests/test_guided_research_graph.py`（5 tests ✅）
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- zsh -lc '... GUIDED_RESEARCH_TEST_POSTGRES_URL=... uv run pytest tests/test_guided_research_postgres_recovery.py'`（1 test ✅）
  - `pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-visual-contract.test.tsx`（32 tests ✅）
  - `pnpm --filter web run typecheck`（exit 0 ✅）
  - `node apps/api/scripts/lint-permission-paths.mjs`（exit 0 ✅）
  - `node .harness/scripts/lint-arch-deps.mjs`（exit 0 ✅）
- 已记录证据: 本文件；F195 `feature_list.json.evidence`；Issue #1432 尚需评论同步。
- 提交记录: 待提交。
- 已知风险或未解决问题:
  - `pnpm harness tick` / 子 session tick 因 `COORD_GATEWAY_URL 未配置` 失败，未接入权威时钟。
  - `pnpm --filter api run typecheck` 当前被 `packages/fabric-markdown` 缺 DOM lib 的既有错误阻塞，非本轮 F195 research/API 文件；未顺手修无关模块。
  - 真实 qwen3.7-plus 环境变量/API key 未验证；当前模型路径以 fake provider 覆盖结构化解析与持久化。
  - F195 仍为 `in_progress`，未跑 `pnpm harness verify`，未标 passing，未提交/PR/merge。
- 21:26 后补充: `guided_research_node_receipts` SQL 已从 application service 下沉到 infrastructure repository，permission lint 与 arch deps lint 已通过；API F195+F168 11 tests 已复跑通过。
- 下一步最佳动作: 同步 Issue #1432 进展证据，处理全局 typecheck/环境阻塞后跑 `pnpm harness verify --sprint 01/12`，再按规范提交 PR。
