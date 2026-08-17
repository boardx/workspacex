# Coverage — Survey

> 第 ③ 件（API 契约）：`packages/contracts/src/survey.ts`。本表把问卷资源库、创建、工作台、发布、回收、报告和现场投票逐条映射到 API 契约或可执行门控。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | 问卷与模板资源库入口、卡片、筛选和返回路径 | `pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx tests/ui/survey-template-editor-shell.test.tsx` | F01 | 待生成 |
| V2 | 问卷/模板创建、名称标签、模板分类和从模板新建 | `pnpm --filter web exec vitest run tests/ui/survey-create-dialog.test.tsx tests/ui/survey-creation-draft.test.ts tests/ui/survey-template-editor-shell.test.tsx` | F02 | 待生成 |
| V3 | 五步工作台 URL、连续问题文档和连续报告文档 | `pnpm --filter web exec vitest run tests/ui/survey-workflow-shell.test.tsx tests/ui/survey-route-layout.test.tsx tests/ui/survey-continuous-document.test.tsx` | F03 | 待生成 |
| V4 | 状态机、发布门禁和匿名/实名属性不可变 | `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/anonymity-immutable.test.ts tests/survey/publish-gate-server-enforced.test.ts` | F04 | 待生成 |
| V5 | 发放链接、催填名单、回收进度和 responses/schema 文件对 | `pnpm --filter api exec vitest run tests/survey/nudge-roster-two-entries-same-service.test.ts tests/survey/file-first-responses-schema-pair.test.ts` | F05 | 待生成 |
| V6 | 分析报告章节、图表类型、样本量和题目来源 | `pnpm --filter @repo/contracts exec vitest run tests/survey.test.ts` | F06 | 待生成 |
| V7 | 现场快速投票倒计时、匿名口径和证据回流 | `pnpm --filter api exec vitest run tests/survey/vote-anonymous-timer.test.ts tests/survey/vote-flow-back-node-report.test.ts` | F07 | 待生成 |

| Feature | Requirement |
| --- | --- |
| F01 | `00-overview.md#R3` |
| F02 | `00-overview.md#R4` |
| F03 | `00-overview.md#R5` |
| F04 | `00-overview.md#R6` |
| F05 | `00-overview.md#R7` |
| F06 | `00-overview.md#R7` |
| F07 | `00-overview.md#R8` |
