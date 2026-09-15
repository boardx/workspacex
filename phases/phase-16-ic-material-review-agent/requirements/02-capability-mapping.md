# 02 · 能力映射：每一步复用本仓的哪条既有能力

原则：**这个 Agent 是既有能力的一次装配，不是一套新栈**。下表每一行的"复用"列是现状锚点，
"需要新增"列才是本阶段真正要写的代码。契约字段一律以 `packages/contracts/src` 为唯一事实源。

| 交互步骤（见 01） | 复用的既有能力 | 需要新增 |
|---|---|---|
| 0 落地页 / 会话 | Agent 定义与运行时（`packages/contracts/src/agent-runtime.ts`：Agent 版本、`SkillMount`、三层权限、`effective-permission`）；私聊会话语义与 `NOT_VISIBLE` 错误语义（`agent-private-chat.ts`）；聊天 UI（`apps/web/app/chat`，模块 `mod-chat`） | 公开路由 `apps/web/app/agent/[slug]`；slug → agentId 解析；未登录只读落地页 |
| 1 上传材料包 | 附件上传端点与**已签核的容量/白名单单源**（`chat-file-upload.ts`：`ATTACHMENT_LIMITS`、MIME 白名单，含 PDF/Office/CSV/图片）；文件域契约 `files.ts` | 「材料包」聚合实体（一次会话多文件成组 + 逐文件解析状态 + 哈希台账）；文件夹批量上传前端 |
| 2 解析与结构化 | `wx_document_parse`（`standard-document-tools.ts`）：pdfplumber / python-docx / python-pptx / openpyxl 原生结构化，产出带 `pageNumber`/`bbox`/`tableId`/`sheetName`/`address` 的定位 chunk；OCR 分支（tesseract，含逐词 bbox 与置信度） | 材料包级的批量解析编排与失败台账；表格 chunk 的二次归一（把表还原成行列以便加总校验） |
| 3 摘要与提纲 | 检索/索引与上下文装配（`retrieval-indexing.ts` / `retrieval-embedding.ts` / `retrieval-rerank.ts`、`context-pack.ts`）；`wx_knowledge_search` / `wx_knowledge_read` | 提纲 schema（章节 ↔ 支撑 chunk 引用） |
| 4 标准清单比对 | 平台 Skill 持久化与版本钉版（`skills.ts`、`skill-package-manifest.ts`、`agent-skill-pins.ts`） | **新建 Skill「上会标准审阅（IC review standard）」**：把 `03` 的清单固化成结构化条目 + 判据 + 证据抽取提示，按版本发布并钉给本 Agent |
| 5 外部检索 | 标准 Web 工具（`standard-web-tools.ts`：检索/抓取）与浏览器工具（`standard-browser-tools.ts`）；**已知坑**：要打开具体 URL 时由 middleware 确定性选择 `browser_navigate`，不要让模型在 fetch 与 navigate 之间反复（mod-agent-skill-runtime 2026-09-13 经验） | 外部事实的"来源 + 时间"标注字段与分栏渲染 |
| 6 交叉验证 | 子任务工具（`standard-subtask-tools.ts` / `subtask-run.ts`）做逐规则并行核查；计划模式与权限（`plan-control.ts`、`plan-permissions.ts`） | 交叉验证规则集（见 `03`）与"显性/隐性/关联"三分类的输出 schema |
| 7 第一次交付 | 产出物与产出物引导（`artifact.ts`、`artifacts-steering.ts`、`native-artifact-publish.ts`：`wx_artifact_publish`） | 三栏（提纲 / 缺失 / 风险）产出物视图 |
| 8-9 人工确认①② | 既有人在环路关口（`deep-agent-hitl.ts`、`agent-interrupts.ts`、`run-control.ts`）—— 这正是"审批型中断"该用的通道，不要另造一个确认弹窗 | 确认/驳回/补充与风险分级的结构化裁决 payload，以及裁决对后续轮次的约束（resume 分支必须转发，见下方"已知坑"） |
| 10-11 定向深挖 | 子任务并行、`wx_document_parse` 二次定向解析、`standard-sql.ts`（对已入库表做加总/账龄重算）、记忆（`standard-memory.ts`） | 重算算式的"输入出处 + 算式 + 结果"三元组 schema |
| 12-13 报告与归档 | `wx_artifact_publish` / `wx_artifact_download`（`standard-artifact-download.ts`）；模板域（`templates.ts`）；出处链（`provenance.ts`、`execution-journal.ts`，四要素 `agentVersion`/`skillVersion`/`modelId`/`permissionSnapshot`） | 最终报告模板与归档动作；报告头的运行出处渲染 |
| 贯穿 · 运行观测 | `standard-run-status.ts`（`wx_run_status`）、`standard-run-cancel.ts`（`wx_run_cancel`）、`error-observability.ts`、`streaming-transport.ts` | 逐步骤状态行 UI |
| 贯穿 · 定时 | `standard-schedule.ts`（`wx_schedule_create/list/cancel`） | （可选）大材料包解析完成后的通知 |

## Agent 装配清单（`/agent/team1` 的定义应长成什么样）
- **名称**：上会材料智能审阅助手（AI 团队 team1）
- **挂载 Skill（钉版本）**：
  1. `ic-review-standard`（新建）—— 上会标准清单 + 四态判据 + 证据抽取；
  2. `cross-doc-verification`（新建）—— 交叉验证规则集与三分类输出；
  3. 复用既有文档解析/检索相关平台 Skill（若已有等价能力，**不新建重复 Skill**，先 grep 再造）。
- **工具最小集**：`wx_document_parse`、`wx_knowledge_search`/`wx_knowledge_read`、web 检索、
  `browser_navigate`（受 middleware 路由）、子任务、`standard-sql`（只读）、
  `wx_artifact_publish`/`wx_artifact_download`、`wx_run_status`/`wx_run_cancel`、`wx_memory_*`（项目域）。
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

## 数据与合规要求
- 材料与产出物归当前项目层，遵循既有三层权限与项目级 AI 权限；不跨租户复用。
- 凭据永不进入 Skill 导出包或日志。
- 记忆（`wx_memory_*`）只存**方法论与用户偏好**（如"本组织的缺失项排序口径"），
  **不存标的敏感财务明细**；材料内容的复用靠项目内检索，不靠跨会话记忆。
