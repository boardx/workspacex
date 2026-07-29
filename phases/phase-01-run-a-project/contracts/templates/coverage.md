# 契约束 `templates` — 支撑材料：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 R12 验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature（**⚠ 派生视图，不是权威**）：**F17 F18 F19 F20 F21 F22 F23 F24 F25 F26 F27 F28 F29 F30**，合计 **50 点**。
> **权威是 `design-signoff.md` frontmatter 的 `covers:`**（ADR-023 决策三）——改覆盖范围改那里，不要改这一行。
>
> 依据 UC 与 R12 条数：
> `uc-2-1`（V1–V19 + V1b，共 **20** 行）· `uc-2-2`（V1–V18 含 V9b–V9f，共 **23** 行）·
> `uc-2-3`（**8** 行，V3–V6 各含两段语义，见下）· `uc-2-4`（**13** 行，V3–V6 各含两段语义）。

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由；本束大部分界面**未建**（见 `ui.md`），
这类一律写明「未建 + API 层验收」，**不留空**。

> ⚠ **关于 `uc-2-3` / `uc-2-4` 的 V3 V4 V5 V6 重复编号**：已核实，**两份文档的 R12 各有两段列表**——
> 前一段是本用例的专属验收，后一段是**通用状态验收**（空态 / 依赖失败 / 并发态 / 审计态），
> 两段各自从 V3 起编号，撞号。**本表按 UC 内合并成一行，两段语义都保留在「一句话」列里，一段不丢。**

---

## 一、uc-2-1 R12（20 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：配置项数 = 定义表条目数、分组为五组；完成度 `0/N → N/N` 单调递增；侧栏显示值 = 接口派生值；**断言写成参数化 N** | `listConfigItemDefinitions` → `denominator`；`updateConfigItem` → `completeness` | ⚠ 未建（蓝本设计器完成度侧栏）—（API 层验收） | ⚠ **缺口 1** |
| V1b | 已枚举的 **15 项**全部存在且可编辑，分组归属与 R3 表一致 | `listConfigItemDefinitions` → `items[].group` | ⚠ 未建（设计器左栏五组目录）—（API 层验收） | ⚠ **缺口 1** |
| V2 | 构造 `9/N`…`N/N` 的蓝本，**列表页对应行显示同一数值**（分母取自定义表，不写死 16/15） | `listBlueprints` → `completeness` | ⚠ 未建（后台无「项目蓝本」模块，`ADMIN_NAV` 仅 8 项）—（API 层验收） | ⚠ **缺口 2** |
| V3 | AC4：四档议程环节数 **7 / 11 / 14 / 19**，第 2 项「流程 Agenda」计数与之相等；默认两天 | `setDurationTier` → `agendaStageCount` | ⚠ 未建（档位区四档 + `[＋ 档位]`）—（API 层验收） | ✅ 契约齐（I-15） |
| V4 | 档位「两天→半天→两天」往返：必留环节保留且只压缩时间、可选环节可恢复、已填内容无静默丢失 | `setDurationTier` → `removed` / `recoverable` | ⚠ 未建（换档位确认对话框）—（API 层验收） | ⚠ **缺口 3**（[Backlog] 口径，待裁决 D-8） |
| V5 | 形式选「全线上」议程环节表 **+「破冰」「举手排队」**且标来源；切回「混合」对称移除 | `setFormatAndLanguage` → `autoAdded` / `autoRemoved` | ⚠ 未建（形式与语言区）—（API 层验收） | ✅ 契约齐（I-16） |
| V6 | AC3b：把任一项 `required` 置 true 并留空 → 发布被拒且指向该项、侧栏高亮；改回 false 后留空也可发布。**断言由 `required` 列驱动** | `publishBlueprintVersion` → `REQUIRED_CONFIG_INCOMPLETE.missingKeys[]` | ⚠ 未建（完成度侧栏高亮 + 直达未完成项）—（API 层验收） | ⚠ **缺口 4**（与原型冲突，待裁决 D-9） |
| V7 | AC3a：未试跑的草稿点发布被拒，提示「试跑一场后才能发布」；试跑后同一草稿可发布 | `publishBlueprintVersion` → `TRIAL_RUN_REQUIRED`；`startTrialRun` | ⚠ 未建（动作条三按钮）—（API 层验收） | ⚠ **缺口 5**（「已试跑」判据待裁决 D-6） |
| V8 | AC2：v4 改动后发布得 v5；**v4 期间已建项目的蓝本版本字段仍为 v4**（快照绑定的可执行断言） | `publishBlueprintVersion`；读 `ProjectBlueprintSnapshot` | `/projects` 项目卡 `蓝本 HMW 定题 v4` 文本片（**⚠ 无独立 testid**，见 ui.md 缺口） | ⚠ **缺口 6** |
| V9 | AC5：改任一配置项后六类一览随之变化；走 UC-2.2 套用，实际写入项与该一览**逐项对得上**（跨用例断言） | `getInitializationPreview` ↔ `applyBlueprint`（**共用同一契约**） | ⚠ 未建（右侧「套用后会初始化什么」）—（API 层验收） | ✅ 契约齐（I-17） |
| V10 | 三条模型策略分别落到现场/会后整理/机密三类调用；**机密在配额 90% 时仍走本地 qwen3，不被降级** | `setModelStrategy`；`ModelGatewayPort` → `CONFIDENTIAL_ROUTE_VIOLATION` | ⚠ 未建（模型策略区）；`/chat` 批准卡（S-01 口径）—（API 层验收） | ⚠ **缺口 7**（跨束） |
| V11 | 用量达单场预算 90% ⇒ **自动切便宜模型 + 对话内提示 + 会话未中断**（不硬停） | `setQuotaPolicy`；`ModelGatewayPort` 降级事件 | ⚠ 未建（配额区）；降级提示落 `/chat` 对话流 —（API 层验收） | ⚠ **缺口 7**（跨束） |
| V12 | 草稿自动保存：不点保存刷新内容仍在，显示的最后保存时刻与实际写入时间一致；**保存失败不得显示「已自动保存」** | `updateConfigItem` → `autosavedAt` / `AUTOSAVE_FAILED` | ⚠ 未建（版本条下 `草稿自动保存 · 14:52`）—（API 层验收） | ✅ 契约齐 |
| V13 | 新建三入口各建一份蓝本；「从历史项目反向生成」能把源项目用料对应到具体配置项，未映射项留空并计入缺口 | `createBlueprint` → `unmappedConfigItemKeys` | ⚠ 未建（列表页页脚新建三入口）—（API 层验收） | ✅ 契约齐 |
| V14 | 权限态：方法负责人/引导师/观察者/未授权四类遍历，返回数据与可执行动作严格符合 R5；**观察者不得看到未发布草稿** | 全部用例的 `NO_ORG_ROLE` / `ROLE_INSUFFICIENT` / `BLUEPRINT_NOT_FOUND` | ⚠ 未建（设计器无权限态）；`?as=` 角色预览轴已有（`/projects/demo/files`） | ⚠ **缺口 8**（跨束，判定属 identity） |
| V15 | 空态：新建蓝本显示 `0/N` 真实空态与下一步，**不生成示例配置** | `listConfigItemDefinitions` + 空 `completeness` | ⚠ 未建（设计器空态）；`StateShell` 七态组件已建成可复用 | ✅ 契约齐 |
| V16 | 依赖失败：输入与最近成功数据保留，错误可解释且可重试 | 全部用例的 `DEPENDENCY_UNAVAILABLE` | `StateShell` `depFailure`（已建成，`/projects` 已用） | ✅ |
| V17 | 并发：两人改**不同**配置项互不覆盖；改**同一项**提示版本已变化并可对比，无静默覆盖 | `updateConfigItem` → `expectedItemRevision` / `VERSION_CHANGED` | ⚠ 未建（冲突条；ui-preview S-18 记「原型此条确认缺失」）—（API 层验收） | ✅ 契约齐（粒度=单项） |
| V18 | 事务：注入发布中途失败，**无「已生成新版但旧版仍为当前版」的中间态**，且版本号无缺号 | `publishBlueprintVersion`（发布 + 归档同事务） | —（API 层验收） | ✅ 契约齐（I-3） |
| V19 | 审计：发布/换档位/改模型策略/改配额/删除/复制均可按操作者、时间、对象、结果检索；**越权尝试也有安全审计** | `queryBlueprintAudit` | `/admin` 活动流（identity 束）；本束无独立屏 | ⚠ **缺口 9**（跨束审计查询面） |

---

## 二、uc-2-2 R12（23 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：议程环节数 = 所选档位、分组位数 = 蓝本分组规则组数、**输出物槽位数 = 第 14 项件数且每件带非空验收口径** | `applyBlueprint` → `initialized` | ⚠ 未建（项目筹备页）；`/projects/[id]` 枢纽页已建成 `project-home-surfaces` | ⚠ **缺口 10** |
| V2 | AC2：蓝本六类一览 vs 新项目实际初始化项**逐项 diff 差异为空**；六个类别一个不缺 | `getInitializationPreview` ↔ `applyBlueprint`（同一契约） | ⚠ 未建（新建向导第二步「将初始化什么」）—（API 层验收） | ✅ 契约齐（I-17） |
| V3 | AC3：套 v4 建项目 → 发布 v5 → 项目页仍显示 `蓝本 … v4`，项目内结构不变 | `applyBlueprint`；`publishBlueprintVersion` | `/projects` 项目卡 `蓝本 … v3/v4` 文本片（**⚠ 无独立 testid**） | ⚠ **缺口 6** |
| V4 | AC4 关键：项目内改议程/分组/材料/输出物验收口径，逐一断言**蓝本 v4 对应字段字节不变**；系统无从项目直接写蓝本的接口路径 | 接口面扫描 + 各写用例（**无对应写路径即通过**） | —（API 层验收，隔离性断言） | ✅ 契约齐（I-9） |
| V5 | AC6：改主题后 `[保存并同步到全场]`，分组卡/议程/AI 上下文读到**同一个主题 ID**；**不存在第二份主题/背景记录** | `saveAndSyncTopic` → `topicId` / `syncedTo` | ⚠ 未建（定题区 + `[保存并同步到全场]`）—（API 层验收） | ✅ 契约齐（I-13） |
| V6 | AC5：四子标签计数（议程 N / 材料 M / 会前任务 x/y）与后端条目数一致，改数据后同步刷新 | `getProjectPrep` → `tabs[].count` | ⚠ 未建（项目筹备页四子标签）—（API 层验收） | ⚠ **缺口 10** |
| V7 | 分组：`[− 4 +]` 增减后组卡数一致；三种组状态**取值只在三值之内**；`[加人]` `[换组长]` 生效并写审计 | `updateGrouping` → `INVALID_GROUP_STATUS` / `GROUP_LEADER_REQUIRED` | ⚠ 未建（分组区与组卡）—（API 层验收） | ✅ 契约齐（I-14） |
| V8 | AI 建议态：四个 AI 按钮产出均标机器产出、可见来源，**未经人确认不落为最终值** | `saveAndSyncTopic.aiGenerated`；`updateGrouping` 建议态；`AI_SOURCES_INSUFFICIENT` | ⚠ 未建（定题/分组 AI 按钮）；`/chat` 批准卡模式可复用 | ⚠ **缺口 11**（批准点模式跨束） |
| V9 | 对象表：组卡内六列齐全、可增删；**本用例只断言结构与填写**，预约与转写回流由 06-itv 验收 | `updateInterviewSubjects` | ⚠ 未建（组卡内对象表）—（API 层验收） | ✅ 契约齐 |
| V9b | AC7 跨模块关键：3 环节 × 3 角色 = 9 格 ⇒ 任务模块**恰好 9 条**待办，可反查来源格；改格同步、删格不留孤儿、重复同步不产生重复卡 | `syncMatrixToTasks` → `created/updated/removed` | `/tasks` 任务看板（**已建成**，但无格↔卡来源徽标）—（API 层验收） | ⚠ **缺口 12**（跨束 + 粒度待裁决 D-10） |
| V9c | AC8：组长切换环节状态后三视角首屏**同时**切到新环节，三者读同一个状态源 | `setAgendaStageStatus`；`AgendaStageStatusPublisher` | ⚠ 未建（现场协作三视角首屏）—（API 层验收） | ⚠ **缺口 13**（跨束） |
| V9d | AC9：项目里改时长/增删环节/换绑模板与 skill，**后台工作流模板本体字节不变**（与 V4 同型） | 接口面扫描 + `switchWorkflowTemplate` | —（API 层验收，隔离性断言） | ✅ 契约齐（I-9） |
| V9e | 绑定列：环节行「绑定」能同时挂画布模板与 skill，且**与 UC-3.2 读到同一份数据** | `updateMatrixCell.bindings` | ⚠ 未建（矩阵绑定列）—（API 层验收） | ⚠ **缺口 14**（跨束 `skills` / `canvas`） |
| V9f | 换模板 A5：点 `[改用这个]` **必须先出确认并列出影响范围**，不得静默替换环节链或丢弃已生成待办 | `switchWorkflowTemplate` → `TEMPLATE_SWITCH_NEEDS_CONFIRMATION` + `impact` | ⚠ 未建（模板库三行 + `[改用这个]`）—（API 层验收） | ⚠ **缺口 15**（处置策略待裁决 D-11） |
| V10 | 备选态：只选蓝本不定题即保存，项目可存在且准备度为低值，四子标签显示真实未完成状态而非伪数据 | `applyBlueprint`（A2 允许）；`getProjectPrep` | `/projects` 草稿卡 `准备度 15% · 未邀请 · 蓝本 假设风暴（快版）`（**已建成**） | ⚠ **缺口 16**（准备度口径待裁决 D-13） |
| V11 | 下架态：蓝本归档后新建项目列表不再出现它，但**已套用该蓝本的项目打开一切正常** | `archiveBlueprint`；`applyBlueprint` → `BLUEPRINT_VERSION_ARCHIVED` | ⚠ 未建（新建向导蓝本选择器）—（API 层验收） | ✅ 契约齐（I-7） |
| V12 | 事务态：注入第 4 类「现场」写入失败 ⇒ **整体回滚**、不留半成品项目，错误指明失败类别且可重试 | `applyBlueprint` → `INITIALIZATION_FAILED.category` | `StateShell` 校验失败态（已建成，`/projects` 已用 `errors.blueprint/duration`） | ✅ 契约齐 |
| V13 | 幂等态：同一次新建请求重复提交（双击 / 重试）只建出**一个**项目 | `applyBlueprint.idempotencyKey` | `projects-new`（**已建成但 `disabled`**，title 明写「蓝本设计器尚未建」） | ⚠ **缺口 17** |
| V14 | 权限态：引导师/项目负责人/观察者/未授权四类遍历；**观察者不得看到筹备页的写操作按钮** | 各用例 `NO_PROJECT_ROLE` / `ROLE_INSUFFICIENT` | ⚠ 未建（筹备页）；`?as=` 角色预览轴已有 | ⚠ **缺口 8**（跨束） |
| V15 | 空态：不套蓝本新建的空项目四子标签均为真实空态与下一步，**不生成示例分组或示例议程** | `getProjectPrep` 空态 | ⚠ 未建（筹备页空态）；`StateShell` 可复用 | ✅ 契约齐 |
| V16 | 依赖失败：输入与最近成功数据保留，错误可解释可重试 | 各用例 `DEPENDENCY_UNAVAILABLE` | `StateShell` `depFailure`（`/projects` 已用「蓝本服务暂时不可用」文案） | ✅ |
| V17 | 并发态：两人同时改同一组卡不静默覆盖，可识别最终版本 | `updateGrouping.expectedRevision` → `VERSION_CHANGED` | ⚠ 未建（冲突条，S-18 记原型此条确认缺失）—（API 层验收） | ✅ 契约齐 |
| V18 | 审计态：套用蓝本/改档位/定题同步全场/改分组/换组长均可检索；越权尝试也有安全审计 | `queryBlueprintAudit`（项目侧动作同写一个审计面） | `/admin` 活动流；本束无独立屏 | ⚠ **缺口 9**（跨束） |

---

## 三、uc-2-3 R12（8 条 · V3–V6 各含两段语义，已合并）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：合并后的蓝本字段可反查**来源项目 + 提出人 + 时间 + 理由原文**，四者缺一即失败 | `mergePendingChange` → `traceable` | ⚠ 未建（蓝本侧待审改动收件面，**原型确认缺失**）—（API 层验收） | ⚠ **缺口 18** |
| V2 | 偏离清单：项目内改 3 处（分属不同配置项）⇒ 清单**恰好列出这 3 条**，每条含「蓝本原值 → 本场实际值」，未改动项不出现 | `computeDeviations` → `deviations[]` | ⚠ 未建（项目复盘屏，**原型未探明**）—（API 层验收） | ⚠ **缺口 19** |
| V3 | ①（提交≠生效）提交回提后**蓝本内容与版本号均未变**，只新增一条待审改动；②（空态）无目标数据时显示真实空态与下一步，不生成伪数据 | ① `submitBlueprintChangeRequest`（不触发版本写）② `computeDeviations` → `NO_DEVIATIONS` | ⚠ 未建（复盘屏 + 收件面）；`StateShell` 空态可复用 —（API 层验收） | ⚠ **缺口 19** |
| V4 | ①（理由必填）不填理由的提交被拒绝；②（依赖失败）模拟依赖失败，输入与最近成功数据保留，错误可解释可重试 | ① `submitBlueprintChangeRequest` → `RATIONALE_REQUIRED` ② `DEPENDENCY_UNAVAILABLE` | ⚠ 未建（勾选 + 理由输入）；`StateShell` `depFailure` 可复用 | ✅ 契约齐（I-11） |
| V5 | ①（合并权限）非蓝本维护者（**含提出回提的引导师本人**）调用合并被拒并写审计；②（并发态）两人改同一资源不静默覆盖并可识别最终版本 | ① `mergePendingChange` → `NOT_BLUEPRINT_MAINTAINER` + 审计 ② `VERSION_CHANGED` | ⚠ 未建（收件面合并按钮）—（API 层验收） | ⚠ **缺口 20**（维护者定义待裁决 D-1） |
| V6 | ①（多场冲突）两场对**同一处**提回不同改动 ⇒ 两条**并排显示各自理由**，无后写覆盖、无自动择一；②（审计态）关键动作可按操作者/时间/对象/结果检索，越权亦有安全审计 | ① `listPendingChanges` → `siblingsOnSameKey` ② `queryBlueprintAudit` | ⚠ 未建（并排对比视图）；`/admin` 活动流 —（API 层验收） | ✅ 契约齐（I-12） |
| V7 | 唯一通道：扫描接口面断言**不存在**从项目上下文直接写蓝本的路径；项目内任何改动都不影响蓝本（与 uc-2-2 V4 互为镜像） | 接口面扫描（**无对应写路径即通过**） | —（API 层验收，隔离性断言） | ✅ 契约齐（I-9） |
| V8 | 权限态：引导师/方法负责人/观察者/未授权四类遍历，返回数据与可执行动作严格符合 R5 | 各用例的角色错误码 | ⚠ 未建（两侧屏）；`?as=` 角色预览轴已有 | ⚠ **缺口 8**（跨束） |

---

## 四、uc-2-4 R12（13 条 · V3–V6 各含两段语义，已合并）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：项目页与项目列表行均显示 `蓝本 <名称> v<N>`，与该项目绑定的快照一致 | 读 `ProjectBlueprintSnapshot`；`listBlueprints` | `/projects` 项目卡 `蓝本 HMW 定题 v4`（**已建成但只是 MetaChips 里的普通文本，无独立 testid**） | ⚠ **缺口 6** |
| V2 | AC2 核心：v4 建项目 A → 发布 v5 ⇒ A 绑定版本仍 v4 且议程/分组/输出物**逐项与 v4 快照一致**；再发 v6，A 仍不变 | `applyBlueprint`；`publishBlueprintVersion`；读快照 | 同 V1 —（API 层验收） | ✅ 契约齐（I-1 / I-4） |
| V3 | ①（AC3 归档）v4 归档后新建可选列表不含 v4，而项目 A 打开/编辑/运行**全部正常**；②（空态）无目标数据时真实空态与下一步，不生成伪数据 | ① `archiveBlueprint`；`applyBlueprint` → `BLUEPRINT_VERSION_ARCHIVED` ② `listBlueprints` → `[]` | ⚠ 未建（后台「项目蓝本」列表页）；`StateShell` 空态可复用 | ⚠ **缺口 2** |
| V4 | ①（AC4）构造 `已发布 v3 · 9 环节·1d · 用过 6 次 · 满意度 4.5 · 15/16` ⇒ 六字段各就各位，**`9`（议程环节数）与 `15/16`（配置完成度）在接口与 UI 上是两个独立字段**；②（依赖失败）输入与最近成功数据保留，可解释可重试 | ① `listBlueprints` → `agendaStageCount` / `completeness` ② `DEPENDENCY_UNAVAILABLE` | ⚠ 未建（蓝本列表行）；`StateShell` `depFailure` 可复用 | ⚠ **缺口 2** |
| V5 | ①（AC5 复制）`[⧉ 复制]` 后新蓝本为草稿态、无版本号、用过 0 次、满意度空，改新蓝本不影响源蓝本；②（并发态）两人改同一资源不静默覆盖并可识别最终版本 | ① `copyBlueprint` ② `VERSION_CHANGED` | ⚠ 未建（列表行操作三按钮）—（API 层验收） | ✅ 契约齐 |
| V6 | ①（版本差异）发布 v5 时改了第 2、9、14 三项 ⇒ 版本记录**恰好列出这三项**；②（审计态）关键动作可按操作者/时间/对象/结果检索，越权亦有安全审计 | ① `publishBlueprintVersion` → `changedConfigItemKeys` ② `queryBlueprintAudit` | ⚠ 未建（**版本历史屏，原型确认缺失**）；`/admin` 活动流 | ⚠ **缺口 21** |
| V7 | 回滚约束 + 语义：回滚到**进行中项目正用的版本**被拒并说明原因；回滚 v3 ⇒ 产生 **v6 且内容逐字段 = v3**，v3/v5 记录均不变，含 `rolled_back_from = v3`；**不存在「当前版本指针被改回 v3」的状态** | `rollbackToVersion` → `ROLLBACK_TARGET_IN_USE`（带项目清单）/ `rolledBackFrom` | ⚠ 未建（**回滚入口与确认对话框，原型确认缺失**）—（API 层验收） | ⚠ **缺口 21** |
| V7b | 不可删除：对**已被套用过**的蓝本调删除 ⇒ 拒绝、指向「请改用归档」、列出仍引用它的项目数；**从未被套用**的可删；**删除接口不得有强制参数可绕过此判定** | `deleteBlueprint` → `BLUEPRINT_IN_USE.referencingProjectCount` | ⚠ 未建（**删除确认与影响范围提示，原型确认缺失**）—（API 层验收） | ⚠ **缺口 21**（契约齐，I-8） |
| V7c | 归档语义三件：① 新建可选版本列表不含 v4 ② 项目 A 打开/编辑/运行正常 ③ **A 推进到某议程环节时仍能新建该环节绑定的画布/产出实例**且实例版本号为 v4（存量绑定可实例化，防现场跑挂） | `archiveBlueprint`；`applyBlueprint`；画布/产出实例化路径（`canvas` 束） | ⚠ 未建（现场协作切环节）；`/projects/[id]/canvas` 已建成（`canvas-stage` 为静态占位，S-17） | ⚠ **缺口 22**（跨束 `canvas`） |
| V7d | 可见性范围：蓝本标「仅能源组」后非该组成员的可套用列表不含它，直接按 ID 套用被拒并标明为**组织层**限制 | `setBlueprintVisibility`；`applyBlueprint` → `BLUEPRINT_NOT_VISIBLE` | ⚠ 未建（列表可见性徽标）；`/admin` `scope-badges.tsx` 已建成可复用 | ⚠ **缺口 23**（跨束 `identity`） |
| V8 | 版本号完整性：连续发布与失败混合执行后，版本号**单调递增、无缺号、无复用** | `publishBlueprintVersion`（唯一索引 + 事务） | —（API 层验收） | ✅ 契约齐（I-3） |
| V9 | 新建默认版本：新建项目默认选中**最新已发布版本**，非最新版需显式选择 | `applyBlueprint`（`versionId` 缺省解析为 latest published） | ⚠ 未建（新建向导蓝本选择器）—（API 层验收） | ✅ 契约齐 |
| V10 | 权限态：引导师/方法负责人/观察者/未授权四类遍历，返回数据与可执行动作严格符合 R5 | 各用例的角色错误码 | ⚠ 未建（蓝本列表页）；`?as=` 角色预览轴已有 | ⚠ **缺口 8**（跨束） |

---

## 五、缺口清单（这一件的真正价值所在）

> 这 23 个缺口是**这一轮设计的产出，不是失败**。四件套的意义就是在写代码之前把它们找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **蓝本设计器整屏未建**（完成度侧栏 / 五组目录 / 版本条 / 三动作按钮）。原型完整存在（D-05 判为「一级 · 可立即 sign-off」），但 `apps/web` 里**零实现** | 界面缺口 | F18 已标 `needs_ui_signoff`。**须先由 ui-prototyper 建成并截图**，第 ① 件才具备签核条件（见 `ui.md`） |
| **2** | **后台没有「项目蓝本」模块**。`ADMIN_NAV` 只有 8 项（agent/skill/model/mcp/overview/members/feedback/local），**没有 blueprint** | 界面缺口 | 补第 9 个后台模块 + 列表页。V2 / V3 / V4 全压在这块屏上 |
| **3** | **换档位的「可选/必留 + 压缩时间」是 [Backlog] 口径，与原型不符** | 需裁决（D-8） | uc-2-1 V4 自己写着「待人类确认后再定稿」。签核时定 |
| **4** | **AC3b「必填未完成不得发布」与运行态原型直接冲突**：原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布** | 口径冲突（D-9） | O-18 ⑤ 的和解是「那些缺项 `required=false`」——**这是推测**，需人类确认它成立；另需给出 `required` 清单内容 |
| **5** | **「已试跑」的完成判定未定**：创建实例即算 / 需跑完 / 需产出？ | 需裁决（D-6） | 按「创建即算」会让 AC3a 这道门槛形同虚设。签核时定 |
| **6** | **项目卡上的 `蓝本 … v4` 只是 `MetaChips` 里的普通文本，没有独立 `data-testid`** | 可验证性缺口 | uc-2-4 V1 与 uc-2-1 V8、uc-2-2 V3 都要断言它。**加一个 `projects-card-<id>-blueprint`**，否则三条验收只能靠文本匹配 |
| **7** | **模型策略与配额降级横跨本束与 20-model / `chat` 束**：机密硬路由若只在蓝本侧选、网关侧不独立拦，I-21 就是空的 | 跨束 | 提一致性复核：`ModelGatewayPort` 必须能独立拒绝。与 ui-preview **S-01**（机密能否与云端模型并存）是同一条裁决 |
| **8** | **权限态验收（4 份 UC 各一条 V）全压在 `identity` 束的判定上** | 跨束 | 本束用例只透传 `NO_ORG_ROLE` / `NO_PROJECT_ROLE` / `ROLE_INSUFFICIENT`。一致性复核确认**四个角色值与两层交集判定只有一份实现** |
| **9** | **审计查询面跨束**：本束 `queryBlueprintAudit` 与 phase-00 `artifact` 的 `queryProvenance`、`identity` 的审计写入是同一件事的三处 | 跨束 | 一致性复核统一一个审计查询面。**各束各造一个就是又一次「同一事实声明在多处」** |
| **10** | **项目筹备页四子标签未建**；`/projects/[id]` 只有枢纽页（`project-home-surfaces`，未建的屏显式禁用） | 界面缺口 | 原型完整存在「定题与分组」子标签（可立即 sign-off）；另三个子标签**打开后的编辑器未探明**（不等于原型没做），补抽取后再签 |
| **11** | **AI 批准点模式跨束**：四个 AI 按钮的「机器产出 + 挂来源 + 需人确认」与 `/chat` 批准卡是同一套语义 | 跨束 | 一致性复核确认复用同一套批准点组件与契约，不各做一套 |
| **12** | **矩阵格 → 待办同步（F27）是本束最重的跨模块契约**，且「一格 = 一条还是多条待办」未定 | 跨束 + 需裁决（D-10） | ⚠ **F27 的验收断言「恰好 9 条」建立在「一格一条」这个未确认假设上**。须与 11-board 约定：来源徽标、格 ID ↔ 卡 ID 映射、改/删联动、幂等重试 |
| **13** | **议程环节状态 → 三视角首屏切换**跨 UC-1.4 / 06-现场协作 | 跨束 | 一致性复核确认**只有一个状态源**（I-24），三视角不各自判断 |
| **14** | **矩阵「绑定」列与 UC-3.2 共用同一实现**（`skills` 束 + `canvas` 束） | 跨束 | uc-2-2 R11 明写「三处 feature 不得重复实现同一份矩阵与同步逻辑，否则会出现两套职责表」 |
| **15** | **换工作流模板的处置策略未定**：已生成待办 / 已填格 / 已产生现场数据怎么办；项目开始后是否禁止换 | 需裁决（D-11） | 先实现确认 + 影响范围列举（A5 已定这一半） |
| **16** | **准备度百分比计算口径未探明**（分母构成、权重） | 需裁决（D-13） | 界面已建成并用了 ui-preview **S-18** 的自拟配色分档（≥60/30–59/<30），**那是实现者替 UC 做的决定** |
| **17** | **`projects-new` 按钮当前是 `disabled`**，title 写着「蓝本设计器尚未建」 | 界面缺口（诚实的） | 这是正确的处理（不做死按钮）。F23 交付时解禁；V13 幂等断言在此之前只能 API 层验收 |
| **18** | **蓝本侧「待审改动」收件面：已探明区域内确认缺失** —— 设计器整屏与列表页两处都完整抽取过，**均无入口、无角标、无合并界面** | 界面缺口（确认缺失） | 需**补画**。定：入口挂哪（列表行 / 设计器顶部 / 独立收件箱）、有无未读角标、通知方式 |
| **19** | **项目复盘屏：未探明** —— 本轮抽取未点开复盘，**不能断言原型没画** | 待补抽取 | ⚠ 与缺口 18 **性质不同，不可混为一谈**。requirement-author 已被要求不得为这两处编造 `data-testid` |
| **20** | **「蓝本维护者」的定义未定**：组织角色（方法负责人）还是每份蓝本单独指定的 owner？能否多位？ | 需裁决（D-1） | ⚠ **这条阻断 F29 的合并侧**：`mergePendingChange` 的 `pre:` 现在写不实 |
| **21** | **版本历史屏 / 回滚入口 / 删除确认与影响范围提示：已探明区域内确认缺失** | 界面缺口（确认缺失） | 需补画。V6 / V7 / V7b 三条验收都落在这里 |
| **22** | **归档后「存量绑定仍可实例化」跨 `canvas` 束**：本束定义 I-7，但实例化路径在画布/产出侧 | 跨束 | 一致性复核确认画布侧的实例化**不查蓝本当前状态、只查绑定版本**。⚠ 做反了会让进行中的工作坊切环节当场失败 |
| **23** | **可见性范围与 MCP 授权范围禁止合并成同一字段**（uc-0-3 R7 已明写） | 跨束 | 一致性复核核对：`visibility`（org-wide/team-only）与 MCP 的三值授权是**两个维度**。这是「同一事实两处声明」的反面——**两件不同的事被合成一处**，同样有害 |

---

## 六、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `listConfigItemDefinitions` | uc-2-1 V1 V1b V2（分母与 required 的唯一事实源） | ✅ |
| `createBlueprint` | uc-2-1 V13（新建三入口） | ✅ |
| `updateConfigItem` | uc-2-1 V1 V12 V17 | ✅ |
| `setDurationTier` | uc-2-1 V3 V4 | ✅ |
| `setFormatAndLanguage` | uc-2-1 V5 | ✅ |
| `setModelStrategy` | uc-2-1 V10 | ✅ |
| `setQuotaPolicy` | uc-2-1 V11 | ✅ |
| `getInitializationPreview` | uc-2-1 V9 · uc-2-2 V2（**与 `applyBlueprint` 共用契约**） | ✅ |
| `previewParticipantView` | uc-2-1 R3 步骤 7（只读预览，不产生版本） | ✅ |
| `startTrialRun` | uc-2-1 V7（发布前置条件） | ✅ |
| `publishBlueprintVersion` | uc-2-1 V6 V7 V8 V18 · uc-2-4 V6 V8 | ✅ |
| `listBlueprints` | uc-2-1 V2 · uc-2-4 V3 V4 | ✅ |
| `copyBlueprint` | uc-2-4 V5 | ✅ |
| `archiveBlueprint` | uc-2-2 V11 · uc-2-4 V3 V7c | ✅ |
| `deleteBlueprint` | uc-2-4 V7b | ✅ |
| `rollbackToVersion` | uc-2-4 V7 | ✅ |
| `setBlueprintVisibility` | uc-2-4 V7d | ✅ |
| `queryBlueprintAudit` | uc-2-1 V19 · uc-2-2 V18 · uc-2-3 V6② · uc-2-4 V6② | ✅（但见缺口 9：应是统一查询面） |
| `applyBlueprint` | uc-2-2 V1 V2 V3 V11 V12 V13 · uc-2-4 V9 | ✅ |
| `getProjectPrep` | uc-2-2 V6 V10 V15 | ✅ |
| `saveAndSyncTopic` | uc-2-2 V5 V8 | ✅ |
| `updateGrouping` | uc-2-2 V7 V8 V17 | ✅ |
| `updateInterviewSubjects` | uc-2-2 V9 | ✅ |
| `getWorkflowOrchestration` | uc-2-2 R3 步骤 7a/7b（模板层 + 矩阵读面） | ✅ |
| `switchWorkflowTemplate` | uc-2-2 V9f | ✅ |
| `saveAsOrgTemplate` | uc-2-2 A7 · uc-2-3 R7（两条沉淀路径之一） | ✅ |
| `updateMatrixCell` | uc-2-2 V9b V9e | ✅ |
| `syncMatrixToTasks` | uc-2-2 V9b | ✅ |
| `setAgendaStageStatus` | uc-2-2 V9c | ✅ |
| `computeDeviations` | uc-2-3 V2 V3② | ✅ |
| `submitBlueprintChangeRequest` | uc-2-3 V3① V4① | ✅ |
| `listPendingChanges` | uc-2-3 V6① | ✅ |
| `mergePendingChange` / `rejectPendingChange` | uc-2-3 V1 V5① | ✅ |

**33 个操作全部有 UC 要求，无孤儿接口。**

⚠ 反向的另一面：**uc-2-2 V4 / V9d 与 uc-2-3 V7 要求的是「不存在某类 API」**——
这三条的通过判据是**接口面扫描的结果为空集**，不是某个接口返回正确。
写实现时最容易漏掉这类「反向断言」，因为它没有对应的绿色测试对象。

---

## 七、签核时请重点看这四处

1. **缺口 4（AC3b 与原型冲突）** —— 「必填未完成不得发布」来自 Backlog，而原型里 `9/16` 的蓝本
   **就是已发布的**。O-18 ⑤ 用「那些缺项 `required=false`」和解了它，但**这是推测，不是证据**。
   请确认它成立，并给出 `required` 清单内容（缺的是数据，不是实现方式）。
2. **缺口 12 + D-10（矩阵格粒度）** —— F27 的验收断言写的是「3×3 ⇒ **恰好 9 条**待办」，
   而「一格是一条还是多条」**从未被裁决**。原型格内是短句（「写 ≥1 张便签 · 投票」）。
   **这个假设已经进了 feature 的 verification，裁决与它不符就要改验收。**
3. **缺口 18 vs 缺口 19（两处 UI 缺失的性质不同）** —— 复盘屏是**未探明**（不能断言原型没画），
   收件面是**已探明区域内确认缺失**（要补画）。把两者当成一件事会导致要么白等补抽取、要么凭空发明界面。
4. **缺口 20（蓝本维护者的定义）** —— 这是本束唯一一条**会让用例的 `pre:` 写不出来**的缺口。
   `mergePendingChange` 是 UC-2.3 的核心动作，它的前置条件现在悬空。
