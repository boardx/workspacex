# 会话交接 — Sprint 01/19

## 当前已验证
- F970：`in_progress`（未能升为 `passing`——原因见下方「仍损坏或未验证」，不是本
  feature 自身代码或验证命令的问题）。owner: `dev-chat-e2e`。
  - F970 自身 5 条 verification 命令逐条真跑：
    `pnpm --filter api run typecheck` ✓ / `pnpm --filter web run typecheck` ✓ /
    `pnpm exec tsx .harness/scripts/cli.ts doctor` ✓（0 FAIL）/
    `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api run migrate:check` ✓ /
    `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash apps/api/scripts/verify-rls.sh` ✓。
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/tpl/`
    ✓（45 files / 385 tests，含 4 条新 lint-permission-paths guard 测试）。
  - `pnpm --filter api exec node scripts/lint-permission-paths.mjs` ✓
    （`scanned=997 tenant-tables=173 allowlisted=75`）。
  - evidence 见 `evidence/F970.verify.log`（`pnpm harness verify` 自动写入，
    含完整命令输出，包括下面这条卡住的 `verify:release`）。
- F966：`passing`（上一轮会话，未受本轮改动影响）。

## 本轮改动（issue #1667）
`templates.applyBlueprint`/`computeDeviations`/`submitBlueprintChangeRequest` 三个
契约 operation 补齐真实 controller + PG 仓储接线，此前应用层用例代码完整但零 HTTP
入口。完整文件清单与设计取舍见 `progress.md` 2026-08-21 那一节（较长，不重复抄一遍）。
概览：
- 新增 `ApplyBlueprintController`（`POST /blueprints/:blueprintId/apply`）、
  `BlueprintChangeRequestController`（`GET .../blueprint-deviations`、
  `POST .../blueprint-change-requests`、`GET /blueprints/:id/pending-changes`）。
- 新增 5 个 PG 仓储 + 2 个只读解析/列表端口，`kernel.module.ts` 完成 DI 注册。
- 2 条新迁移：`agenda_segments.duration` 放开 NOT NULL、`blueprint_bindings` 补两列、
  新表 `blueprint_pending_changes`。
- `apps/web/e2e/blueprint-contract-gap-audit.spec.ts`：F23/F29 两条用例从
  「断言 404」翻正为「套用/提回成功且刷新后仍在」。
- `packages/contracts/src/project.ts` `KNOWN_CONTRACT_GAPS.P10` 订正过期的
  「逐段时长无出处」半句。
- `phases/phase-01-run-a-project/feature_list.json` 新增 F970
  （`depends_on: [F23, F29]`，F23/F29 的 `status`/`passing` 一字未动）。
- `design-signoff.md`（templates 束）`covers:` 追加 F970（零新增设计面自查）。

## 仍损坏或未验证 —— **阻塞点与本 feature 无关，是仓库级已知缺口**
- F970 的 ADR-106 风险分档判定为 `high_risk`（触碰 `apps/api/migrations/**` 与
  `packages/contracts/**`），门控要求跑一次完整 `pnpm -w run verify:release`。
  该命令在**当前 `origin/main`（commit `b3deb4f487ba452821307b482fd1d681ea8196fe`）
  本身就是红的**，与本次改动无关：`lint-ui-material` 报 5 处「未声明」——
  `phase-10-live-collaboration-orchestration` 的 5 个契约束（group-checkin/
  module-routing/segment-engine/stage-aggregation/viewer-role）共用一个阶段级扁平
  `ui-preview/` 目录、彼此截图引用有重叠，而 `.harness/scripts/ui-material-map.json`
  的声明模型只支持「一束↔一个独占目录」，表达不了这种共用结构。
  - 这**不是新发现的问题**：issue #1690 已经登记过一模一样的现象与根因分析
    （"origin/main 上 lint-ui-material 现在就是红的，verify-control-plane 因此
    常红，拦所有人"），且给出了修法（给 map 加 `shared_dir` 概念）。
  - 该 issue **已被关闭，但没有任何评论、没有对应代码改动**——`lint-ui-material.mjs`
    与 `ui-material-map.json` 至今都没有 `shared_dir` 相关代码。这是「关了但没真修」
    的假阳性关闭，本会话实测复现，不是凭空怀疑。
  - 本会话没有去修它（不在 F970/templates 束的范围内，phase-10 是完全不相关的
    契约束，动它是越界重构）——已用 `spawn_task` 起了一个独立任务
    （task_id `task_1622b4e7`）建议重开 #1690 并真的实现 `shared_dir`。
  - **结论**：F970 的实现、迁移、RLS、typecheck、单测全部真实跑绿；唯一没能通过的
    是与本 feature 无关的仓库级基础设施红灯。按 AGENTS.md「没有引入新的失败」，
    这条红灯不是本次改动造成的，但按同一份文档「状态不能自己改」，本会话也不能
    绕过 `pnpm harness verify` 自己把 F970 标 passing——如实停在 `in_progress`，
    交给人类判断：是先合并本 PR（功能已验证真实可用）再补 #1690，还是先解 #1690
    再让 F970 走完门控。

## 下一步最佳动作
1. 人工审核 PR（`Closes #1667` + F970 对应 issue #1697）——功能本身已充分验证
   （5 条独立命令 + 385 条单测 + 迁移重放 + RLS 全绿），只差仓库级基础设施红灯。
2. 若要让 F970 走完 `pnpm harness verify` 拿到机械 `passing`：先处理 #1690
   （或认领 `task_1622b4e7` 那个建议任务），`lint-ui-material` 转绿后重跑
   `pnpm harness verify --sprint 01/19 --feature F970`。
3. `/project/new` 页面的蓝本选择入口接线留给 #1681（另一并行会话范围），
   本 feature 只保证后端真实可达。

## 命令
- 启动: `pnpm -w run dev`
- 验证: `pnpm harness verify --sprint 01/19 --feature F970`
- F970 目标命令单独复跑:
  `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/tpl/`
