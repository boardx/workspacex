# 02 · 能力映射：每一步复用本仓的哪条既有能力

原则：**这个 Agent 是既有能力的一次装配，不是一套新栈**。下表每一行的"复用"列是现状锚点，
"需要新增"列才是本阶段真正要写的代码。契约字段一律以 `packages/contracts/src` 为唯一事实源。

> Phase 16（`/agent/team1`）已经把公开 Agent 路由、材料包、带定位解析、HITL 关口、
> 产出物出处链这条底座打通。**本阶段的"需要新增"应先去 Phase 16 的实现里 grep，
> 能复用就复用**，凡两阶段都要的东西一律下沉为共享实现，不许各写一份（本仓已五次因
> "同一事实声明在两处"漂移）。

| 交互步骤（见 01） | 复用的既有能力 | 需要新增 |
|---|---|---|
| 0 落地页 / 会话 | 公开 Agent 路由 `apps/web/app/agent/[teamId]`（Phase 16 建成；slug 名单单源 `apps/web/lib/mock/agent-previews.ts` → 偿还路径是改从 `packages/contracts` 生成）；Agent 定义与运行时（`agent-runtime.ts`：Agent 版本、`SkillMount`、三层权限、`effective-permission`）；私聊会话语义与 `NOT_VISIBLE`（`agent-private-chat.ts`）；聊天 UI（`apps/web/app/chat`，模块 `mod-chat`） | `team4` 的 Agent 定义与落地页文案（读定义，不另存副本）；首轮"需要哪几类材料"的引导 |
| 1 上传材料包 | 附件上传端点与**已签核的容量/白名单单源**（`chat-file-upload.ts`：`ATTACHMENT_LIMITS`、MIME 白名单，含 PDF/Office/CSV/图片）；文件域契约 `files.ts`；材料包实体（Phase 16） | 材料包条目的**期间标签**（`2025H1`/`2025Q2`）与按期间对齐的校验；"材料齐了"确认动作 |
| 2 解析与财务抽取 | `wx_document_parse`（`standard-document-tools.ts`）：pdfplumber / python-docx / python-pptx / openpyxl 原生结构化，产出带 `pageNumber`/`bbox`/`tableId`/`sheetName`/`address` 的定位 chunk；OCR 分支（tesseract，含逐词 bbox 与置信度） | **财务指标抽取 schema**（`03` B 节指标 ↔ 支撑 chunk）与同比/环比/周转天数的确定性计算（**算式在代码里算，不让模型心算**） |
| 3 外部公开信息检索 | 标准 Web 工具（`standard-web-tools.ts`）与浏览器工具（`standard-browser-tools.ts`）；**已知坑**：要打开具体 URL 时由 middleware 确定性选择 `browser_navigate`，不要让模型在 fetch 与 navigate 之间反复（mod-agent-skill-runtime 2026-09-13 经验） | 外部事实的"来源标题 + URL + 获取时间"字段与分栏渲染；渠道不可达时的**降级为未取证**的显式状态 |
| 4 可比公司对比 | 同上 + 检索/索引与上下文装配（`retrieval-indexing.ts` / `retrieval-embedding.ts` / `retrieval-rerank.ts`、`context-pack.ts`）；`wx_knowledge_search` / `wx_knowledge_read` | 对标口径 schema（可比公司选取理由 / 口径年度 / 指标定义 / 偏离幅度） |
| 5 政策与风险窗口 | 子任务工具（`standard-subtask-tools.ts` / `subtask-run.ts`）逐规则并行核查；计划模式与权限（`plan-control.ts`、`plan-permissions.ts`） | **风险窗口时间轴** schema（事件 / 时点 / 触发条件 / 影响），报告与 UI 共用一份 |
| 6 交叉验证与风险分类 | 同上子任务并行 | 交叉验证规则集（`03` D 节）与「显性 / 隐性 / 跨文件关联」三分类输出 schema |
| 7 第一次交付 | 产出物与产出物引导（`artifact.ts`、`artifacts-steering.ts`、`native-artifact-publish.ts`：`wx_artifact_publish`） | 三栏（分析底稿 / 外部对标 / 风险清单）+ **数据来源清单**产出物视图 |
| 8-9 人工确认①② | 既有人在环路关口（`deep-agent-hitl.ts`、`agent-interrupts.ts`、`run-control.ts`）—— 这正是"审批型中断"该用的通道，不要另造一个确认弹窗 | 确认/驳回/补充/存疑与风险分级的结构化裁决 payload，以及裁决对后续轮次的约束（resume 分支必须转发，见下方"已知坑"） |
| 10-11 定向深挖 | 子任务并行、`wx_document_parse` 二次定向解析、`standard-sql.ts`（对已入库表做加总/账龄/跑道重算，**只读**）、记忆（`standard-memory.ts`） | 重算算式的"输入出处 + 算式 + 结果"三元组 schema；现金跑道测算器 |
| 12 报告与归档 | `wx_artifact_publish` / `wx_artifact_download`（`standard-artifact-download.ts`）；模板域（`templates.ts`）；出处链（`provenance.ts`、`execution-journal.ts`，四要素 `agentVersion`/`skillVersion`/`modelId`/`permissionSnapshot`） | 投后报告模板（`03` F 节章节）与归档动作；报告头的运行出处渲染 |
| 13 闭环沉淀 | `standard-memory.ts`（`wx_memory_*`）、`skill-activity.ts`、`feedback-loop.ts` | 人工修订 → 规则/检索策略优化的回流记录（只写方法论，不写敏感明细） |
| 贯穿 · 运行观测 | `standard-run-status.ts`（`wx_run_status`）、`standard-run-cancel.ts`（`wx_run_cancel`）、`error-observability.ts`、`streaming-transport.ts` | 逐步骤状态行 UI（可复用 Phase 16） |
| 贯穿 · 定时与通知 | `standard-schedule.ts`（`wx_schedule_create/list/cancel`）、`notifications.ts`、`schedule-notifications.ts` | 大材料包解析完成通知；（可选）季度报告到期提醒 |

## Agent 装配清单（`/agent/team4` 的定义应长成什么样）
- **名称**：投后管理报告 AI 生成单元（AI 团队 team4）
- **挂载 Skill（钉版本）**：
  1. `post-investment-report-standard`（新建）—— `03` A/B/F 节的报告章节、财务指标集与证据抽取提示；
  2. `post-investment-risk-rules`（新建）—— `03` C/D 节的风险判据与交叉验证规则集、三分类输出；
  3. 复用既有文档解析 / 检索 / 对标相关平台 Skill，以及 Phase 16 的 `cross-doc-verification`
     （若其规则集已覆盖本阶段跨文件验证，**扩展它而不是新建第二份**；先 grep 再造）。
- **工具最小集**：`wx_document_parse`、`wx_knowledge_search`/`wx_knowledge_read`、web 检索、
  `browser_navigate`（受 middleware 路由）、子任务、`standard-sql`（只读）、
  `wx_artifact_publish`/`wx_artifact_download`、`wx_run_status`/`wx_run_cancel`、
  `wx_schedule_*`、`wx_memory_*`（项目域）。
- **默认不给**：`execute`（L2）、写类文件工具对上传原件的写权限、任何外发通道。
  需要时走既有 HITL 逐次批准，不做全局降级。
- **模型**：按既有模型路由取默认强模型；长链路测试时 recursion ceiling 与模型调用熔断分开设，
  避免"25 次预算耗尽"的假归因（mod-agent-skill-runtime 2026-09-07 经验）。

## 必须避开的已知坑（来自 `.agents/skills/mod-agent-skill-runtime`）
1. **HITL resume 必须转发 per-run 数据**：人工确认①②之后的续跑是同一个 run 的"下一次"输入，
   `org_skills` / `script_protocol` 等键 fresh-run 与 resume 分支要一致，否则深挖阶段会丢 Skill。
2. **风险分级按被调用 skill 自身声明查表**，不要把 `call_skill` 一刀切成 L2；键缺席时 fail-closed。
3. **导航类工具由 middleware 确定性路由**，不靠工具描述劝模型。
4. **DI 图连线才算能用**：新用例写完后 `grep -rn <用例名> apps/api/src/interface` 确认真有路由消费。
5. **静态痕迹 ≠ 动态事实**：验收要跑真实链路，不用"代码文件存在 / mock 成功"充当证据。
6. **数字不让模型算**：同比、占比、周转天数、现金跑道一律在代码里算（`standard-sql` 或服务端计算器），
   模型只负责解释与定性——本阶段 S1（数据准确率 100%）只有这样才守得住。

## 数据与合规要求
- 材料与产出物归当前项目层，遵循既有三层权限与项目级 AI 权限；不跨租户复用。
- 凭据永不进入 Skill 导出包或日志。
- 记忆（`wx_memory_*`）只存**方法论与用户偏好**（如"本基金资本化率按 30% 口径重算"），
  **不存标的敏感财务明细**；材料内容的复用靠项目内检索，不靠跨会话记忆。
- 外部检索只访问公开页面；需要登录/付费的渠道一律降级为"未取证"，不得绕过。
