# 用户访谈 Markdown 单源与原型补齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按八张原型补齐访谈列表和六阶段流程，使研究内容通过 Markdown 输入、传递、持久化和渲染。

**Architecture:** 复用现有 artifact 版本存储，新增研究文档契约及统一只读解析器，先增量迁移再切换消费者。页面按阶段拆分；权限、任务和引用关联保留独立元数据，不从模型正文推断。

**Tech Stack:** TypeScript、Zod、PostgreSQL、NestJS、Next.js、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-27-interview-markdown-source-design.md`

## Global Constraints

- Markdown 是研究正文唯一事实源；禁止独立编辑或双写 JSON 研究正文。
- 文档版本不可变；修改和重生成追加版本，失败保留片段和重试状态。
- 权限、组织、任务状态、稳定引用属于元数据，不受 Markdown 改写影响。
- 附件和头像保留原始资产；模型和 UI 不执行正文中的 HTML/SVG。
- 不删除旧表、不修改生产数据；兼容读取和回滚在切换前必须通过验证。
- 每个页面独立 route；进入工作台隐藏 Workspace 菜单，返回列表恢复。
- 一次交付一个可测试 feature/PR；不自动合并，不以 mock 验证代替真实模型验收。

## 2026-09-27 剩余工作核对

用户再次授权按计划完成，明确不创建新 worktree。沿用现有 `interview-seven-step-rebuild/workspacex`。

| 任务 | 实际状态 | 完成所需证据 |
| --- | --- | --- |
| 1 文档契约 | 已实现；PR #4375 已合入 main | 97 文件 / 946 测试；20 项推送前检查；两条 review 已修复 |
| 2 持久化迁移 | PR #4396 重跑成功，已由外部操作合入 main，提交 fac5bd068 | 69 文件 / 496 测试；迁移重放、权限 lint、typecheck；两条 review 已修复；CI 成功 |
| 3 模型/API/恢复 | 执行中：原文读写/确认 API、生成、截断保存、冲突和权限验证通过；同步 main 后全量 70 文件 / 505 项通过；链接正文误判与过期目标版本入模已修复，再次全量 505 项通过，API typecheck/lint 通过 | 真实模型、失败续跑、暂停与全量冲突测试；去掉旧 JSON 正文写入 |
| 4 导入/分析 UI | 未完成 | 文件/文本/语音恢复与真实分析，不以固定内容冒充模型结果 |
| 5 列表/Header/专家/问题 | 部分基础已存在，原型布局未完整补齐 | 独立路由、菜单恢复、专家库/弹窗、问题编辑，浏览器截图 |
| 6 执行/报告 | 部分旧能力存在，原型布局未完整补齐 | 进度、实时摘要、目录、导出末尾、分享权限 |
| 7 动态验收 | 未完成 | 八视图截图、真实 API/DB/模型、主链路及异常回归、最新 SHA PR 绿 |

交付顺序不变。基础实现本地全量验证通过后，允许在 CI 运行期间启动后继实现，不将此描述为 PR 已绿；同一 worktree 切换后继分支，后继 PR 标注依赖并避免重复基础 diff。不自动合并任何 PR。

2026-09-27 用户补充执行要求：优先连续完成整个重构，允许拆分多个 PR，不等待前置 PR 合并才开始后继实现。前置 CI 在开发调度中按预期通过处理，不阻塞后续开发；检查的真实状态仍须在交付时核实，不伪造通过证据。复用同一 worktree，以依赖分支承接已验证改动，逐 PR 标明实际范围、前置依赖与建议合并顺序。基础 Markdown 接口可独立提交；页面先接入该源接口，旧消费者切换与运行恢复继续作为后续明确交付项，不因为提前提交接口 PR 就标记全链路完成。

任务 3 增补文件说明：增加独立 Markdown reader port、租户适配器与授权用例，在复用原文存储校验的同时避免应用层直接查询数据库，以及避免向旧契约反向导入产生循环依赖。读取接口先授权，读取后再次检查可见性，正文仅通过 Guarded 披露。2026-09-27 focused HTTP 验收从缺失路由 404（RED）转为通过（GREEN），覆盖原文完整性与三个不可见目标；这不等同于任务 3 全链路完成。

## Review Focus

- Unicode、表格、代码块与 Markdown 特殊字符往返不丢失：任务 1、2。
- 用户改写引用或模拟标签不能获得真人证据审批：任务 1、3。
- 模型中断或并发修改不覆盖已保存回答：任务 3、7。
- 上传不支持的文件、拒绝麦克风授权有明确恢复入口：任务 4。
- 深链接刷新、未保存编辑及返回列表不丢内容：任务 5、7。

## Task 1：文档契约与只读投影

**Files:** 修改 `packages/contracts/src/interview.ts`；新增 `packages/contracts/src/interview-markdown.ts` 及 `packages/contracts/tests/interview-markdown.test.ts`；修改 `packages/contracts/src/index.ts`。

**Interfaces:** `InterviewMarkdownDocument` 包含 documentId、step、version、markdown、contentHash 和受控引用元数据；`parseInterviewMarkdown(document: InterviewMarkdownDocument): InterviewMarkdownProjection` 返回只读章节/条目/锚点，正文不另存。引用 ID 来自受控元数据，不能由模型创建授权。

- [ ] 写测试 `roundTripsMarkdownExactly`、`rejectsDuplicateAnchors`、`cannotPromoteSimulatedEvidenceByEditingText`；断言 Unicode/表格/代码块原文一致，重复锚点失败，证据资格不变。
- [ ] 执行 `pnpm --filter @repo/contracts exec vitest run tests/interview-markdown.test.ts`，确认新增接口不存在时失败。
- [ ] 实现契约与解析器；沿用现有 Markdown AST 工具，不添加第二套渲染器，定义无法解析内容的显式错误。
- [ ] 同命令跑绿，并运行 contracts typecheck；提交独立 commit。

## Task 2：可回滚的 Markdown 内容单源迁移

**Files:** 新增 `apps/api/migrations/20260927180000_interview_markdown_source.sql`、`apps/api/src/infrastructure/interview/interview-markdown-migration.ts`；修改 `pg-digital-interview-repository.ts`；测试 `apps/api/tests/itv/digital-interview-persistence.test.ts`、`digital-interview-workflow-migration.test.ts`。

**Interfaces:** `migrateInterviewMarkdown(interviewId: string): Promise<void>` 在现有租户会话中运行，使用任务 1 文档契约；仓储读取当前文档版本，旧字段只用于未迁移记录的确定性兼容读取。

- [ ] 写 `migrationIsIdempotent`、`markdownIsAuthoritativeAfterMigration`、`tenantCannotReadOtherTenantDocument`、`confirmedVersionIsImmutable`；迁移两次不重复，编辑旧正文不改变迁移后的读取，跨租户失败。
- [ ] 运行上述两个 API 测试文件，确认新断言失败。
- [ ] 复用 artifact 表与 org_id 隔离；为迁移来源/哈希添加必要元数据。保留旧表只读，不持续双写旧研究正文。
- [ ] 重跑测试及 `pnpm --filter @repo/api migrate:check`；提交 commit，记录回滚使用旧读取路径的边界。

## Task 3：模型、API 和执行恢复切换

**Files:** 修改 `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`、`pg-digital-interview-effects.ts`、`interview-run-answers.ts` 与现有 digital-interview controller；测试 `apps/api/tests/itv/digital-interview-controller.test.ts`、`digital-interview-runs.test.ts`、`digital-interview-report.test.ts`。

**Interfaces:** 现有确认/生成操作消费任务 1 文档与 expectedVersion，返回持久化后的文档视图。暂停沿用任务状态控制，停止后续问题调度；已在执行的调用结果按版本检查保存，不伪称已取消远端模型。

- [ ] 写 `modelConsumesConfirmedMarkdown`、`apiPreservesMarkdownBytes`、`partialFailureRetriesMissingAnswersOnly`、`pausePreventsNextQuestion`、`staleVersionCannotOverwrite`。
- [ ] 运行三个 focused API 文件，看到新断言失败。
- [ ] 模型输入/输出切换 Markdown，使用统一解析器生成只读页面投影；真实分析取代硬编码模板，失败时不伪造结果。
- [ ] 跑绿 API 测试、typecheck 和权限 lint；提交 commit。

## Task 4：导入需求与确认分析

**Files:** 新增 `apps/web/components/itv/interview-intake-step.tsx`、`interview-analysis-step.tsx`；修改 `digital-interview-workflow.tsx`；新增 `apps/web/tests/ui/interview-markdown-intake.test.tsx`。

**Interfaces:** 组件消费任务 3 文档视图及现有版本保护操作；附件通过仓库已有资产接口上传，提取文本形成 Markdown 并保留资产引用；录音复用已有转写能力。

- [ ] 写 `importsTextAsMarkdown`、`fileFailureKeepsDraft`、`microphoneDeniedCanUseText`、`analysisCardsReflectGeneratedDocument`，确认失败。
- [ ] 实现原型输入区/提示侧栏和分析卡片/AI 建议侧栏；仅展示真实支持的文件类型与大小限制，禁止承诺未接通格式。
- [ ] 执行 `pnpm --filter web exec vitest run tests/ui/interview-markdown-intake.test.tsx` 跑绿，提交 commit。

## Task 5：统一 Header、专家库和问题编辑

**Files:** 修改 `interview-workbench-header.tsx`、`interview-studio-home.tsx`、`digital-interview-workflow.tsx`；新增 `interview-experts-step.tsx`、`interview-outline-step.tsx`；修改 `apps/web/tests/ui/interview-setup-workflow.test.tsx`。

**Interfaces:** 阶段组件消费 Markdown 只读投影，编辑通过生成新 Markdown 版本提交；排序关联和专家头像沿用稳定 ID，不按显示名称绑定。

- [ ] 写 `timelineNavigatesExistingStageRoutes`、`backToListRestoresWorkspaceMenu`、`expertSearchFiltersDirectory`、`virtualExpertRequiresReviewBeforeSave`、`questionEditPreservesStableReference`、`dirtyNavigationWarns`，确认失败。
- [ ] 实现连线式六阶段 Header、列表卡片、专家库和已选侧栏、虚拟专家弹窗、专家侧栏与问题分组的编辑/增删/排序。
- [ ] 同一 UI 测试文件跑绿，运行 web typecheck/lint；提交 commit。

## Task 6：访谈仪表盘与报告文档界面

**Files:** 新增 `interview-runs-step.tsx`、`interview-report-step.tsx`；修改 `digital-interview-workflow.tsx`、`interview-report-markdown.tsx`；测试 `apps/web/tests/ui/interview-detail-report.test.tsx`、`apps/web/tests/lib/interview-report-export.test.ts`。

**Interfaces:** 任务 3 运行元数据驱动进度；实时摘要/报告正文来自当前 Markdown 文档。目录锚点与导出来自同一文档 AST。分享复用现有权限受控 artifact 分享，不创建公开绕权 URL。

- [ ] 写 `progressUsesPersistedAnswers`、`summaryKeepsExpertAttribution`、`reportTocMatchesHeadings`、`exportContainsFinalSection`、`shareCannotBypassPermission`，确认失败。
- [ ] 实现左专家进度/右实时摘要、暂停/继续与完成入口；报告目录＋文档、PDF/Word/分享，保留失败续生成及审批门禁。
- [ ] 两个 focused 测试文件跑绿，提交 commit。

## Task 7：真实动态验收与 PR 交付

**Files:** 扩展 `apps/web/e2e/digital-interview-research-quality.spec.ts`；新增 `docs/evidence/2026-09-27-interview-markdown-prototype.md`。

- [ ] 增加浏览器断言：六阶段深链接刷新、编辑恢复、模型部分失败后重试、返回列表菜单、报告末尾导出完整。新断言先在旧实现运行失败。
- [ ] 使用受控本地依赖栈验证真实 API/数据库，另跑真实模型链路；记录测试是否使用 mock，不混淆证据。
- [ ] 逐页在 1440px 桌面、768px 平板、375px 手机截图；包括列表、六阶段和虚拟专家弹窗。与用户八张原型逐项对照，不虚报“一比一”。
- [ ] 运行 `./init.sh`、受影响契约/API/UI 测试、typecheck/lint 和 Chromium E2E。失败先修复或明确基础环境阻塞，不以静态检查替代动态验收。
- [ ] 根据仓库规则关联 issue、提交各 feature PR 到 main；检查最新 SHA 的 CI、冲突及 review，修到可合并，不自动合并。
- [ ] 释放本任务依赖栈，记录迁移状态、已交付范围和剩余差距。

## 执行顺序与审阅

原生执行，先任务 1–3 打通单源，再任务 4–6 接页面，最后任务 7 验收。每个任务使用 TDD，保持独立可 review 的提交，不把整个系统一次推成不可回滚的大切换。实施前由用户审阅本计划；执行时先同步最新 main 并检查 scoped AGENTS、基础验证与 issue 状态。
