# 进度日志 — Sprint 01/19

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F970（controller+infra 已写完，待 `pnpm harness verify` 门控转 passing）
- 当前 blocker: 无

## 会话记录
### 2026-08-21（issue #1667：F23/F29 契约缺口审计闭合——applyBlueprint/computeDeviations/submitBlueprintChangeRequest 补 controller+infra）
- 背景：issue #1667 勘探 + 人类第二条评论纠正：`templates.applyBlueprint`/
  `computeDeviations`/`submitBlueprintChangeRequest` 三个契约 operation 的应用层
  用例代码完整、单测齐全（F23/F29 早已标 passing），但零 controller、零 infra，
  用户实际不可达；`apps/web/e2e/blueprint-contract-gap-audit.spec.ts` 的两条
  「断言仍是 404」用例实测证实。P10 登记的「逐段时长无出处」已随 F202
  （2026-08-18 合入的「流程 Agenda」结构化面板）落地过期——人类裁决直接读
  `flow-agenda` facet 的真实 `min`，未填=空，不编造默认值。
- 本轮目标（新建 feature F970，`depends_on: [F23, F29]`，不改 F23/F29 的 status）：
  1. `applyBlueprint` 六类初始化写入时从 `flow-agenda` facet 读真实时长。
  2. 真实 `ApplyBlueprintRepository` PG 实现 + `POST /blueprints/:blueprintId/apply` 路由。
  3. `submitBlueprintChangeRequest`/`computeDeviations` 的 schema+infra+controller。
  4. e2e spec 里 F23/F29 的「404 缺口断言」改写成正向断言。
  5. 顺带订正 P10 的登记状态。
- 已完成:
  - `apps/api/src/domain/templates/flow-agenda-durations.ts`：解析 `flow-agenda`
    facet 的 `parseFlowAgendaDurations`（未填/解析失败一律 `null`，不编默认值）。
  - `apps/api/src/application/templates/apply-blueprint.ts`/`apply-blueprint-ports.ts`：
    新增 `flowAgendaContent` 输入（调用方从已解析的 `resolvedVersion.content` 派生，
    用例本身仍不读 `BlueprintVersion.content`）+ `AppliedAgendaSegmentRef.durationMinutes`。
  - `apps/api/src/application/templates/apply-blueprint-resolver-ports.ts` +
    `pg-apply-blueprint-resolver.ts`：只读解析端口（存在性/可见性/目标版本/档位/
    flow-agenda 内容），与写端口分离（`ApplyBlueprintRepository` 方法集合恒
    `{apply}` 的既有白名单不动）。
  - `pg-apply-blueprint-repository.ts`：写路径。复用既有 `PROJECT_REPOSITORY`
    （不新开第二个 `INSERT INTO projects`），再写 `blueprint_bindings.project_id`/
    `version_id`（本次迁移新增两列）+ `agenda_segments`（真实议程环节行，
    `duration` 现在可为 `NULL`）。⚠ 已知登记缺口：项目创建与 agenda_segments
    写入是两个事务，不是严格意义的单事务原子性——见该文件头注，超出本 issue 范围。
  - `apps/api/src/interface/controllers/apply-blueprint.controller.ts`：
    `POST /blueprints/:blueprintId/apply`。
  - `pg-compute-deviations-repository.ts`：diff 基准读 `blueprint_bindings`/
    `blueprint_versions`；当前值对 `flow-agenda` 一项读真实 `agenda_segments`，
    其余各项项目侧尚无独立编辑存储，如实原样返回快照值（不产生偏离）。
  - `submit-change-request-ports.ts`/`submit-blueprint-change-request.ts`：
    `create()` 补 `orgId` 参数（原签名缺失，真实 PG 实现落地时才发现租户隔离
    离不开它）。`pg-submit-change-request-repository.ts` 写路径。
  - `list-pending-changes-ports.ts` + `pg-list-pending-changes-repository.ts`：
    `templates.listPendingChanges` 只读端口——让「提交回蓝本」的落库结果第一次
    能被读回来验证。
  - `apps/api/src/interface/controllers/blueprint-change-request.controller.ts`：
    `GET /projects/:projectId/blueprint-deviations`、
    `POST /projects/:projectId/blueprint-change-requests`、
    `GET /blueprints/:blueprintId/pending-changes`。
  - `apps/api/src/kernel.module.ts`：五个新 provider + 两个新 controller 注册。
  - 迁移 `20260821090000_i1667_apply_blueprint_infra.sql`：`agenda_segments.duration`
    放开 `NOT NULL`（CHECK 改为 `duration IS NULL OR duration > 0`）；
    `blueprint_bindings` 补 `project_id`/`version_id` 两列 + 索引；调用
    `kernel_apply_project_archive_policies()`（issue #342 教训：必须在新增列的
    同一迁移里调用，不能指望后面某个不相关迁移顺手调，否则强制重放会产出不同
    schema 摘要）。
  - 迁移 `20260821091500_i1667_blueprint_pending_changes.sql`：新表
    `blueprint_pending_changes`（RLS + 冻结策略）。
  - `apps/api/scripts/lint-permission-paths.mjs`：4 个新 pg-*.ts 文件加白名单条目
    （写路径/已授权后读路径，同 F117/F119/F124 先例），配 4 个新 guard 测试
    （`apps/api/tests/tpl/*-repo-guard.test.ts`）。
  - `packages/contracts/src/project.ts` `KNOWN_CONTRACT_GAPS.P10`：订正「逐段
    时长无出处」已随 F202+本次改动解决；`createProject`（BP-08）路径仍未变、
    仍是它自己的范围裁决，不是数据缺失问题。
  - `apps/web/e2e/blueprint-contract-gap-audit.spec.ts`：F23/F29 两条用例从
    「断言 404」改写为「套用/提回成功且刷新后仍在」正向断言（套用后真实建出项目、
    幂等重放同 id、六类恒 6 项、议程环节数=档位数；提回：真实读到 flow-agenda
    偏离、提交 201、`GET /pending-changes` 刷新后仍能读回，且不含内部 `status` 字段）。
  - `phases/phase-01-run-a-project/feature_list.json`：新增 F970
    （`depends_on: [F23, F29]`，未改 F23/F29 的 `status`/`passing`）。
  - `design-signoff.md`（templates 束）：`covers:` 追加 F970（零新增设计面自查）。
- 运行过的验证:
  - `pnpm --filter api run typecheck`（绿）、`pnpm --filter web run typecheck`（绿）、
    `pnpm --filter @repo/contracts run typecheck`（绿）。
  - `pnpm --filter api exec node scripts/lint-permission-paths.mjs`（绿，
    `scanned=997 tenant-tables=173 allowlisted=75`）。
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/tpl/`
    → 45 files / 385 tests 全绿（含 4 条新 guard 测试）。
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm run migrate:check`（apps/api）
    → 141 迁移，强制重放 schema 摘要一致。
  - `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash apps/api/scripts/verify-rls.sh`
    → 全绿（含 issue #342 的项目归档冻结覆盖检查）。
- 已知风险或未解决问题:
  - `PgApplyBlueprintRepository.apply()` 项目容器创建（复用 `ProjectRepository.create()`）
    与六类初始化的 `agenda_segments` 写入是**两个**事务，不是严格单事务——见该文件
    头注，已如实登记，非本 issue 范围内可解决（需要重构 `ProjectRepository` 接受
    外部 `TenantSession`）。
  - `computeDeviations` 除 `flow-agenda` 外的其余设计配置项，项目侧仍无独立于
    蓝本草稿的可编辑存储，恒无偏离——诚实空态，等 F24-F27 一类的项目侧配置编辑
    路径真正落地才会有数据。
  - GitHub issue 号原计划用 F967，`gh issue list` 实测该号已被另一并行分支占用
    （#1689，无关的 chat 图表功能），机械重编号为 F970（同 F964→F965 的先例）。
- 下一步最佳动作: `pnpm harness verify --sprint 01/19 --feature F970` → passing；
  PR 带 `Closes #1667` + F970 对应 issue 号；不合并，人工走 merge-gate。

### 2026-08-20（F965 已合入 main 后，用真栈截图验证保真度时发现真 bug）
- 背景：F965（成果沉淀 tab 成果去向/审计与反馈接真）已合入 main（PR #1633）。
  用真栈截图（`pnpm run shots:project-results`，复用 `playwright.fullstack-smoke.config.ts`）
  对齐已签核基线图时，发现「审计与反馈」区显示 404——诊断出 `next.config.mjs`
  从未给 `GET /provenance` 写 Next.js rewrite 规则（同 `/blueprints`/`/messages`
  注释描述的坑：F965 之前 `queryProvenance` 零真实调用方，这个路由缺口一直没被
  撞到）。该修复在 F965 合入时未及并入（另一并行分支先合并了 PR，见 issue #1627
  评论记录），本 sprint 补上。
- 本轮目标: F966 —— 补 `GET /provenance` 的 rewrite 缺口 + 真栈截图取证工具。
- 已完成:
  - `apps/web/next.config.mjs`：补一行 `/provenance` 裸路径 rewrite。
  - `apps/web/e2e/project-results-shots.spec.ts`：真栈截图取证 spec（零 expect，
    同 `chat-main-shots.spec.ts` 先例），登录 + 拍成果沉淀 tab default 与三个
    `?as=` 视角（因生产安全边界 R12 V8 三个视角截图与 default 像素级相同，已在
    文件头注如实记录，角色差异改由已通过的组件测试验证）。
  - `apps/web/playwright.fullstack-smoke.config.ts`：新增具名 project
    `project-results-shots`（`dependencies: ["seeded"]`，复用同一次起栈/种子，
    不是第二份栈定义；CI 的 `verify:fullstack-smoke` 只显式点
    `--project=seeded-github-import`，不会拉起这个新 project）。
  - `package.json`：新增 `shots:project-results` / `shots:project-results:raw`
    （同 `shots:chat-main` 模式）。
  - `.gitignore`：`.project-results-shots/` 过程物不进仓库（同 `.chat-shots/` 惯例）。
  - 设计签核：`design-signoff.md` 追加 F966 到 `covers:`（零新增设计面自查追加，
    这是最窄的一种——纯路由配置修复 + 零 expect 取证工具）。
- 运行过的验证:
  - `pnpm --filter web run typecheck`（绿）。
  - `pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`（绿）。
  - `pnpm run shots:project-results` 两轮真栈跑（修复前「审计与反馈」404；修复后
    变成真实、正确的 403 `PROJECT_ROLE_INSUFFICIENT`，38/38 全绿）。
  - `pnpm harness verify --sprint 01/19 --feature F966` → passing。
- 已记录证据: `evidence/F966.verify.log`。
- 提交记录: 分支 `worker/dev-project-01-provenance-rewrite-fix`。
- 已知风险或未解决问题:
  - **UIUX 保真度：8/10**（真栈截图，对照 `ui-preview/project-v2/uc-00-3-results-*.png`）。
    未到 9-10 分的两个缺口（证据缺口，非代码缺陷）：① `fullstack-smoke-fixture.ts`
    未给这个项目种 `backflow`/`provenance` 数据，两节拍到的是真实空态而非「有数据」
    的成功态；② 只拍了 default 一态，未覆盖完整七态矩阵。
  - **PR 流程教训**：F965 的原 PR #1633 在本会话仍在做真栈验证/发现 bug 期间被
    另一个并行分支/流程先合并了（squash，标题仍写 F964，实际内容已是重编号后的
    F965）——本会话后续的 404 修复未及赶上那次合并，因此拆成独立的 F966 补上。
    这提示：同一 feature 若有多个并行 agent/session 在处理，PR 合并时机可能早于
    「所有验证工作完成」，后续发现的问题需要拆成新 feature 补，而不是假设原 PR
    还能追加。
- 下一步最佳动作: 人工审核并合并本 PR；下一轮若要冲 UIUX 9-10 分，给
  `fullstack-smoke-fixture.ts` 补 backflow/provenance 种子数据 + 用
  `FULLSTACK_E2E.leadEmail` 登录补一张「审计与反馈有数据」的成功态截图。
