# 会话交接 — Sprint 01/14

## 当前已验证
- F960：`passing`。4 条 verification 全绿，因触碰 `migrations/**`/`packages/contracts/**`
  被判 high_risk，`pnpm -w run verify:release`（全仓）也已跑绿。evidence 见
  `evidence/F960.verify.log`。

## 本轮改动
- 契约：`packages/contracts/src/templates.ts`（新增 `getInterviewSubjects`）。
- 数据库：新迁移 `apps/api/migrations/20260817090000_f960_interview_subjects_table.sql`
  （`project_group_interview_subjects` + `project_group_interview_subjects_revision` 两张
  新表，补装项目归档冻结 + 组织停用冻结两套既有策略）。
- 后端：`application/templates/{get-interview-subjects,interview-subjects-ports,
  update-interview-subjects}.ts`（新/改）+ `infrastructure/templates/
  pg-interview-subjects-repository.ts`（新）+ `interface/controllers/blueprint.controller.ts`
  （补 2 条路由）+ `kernel.module.ts`（1 个新 DI provider）+
  `scripts/lint-permission-paths.mjs`（白名单 60→61）。
- 测试：`tests/tpl/{interview-subjects-repo-guard,interview-subjects-live}.test.ts`（新）+
  `tests/tpl/interview-object-table-structure.test.ts`（改，补 `orgId`/`getSubjects` 桩）+
  `tests/kernel/permission-propagation-six-paths.test.ts`（上限 60→61）+
  `tests/templates/{create-blueprint-persistence,initialization-preview-persistence}.test.ts`
  （构造函数参数改动的连带修复）。
- 前端：**未动**——见下方「仍损坏或未验证」。

## 仍损坏或未验证
- **前端 `tab-prep.tsx` 接线本次明确不做**：分组卡片本身仍是 mock groupId，真实
  groupId 要靠 F950（PR #1482，`getProjectGrouping`）先合入 main。访谈对象表嵌在组卡
  内，没有真实 groupId 就没法做出真实（非伪造）的前端接线——同 `design-signoff.md`
  里 F175/BP-01「纯后端、界面留待后续」的先例，已在 `feature_list.json` F960 notes ④
  如实记录，不是遗漏。
- PR #1482（F950）仍待人类合并，见其自己的 session-handoff。

## 下一步最佳动作
- F950 合并后：把访谈对象表接进 `tab-prep.tsx` 组卡（六列可编辑表格 + 组件测试），
  这是「先做完后端、再等前置依赖落地后一次性接前端」的直接延续，不是新裁决。
- 不要动：`contracts/templates/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/14`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/tpl/<file>.test.ts`（DB 测试必须走隔离外壳，裸跑会报错并拒绝连共享库）
