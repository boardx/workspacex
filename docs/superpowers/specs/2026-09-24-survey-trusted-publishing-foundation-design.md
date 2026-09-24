# Survey 可信发布底座设计

日期：2026-09-24
目标 feature：Phase 09 / F04
状态：待人类书面规格复核；本文件不改变束级 `design-signoff.md` 的人工签核状态

## 1. 背景与问题

当前 `/studio/survey` 已有持久化的 `survey_workspaces` JSON 聚合、`PgSurveyRepository`、`SurveyService`、`SurveyController`、`LiveSurveyWorkspace` 和 `survey-complete-flow.spec.ts`，已支持创建、保存、发布链接、答卷/附件、审阅、报告和模板。同仓仍保留 `createSurveyWorkflowMock()` 用于原型/单元测试，但生产路由 live stack 驱动。F04 的缺口不是“没有真实 API”，而是现有 `publication: null | {status: collecting | closed}` 模型没有显式 `draft | ready | collecting | closed` 状态、结构化全量发布门禁和创建后不可变的匿名性。因此现有链路还不能证明：

- 问卷状态跨刷新、跨入口和跨客户端一致；
- 非法状态回退会被服务端拒绝；
- 匿名性在创建后不可被静默修改；
- 绕过前端直接发布时仍执行全部质量检查；
- 发布失败不会产生部分状态或虚假的“已发布”结果。

竞品调研显示，AI 研究产品的差异化建立在动态追问、自动综合和多模态采集之上，但这些能力都依赖可信的研究对象版本、状态和证据边界。本 feature 先补齐发布底座，不在不可靠的数据模型上叠加 AI 能力。

## 2. 目标

F04 交付一个最小但真实的问卷发布闭环：

1. 问卷状态由服务端权威管理，合法状态为 `draft | ready | collecting | closed`。
2. 合法前进路径为 `draft → ready → collecting → closed`；`closed` 不可逆。
3. 只有 `ready → draft` 作为发布前撤回路径；`collecting → draft`、`closed → collecting` 等回退一律拒绝。
4. `anonymity` 在创建后不可修改，前端隐藏控件不能替代服务端校验。
5. 发布准备操作一次返回全部阻断项；存在任一阻断时，问卷仍保持 `draft`。
6. 前端发布步骤消费真实 API，并明确呈现加载、成功、阻断和系统错误状态。
7. 所有状态变更在单个事务内完成，失败不得留下部分写入。

## 3. 非目标

本 feature 不实现：

- 招募、配额、联系人导入和催办；
- 答卷提交、`responses.csv + schema.json` 物化；
- AI 动态追问、语音/视频访谈或合成用户；
- 自动分析、洞察库写入和报告生成；
- 现场快速投票；
- 问卷内容版本化的完整产品界面。

这些能力分别属于 F05–F07 或后续独立 feature。F04 只提供它们可依赖的权威状态与发布边界。

## 4. 方案比较与选择

### 方案 A：继续保留前端 mock，只增强界面提示

改动最小，但无法阻止直接请求绕过门禁，也无法建立持久化事实。它只能改善演示，不满足 F04。

### 方案 B：先做 AI 对话式问卷，再补状态和持久化

能快速展示差异化，但 AI 会生成无法可靠版本化、发布和审计的研究内容。后续返工面最大。

### 方案 C：先建立服务端状态机、不可变属性和发布门禁

这是选定方案。它优先修复当前最大的真实性缺口，并成为回收、证据溯源和 AI 研究能力的共同底座。

## 5. 架构边界

延续仓库现有洋葱结构，不创建第二套问卷系统：

- `packages/contracts/src/survey-runtime.ts` + `packages/contracts/src/survey.ts`：在保留现有 runtime 字段的前提下扩展跨端 DTO、枚举、命令结果和错误结构。
- `apps/api/src/domain/survey/`：纯状态转移、不可变属性和发布门禁规则；不得依赖 Nest、数据库或 HTTP。
- `apps/api/src/application/survey/survey-service.ts`：扩展现有创建、读取、保存、发布、回收、报告用例，不新建平行 service。
- `apps/api/src/infrastructure/survey/pg-survey-repository.ts`：沿用现有 `db.withTenant` + `FOR UPDATE` 事务边界，保留完整 `SurveyRecord`。
- `apps/api/src/interface/controllers/survey.controller.ts`：扩展已注册 controller 的命令与错误映射，不重复注册。
- `apps/web/lib/survey/runtime-client.ts` + `apps/web/components/survey/live/survey-workspace.tsx`：扩展现有真实 API 与五步 live UI，不改路由到 mock shell。

问卷权限必须复用现有 principal / organization 边界，不新建身份或权限模型。组织 ID 从已认证 principal 获得，不接受客户端自行提交并信任。

## 6. 领域模型

### Survey 聚合

F04 所需最小持久化字段：

- `id`
- `organization_id`
- `project_id | null`
- `title`
- `tags`
- `anonymity: anonymous | identified`
- `status: draft | ready | collecting | closed`
- `content_version`
- `created_at`
- `updated_at`
- `closed_at | null`

题目与报告章节沿用现有 Survey contract；实现可选择规范化表或同事务 JSON 文档，但对 application 层必须暴露同一个聚合接口。F04 不借机设计 F05 的答卷表。

### 状态转移

| 当前状态 | 命令 | 下一状态 | 结果 |
| --- | --- | --- | --- |
| `draft` | `prepare` 且无阻断 | `ready` | 成功 |
| `draft` | `prepare` 且有阻断 | `draft` | 返回全部阻断 |
| `ready` | `withdraw` | `draft` | 成功 |
| `ready` | `startCollection` | `collecting` | 成功 |
| `collecting` | `close` | `closed` | 成功 |
| 其他组合 | 任意不合法命令 | 不变 | `INVALID_TRANSITION` |

状态命令必须带 expected version，repository 用乐观并发控制更新；版本冲突返回 `SURVEY_VERSION_CONFLICT`，客户端重新读取后再决定操作，禁止最后写入者静默覆盖。

### 匿名性不变量

`anonymity` 只允许在创建命令中指定。任何通用 PATCH 出现该字段都返回 `ANONYMITY_IMMUTABLE`，即使新值与旧值相同也不得把它当成可写字段，以免 API 语义暗示未来可以修改。

## 7. 发布门禁

`prepare` 在服务端读取同一问卷版本并执行全部检查。第一阶段至少覆盖：

- `QUESTIONS_EMPTY`：没有题目；
- `QUESTION_OPTIONS_EMPTY`：非开放题缺少选项，返回题目 ID；
- `MAPPING_INCOMPLETE`：题目未映射报告章节或章节没有有效供料，返回 side、对象 ID 与缺失字段；
- `LEADING_QUESTION`：命中已确认的诱导性题目规则，返回题目 ID。

返回顺序必须稳定：先按门禁类型，再按题目或章节的稳定 ID 排序。前端不得依赖自然语言文案判断类型。

门禁读取和 `draft → ready` 更新必须处于同一事务并校验 `content_version`。若检查后内容已变化，返回版本冲突，不得把旧版本的检查结果应用到新内容。

## 8. HTTP 契约

具体路径遵循现有 controller 命名习惯，语义如下：

- `POST /surveys`：创建 `draft` 问卷并固定 anonymity。
- `GET /surveys/:surveyId`：读取当前聚合和版本。
- `PATCH /surveys/:surveyId`：编辑草稿元数据或内容；拒绝 anonymity 与直接写 status。
- `POST /surveys/:surveyId/prepare`：运行全部门禁；成功进入 `ready`，否则返回结构化阻断集合。
- `POST /surveys/:surveyId/withdraw`：`ready → draft`。
- `POST /surveys/:surveyId/start-collection`：`ready → collecting`。
- `POST /surveys/:surveyId/close`：`collecting → closed`。

状态不能通过通用 PATCH 修改。命令响应统一返回最新 `survey`、`version` 和 `blockers`。业务拒绝使用稳定错误码；500 响应只返回通用文案，详细错误写服务端日志。

建议的失败映射：

- `400`：请求结构非法；
- `401/403`：未认证或越权；
- `404`：问卷不存在或对当前组织不可见；
- `409`：非法状态转移、版本冲突、匿名性修改；
- `422`：发布门禁未通过，携带全部 blockers；
- `500`：未预期系统错误。

## 9. 前端数据流

`SurveyWorkflowShell` 根据 `surveyId` 加载真实模型：

1. 初始加载显示已有稳定 loading 状态。
2. 成功后以服务端模型为单一状态源；派生指标仍通过纯 selector 计算。
3. 保存内容时提交 expected version；冲突时保留本地编辑并提示重新加载，不静默覆盖。
4. 发布步骤调用 `prepare`，把一次返回的全部 blockers 显示在现有发布检查区域。
5. 只有服务端返回 `ready` 后才显示准备完成；只有 `collecting` 才显示正在回收。
6. 网络或系统错误使用现有 error/retry 模式，不把失败误呈现为业务阻断。

原型/单元测试 fixture 可以继续使用 `createSurveyWorkflowMock()`；生产路由继续由 `LiveSurveyWorkspace` 和 `surveyRequest` 驱动。F04 只在这条 live stack 上增量迁移，不建第二个 hook/client/workspace。

## 10. 数据迁移与兼容

- 保留现有 `survey_workspaces` 及 `(org_id, id)` 主键/RLS，不新建平行问卷表。
- 对旧 JSON 聚合做兼容读取：`publication: null` 投影为 `draft`，已发布聚合投影为 `collecting/closed`；新写入再固化显式状态与匿名性。
- 迁移前后必须保留 publication token/snapshot、responses/receipts、attachments、report provenance 和 templates。
- 旧 URL `/studio/survey/:surveyId?step=...` 保持不变。
- API 上线前前端可以在受控开发开关下使用 fixture adapter；合并完成标准要求默认路径已切到真实 API。

## 11. 可观测性与安全

每次状态命令记录结构化事件：组织、问卷 ID、旧状态、新状态、命令、actor、content version、结果码和耗时。日志不得记录答卷正文或未来可能出现的身份答案。

关键计数器：

- 发布准备成功/阻断/系统失败次数；
- 各 blocker 类型数量；
- 非法状态转移次数；
- 版本冲突次数。

跨组织读取与写入必须在 repository 查询条件中强制隔离，不能先按 ID 读取后只在 controller 内判断。

## 12. 测试策略

实现前先补齐并确认以下 verification 为红：

1. `state-machine-four.test.ts`
   - 覆盖全部合法路径；
   - 覆盖 `collecting → draft`、`closed → collecting` 和 closed 后所有写命令；
   - 断言拒绝后数据库状态与版本不变。
2. `anonymity-immutable.test.ts`
   - anonymous → identified 与 identified → anonymous 均拒绝；
   - 直接 HTTP PATCH 与 application use case 结果一致；
   - 跨组织访问不可观察资源存在性。
3. `publish-gate-server-enforced.test.ts`
   - 绕过前端直接请求仍执行门禁；
   - 一次返回全部 blockers 且顺序稳定；
   - 有阻断时仍为 draft；
   - 修复后进入 ready；
   - 并发修改导致版本冲突，不发布旧版本。
4. Web 集成测试
   - 发布步骤调用真实 client；
   - 业务阻断与系统错误视觉语义不同；
   - 不根据本地预测显示已发布。
5. 基础回归
   - 现有 79 项问卷前端测试继续通过；
   - `pnpm -w run verify:base` 通过。

最终 verification 仍以 Phase 09 F04 的 feature 定义和 `pnpm harness verify --sprint ... --feature F04` 为权威；本设计不能替代机械门控。

## 13. 交付顺序

1. 完成 Phase 09 Survey 束的 UI、用例、API 三项人工签核及阶段一致性复核。
2. 将 F04 领入独立 sprint，`harness sync --apply` 建立 GitHub issue。
3. 创建独立 worker 分支与 worktree，先提交失败 verification。
4. 先锁定现有 live stack 回归，再增量迁移 contract、domain、`SurveyService`、`PgSurveyRepository` 和已注册 controller。
5. 扩展 `LiveSurveyWorkspace` 的发布步骤，保留答卷、附件、报告和模板回归。
6. 运行 F04 verification、基础回归和真实浏览器发布失败/成功链路。
7. 浏览器链路验证通过前不得创建 PR；验证失败时继续修复并重跑。
8. 落盘 evidence，创建只关闭该 issue、以 `main` 为 base 的 PR，并负责到 CI 全绿和合入 main。

## 14. 后续演进

F04 合入后才开始 F05 的发放、催办和答卷文件化。AI 动态追问应作为独立 feature，并满足：研究目标约束、明确 AI 身份、追问次数/结束条件、原始回答保留、结论来源可回溯、人工确认和失败降级。这样既吸收 AI Research 竞品的优势，又不牺牲当前仓库要求的证据与治理边界。
