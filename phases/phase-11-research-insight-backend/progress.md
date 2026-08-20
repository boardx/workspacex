# 进度日志 — Phase 11 research-insight-backend

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyanbin/Documents/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F01 洞察写路径真实持久化（sprint 11/01，实现已提交 PR，待 `pnpm harness verify` 门控转 passing）
- 当前 blocker: 无

## 会话记录
### 2026-08-20 00:06:17
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-08-20（dev-chat-e2e worker，issue #1628）
- 本轮目标: 实现 F01（extractQuotes / generateCandidateInsights / confirmInsight 三个算子真正接线到 Postgres，持久化洞察写路径）。
- 已完成: 新增 `interview_quotes` / `interview_insight_source_snapshots` / `interview_insights` 三张持久化表（RLS）；application handler（`extract-quotes.ts` / `generate-candidate-insights.ts` / `confirm-insight.ts`）复用 `domain/interview/candidate-insight.ts` 既有纯逻辑；infra 层（`pg-segment-reader.ts` / `pg-interview-quote-repository.ts` / `pg-interview-insight-repository.ts` / `pg-consent-decline-reader.ts` / `context-api-insight-material-reader.ts` / `in-memory-insight-candidate-store.ts` / `heuristic-candidate-insight-generator.ts`）；`interview-insight.controller.ts` 三条路由；`kernel.module.ts` 完成 DI 接线；`lint-permission-paths.mjs` 新增 4 条白名单条目 + 配套 `insight-segment-reader-repo-guard.test.ts` 机械断言授权前置关系。
- 运行过的验证:
  - `pnpm --filter api exec vitest run tests/itv/insight-write-path-persists-real-db.test.ts`（5/5 通过）
  - `pnpm --filter api exec vitest run tests/itv/insight-pinned-snapshot-immutable-real-db.test.ts`（1/1 通过）
  - `pnpm --filter api exec vitest run tests/itv/`（55 files / 415 tests，全绿，干净 DB）
  - `node scripts/lint-permission-paths.mjs`（绿，allowlisted=71）
  - `pnpm exec tsc --noEmit`（无新增错误，仅 fabric-markdown 既有的 dist-未构建噪音）
- 已记录证据: 见 issue #1628 评论；PR 见下方提交记录。
- 提交记录: 分支 `worker/w-insight-01-f01-insight-write-path`，commit `feat(itv): F01 洞察写路径真实持久化`，PR `Closes #1628`。
- 已知风险或未解决问题:
  1. **本阶段目录（phase.md/feature_list.json/sprints/…）此前只存在于共享 checkout 的未提交工作区，本 worktree 与 origin/main 上都没有** —— 本轮把它原样带进本 PR 一并提交，否则 F01 的 issue 链接、`pnpm harness verify --sprint 11/01` 门控都无法在这条分支上运作。后续若共享 checkout 那份被提交到别的分支，需要人工核对两份是否分叉。
  2. `generateCandidateInsights` 的候选归纳器是确定性启发式（按 `rqId` 分组），不是真实模型调用——如实登记，非本 feature 缺陷。
  3. `pg-interview-insight-repository.ts` 的 `getById` 目前没有任何 controller 调用它（只在测试里核对写入结果）；F02 落地 `getEvidenceMatrix` 读路径时若把它接到真实读接口，必须改走 `guard()`/`discloseDecided()`。
- 下一步最佳动作: F02（`getEvidenceMatrix` 读路径 + 观察者脱敏）——依赖 F01 的持久化表已就绪。
