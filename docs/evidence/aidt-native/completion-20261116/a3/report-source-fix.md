# 报告来源冻结修复

2026-11-16，root另派的来源错绑反例与最小修复。不修改前次设计签核、后端契约、权限或父级组件。

## 动态失败证据

`report-source-red.txt`（测试退出1）：服务器第5步V1，原报告正文只讨论prototype-v1且报告来源为`{stageId:5,revision:1}`。刷新将第5步当前表单正确更新为V2，旧报告文字仍保留。学生只加一行写作说明后保存，旧实现发出的报告来源却是`[{stageId:5,revision:2},{stageId:6,revision:3}]`。报告正文并未改为讨论V2。

`project-aidt.tsx`的`sourceRevision`只是本页draft revision计数，`AidtReportPreview`在计数不同时提示阶段变化；两者都不向保存hook传递固定来源。原hook在点击保存时依据**当前draft是否匹配当前服务器stage**计算refs，不能证明报告正文取自它们，故提醒不能防止错误回执。

## 最小保护

`use-aidt-shared-stages.ts`内为报告捕获来源快照，以已有editKey（项目/组织/账号/lifecycle generation）隔离：

- 自动组装预览（reportText为空）从当时真实匹配的已保存阶段捕获引用。
- 真实服务器报告hydrate/恢复使用其已保存来源；人工改写、历史章节追加和阶段刷新保留原来源。
- 学生明确用当前组装正文替换旧报告时，按新正文对应的当前草稿捕获新来源。历史追加后的正文不会因此变成当前自动组装稿。
- 来源未知的初始手写正文保留空来源；不从碰巧已加载的最新阶段推断来源。
- 冲突审阅仅改变保存CAS基准，不将对方报告来源嫁接到保留的学生正文。原文不自动改写、删除或后台保存。

首次来源、人工编辑、历史追加、主动重新整理、未知初稿和冲突后来源均有针对性断言。既有不确定失败重试复用operationId、保存中继续编辑、账号切换及只读回归保持通过。

## 旧修订契约核对

现有`apps/api/src/application/aidt-stages/service.ts`保存时对`summaryReport.sourceStageRevisions`逐项调用`tx.hasRevision(stageId,revision)`。现有PG实现查询`aidt_stage_revisions`，限定org/project/stage/revision，要求历史存在，**不限最新head**。

没有更改或绕过校验。已有后端单元测试“saves one editable stage-six report with actual source history including stage six”先保存第6步V1，然后报告V2/V3继续引用历史第6步V1，实际重跑通过（`report-source-api-existing.txt`）。该证据使用内存端口，不冒充真实PG回读；root负责真实服务器保存和重登录验收。

## 验证

- 真正失败反例：`report-source-red.txt`，退出1。
- 共享hook：`report-source-green.txt`，38项通过，退出0，1.29秒。
- 旧修订后端行为：`report-source-api-existing.txt`，1项通过，退出0，1.39秒。
- hook/对应tests定向ESLint：`report-source-eslint.txt`，退出0。
- 完整typecheck/build及真服务器保存→重登录由root统一跑；此worker没有发布、合并、GitHub外发或更改现有批准状态。

```bash
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/aidt-shared-stages.test.tsx --reporter verbose
pnpm --filter web exec eslint features/aidt/lib/use-aidt-shared-stages.ts tests/ui/aidt-shared-stages.test.tsx --max-warnings 0
pnpm --filter @repo/api exec vitest run --config vitest.aidt-stage-unit.config.ts tests/aidt-stages/shared-stage-unit.test.ts -t 'saves one editable stage-six report with actual source history' --reporter verbose
```

不能自动追溯或修复过去已经错误保存的来源；既有报告来源仍需学生依原稿与历史核对，不能靠文本猜出真实来源后改写服务器记录。
