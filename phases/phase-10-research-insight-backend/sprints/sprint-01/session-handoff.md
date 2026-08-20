# 会话交接 — Sprint 10/01

## 当前已验证
- F01：实现完成，两条 verification 测试本地全绿（真实 Postgres，非 mock）；`pnpm harness verify --sprint 10/01` 尚未跑（需人类/下一轮 agent 在 main 分支或经 harness 门控转 passing，本 worker 不许手改 status）。

## 本轮改动
- `apps/api/migrations/20260820090000_f01_insight_write_path.sql`
- `apps/api/src/application/interview/{extract-quotes,generate-candidate-insights,confirm-insight,insight-ports}.ts`
- `apps/api/src/application/interview/errors.ts`（新增 4 类）
- `apps/api/src/infrastructure/interview/{pg-segment-reader,pg-interview-quote-repository,pg-interview-insight-repository,pg-consent-decline-reader,context-api-insight-material-reader,in-memory-insight-candidate-store,heuristic-candidate-insight-generator}.ts`
- `apps/api/src/interface/controllers/interview-insight.controller.ts`
- `apps/api/src/kernel.module.ts`（DI 接线）
- `apps/api/scripts/lint-permission-paths.mjs`（白名单 +4）
- `apps/api/tests/itv/{insight-write-path-persists-real-db,insight-pinned-snapshot-immutable-real-db,insight-segment-reader-repo-guard}.test.ts`
- 本阶段目录（`phases/phase-10-research-insight-backend/**`）——此前只在共享 checkout 未提交，本轮带入版本控制，见阶段级 progress.md。

## 仍损坏或未验证
- F02–F05 尚未开始（均 `depends_on: ["F01"]`，`sprint: null`，未领取）。
- `getEvidenceMatrix`（F02）落地前，`pg-interview-insight-repository.ts` 的 `getById` 不得被 controller 直接暴露成通用读接口——需改走 `guard()`/`discloseDecided()`，本 PR 的 lint 白名单条目明确写了这条边界。
- `generateCandidateInsights` 的候选归纳目前是确定性启发式（按 rqId 分组），F02+ 若需要更真实的语义聚类需另立 feature，不在本仓当前范围内假装已解决。

## 下一步最佳动作
- 跑 `pnpm harness verify --sprint 10/01`，确认 F01 转 passing。
- 之后开 F02（`getEvidenceMatrix` 读路径 + 观察者脱敏），复用 `domain/interview/evidence-matrix.ts` 既有纯逻辑，不要重写。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 10/01`
- 调试:`WORKSPACEX_DB=<你的库名> pnpm --filter api exec vitest run tests/itv/insight-write-path-persists-real-db.test.ts`
