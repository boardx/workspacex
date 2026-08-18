# 会话交接 — Sprint 01/14

## 当前已验证
- F950：`passing`。14 条 verification 全绿，因触碰 `migrations/**`/`packages/contracts/**`
  被判 high_risk，`pnpm -w run verify:release`（全仓）也已跑绿。evidence 见
  `evidence/F950.verify.log`。
- F960：`passing`。4 条 verification 全绿，同样被判 high_risk 且 `verify:release` 已跑绿。
  evidence 见 `evidence/F960.verify.log`。

## 本轮改动
- 契约：`packages/contracts/src/templates.ts`（新增 `getProjectTopic`/`getProjectGrouping`，
  `Group` 加 `memberUserIds`）。
- 数据库：新迁移 `apps/api/migrations/20260816130000_f950_project_prep_topic_grouping.sql`
  （`project_topics` + `project_grouping_revision` 两张新表，`groups` 加两列，补装
  项目归档冻结 + 组织停用冻结两套既有策略）。
- 后端：`application/templates/{get-project-topic,get-project-grouping}.ts`（新）+
  `{project-prep,save-and-sync-topic,grouping}-ports.ts`（加 `orgId` 参数与新方法）+
  `save-and-sync-topic.ts`/`update-grouping.ts`（改用例签名）+
  `infrastructure/templates/pg-{project-topic,grouping,project-prep}-repository.ts`（新）+
  `interface/controllers/blueprint.controller.ts`（补 5 条路由）+ `kernel.module.ts`
  （3 个新 DI provider）+ `scripts/lint-permission-paths.mjs`（白名单 59→62）。
- 前端：`lib/live-project-prep.ts`（新）、`components/project/tab-prep.tsx`（定题/分组
  真实读写）、`components/project/project-workbench.tsx`（传参）。
- 顺带：`apps/web/next.config.mjs` + `.harness/state/rewrite-coverage-allowlist.json`
  两行修复（与独立 hotfix PR #1473 相同内容，见下）。
- （F960 追加）契约：`packages/contracts/src/templates.ts`（新增 `getInterviewSubjects`）。
- （F960 追加）数据库：新迁移 `apps/api/migrations/20260817090000_f960_interview_subjects_table.sql`
  （`project_group_interview_subjects` + `project_group_interview_subjects_revision` 两张
  新表，补装项目归档冻结 + 组织停用冻结两套既有策略）。
- （F960 追加）后端：`application/templates/{get-interview-subjects,interview-subjects-ports,
  update-interview-subjects}.ts`（新/改）+ `infrastructure/templates/
  pg-interview-subjects-repository.ts`（新）+ `interface/controllers/blueprint.controller.ts`
  （补 2 条路由）+ `kernel.module.ts`（1 个新 DI provider）+
  `scripts/lint-permission-paths.mjs`（白名单最终 60→64，本 sprint 两个 feature 共加了
  F950 的三条 + F960 的一条豁免）。
- （F960 追加）测试：`tests/tpl/{interview-subjects-repo-guard,interview-subjects-live}.test.ts`
  （新）+ `tests/tpl/interview-object-table-structure.test.ts`（改，补 `orgId`/`getSubjects`
  桩）+ `tests/kernel/permission-propagation-six-paths.test.ts`（上限最终 60→64）+
  `tests/templates/{create-blueprint-persistence,initialization-preview-persistence}.test.ts`
  （构造函数参数改动的连带修复）。
- （F960 追加）前端：**未动**——分组卡片本身仍是 mock groupId，真实 groupId 要靠本 sprint
  的 F950（`getProjectGrouping`）落地。访谈对象表嵌在组卡内，没有真实 groupId 就没法做出
  真实（非伪造）的前端接线——同 F175/BP-01「纯后端、界面留待后续」的先例，已在
  `feature_list.json` F960 notes ④ 如实记录，不是遗漏，留给下一个 feature。

## 仍损坏或未验证
- **hotfix PR #1473**（`fix(web): 补 /feedback rewrite + 清理已补好的 assets 棘轮豁免`）
  待人类审核合并——它修的是一个与本 feature 无关的基线问题（`lint:rewrite-coverage`
  在干净 main 上就是红的）。本分支已经把同样两行改动带进来了（否则本分支自己的
  high-risk 全仓验证也过不去），所以**不阻塞本 PR**，但两个 PR 谁先合入 main，
  另一个 rebase 时会看到同一份改动已存在（不是冲突，git 会正常识别为无操作）。
- `pg-grouping-repository.ts` 已知限制：组长/组员名单只更新已经在项目里的成员，
  不会把陌生用户静默拉进项目——不是 bug，是刻意不越权，但前端目前没有对这种情况
  做任何提示（提交显示成功，读回来这个人却不在名单里）。留给后续 feature 补一个
  「组员必须先是项目成员」的前置校验 + 契约码。
- 访谈对象（`InterviewSubject`）、议程三角色分工表、「现场协作」「成果沉淀」「待办」
  三个 tab 本次都没碰——后两类甚至连契约都还没有，之前的会话已经确认过这一点
  （见 `phases/phase-01-run-a-project` 更早的 codebase-researcher 报告）。

## 下一步最佳动作
- F950/F960 已合入本 sprint：下一步是把访谈对象表接进 `tab-prep.tsx` 组卡（六列可编辑
  表格 + 组件测试）——现在两个 feature 都已落地，`getProjectGrouping` 给出的真实
  `groupId` 已经可用，这是「先做完后端、再等前置依赖落地后一次性接前端」的直接延续，
  不是新裁决。其余 project 域候选：② PJ-12 蓝本发布版本端点（解锁新建项目真正套用
  蓝本，见 `new-project-flow.tsx` 头注 #991）；③「现场协作」/「成果沉淀」/「待办」——
  这三个连契约都没有，要做的话得先走完整的 requirements → 契约设计 → 人类签核流程，
  不是一次接线能解决的，跟本次/上次的规模不是一个量级。
- 不要动：`contracts/templates/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/14`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/tpl/<file>.test.ts`（DB 测试必须走隔离外壳，裸跑会报错并拒绝连共享库）
