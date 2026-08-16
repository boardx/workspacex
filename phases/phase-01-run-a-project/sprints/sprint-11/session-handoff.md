# 会话交接 — Sprint 01/11

## 当前已验证
- F185：`passing`。14 条 verification 全绿，另外因触碰 `migrations/**`/`packages/contracts/**` 被判定 high_risk，`pnpm -w run verify:release`（全仓）也已跑绿。evidence 见 `evidence/F185.verify.log`。

## 本轮改动
- 契约：`packages/contracts/src/project.ts`（`listProjects` 扁平化 + `tags` 字段 + 新增 `updateProjectTags`）。
- 数据库：新迁移 `apps/api/migrations/20260816000000_f185_project_tags.sql`（独立 `project_tags` 表，不是 `projects` 加列——见下方「仍需注意」）。
- 后端：`application/project/{list-projects,update-project-tags}.ts`、`application/project/ports.ts`、`infrastructure/project/{pg-project-list-repository,pg-project-tags-repository}.ts`、`interface/controllers/project.controller.ts`、`kernel.module.ts`、`scripts/lint-permission-paths.mjs`（白名单 56→57 条）。
- 前端：`components/projects/projects-screen.tsx`（重写）、`lib/live-projects.ts`、`app/project/live/page.tsx`、`components/canvas/template-apply-dialog.tsx`。
- 设计文档：`requirements/00-project/OPEN-QUESTIONS.md`、`contracts/project/{usecases,ui,design-signoff}.md`——记录 2026-08-16 人类在会话中直接推翻 2026-07-30 Q-6①B 的裁决过程，不是静默改设计。

## 仍损坏或未验证
- `contracts/project/ui.md` A 节 9 张两段式截图**过期未重拍**（已加提示，不影响本次 verify，但下次要重签第 ① 件材料时必须处理）。
- 全新 worktree 首次跑 `apps/api` typecheck 前必须先 `pnpm --filter @repo/fabric-markdown run build`，否则会看到 124 个无关的幽灵 DOM 类型错（`packages/fabric-markdown` 的 `types` 走 `dist/*.d.ts`，dist 不存在时 moduleResolution 会退回裸 src）。这是仓库既有的基线特性，不是本 feature 引入的红，`init.sh` 目前不会自动构建它——如果这拖慢了别人的 onboarding，值得开一个独立 issue 让 `init.sh` 或 `verify:base` 顺手 build 一次。

## 下一步最佳动作
- project 域下一个可做的 feature：①「编辑项目」多 tab 页把 mock 换成各自模块的真实数据源（研究洞察接 user research 模块列表等）；②新建项目套用已发布蓝本版本（PJ-12，依赖蓝本发布版本端点先落地，见 `new-project-flow.tsx` 头注 #991）。两者都不要塞进同一个 PR。
- 不要动：`contracts/project/design-signoff.md` 的 `status`/`confirmed_by`/`confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/11`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/project/<file>.test.ts`（DB 测试必须走隔离外壳，裸跑会报错并拒绝连共享库）
