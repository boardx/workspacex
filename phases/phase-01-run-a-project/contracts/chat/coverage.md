# 契约束 `chat` — UC 覆盖证明（支撑材料）

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 R12 验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F108 F109 F110 F111 F112 F113 F114 F115（24 点）
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的 `covers:`
> （ADR-023 决策三）。改覆盖范围改那里。
>
> 验收线索来源：五份 UC 的 R12，共 **67 条**
> （uc-8-1 **8** · uc-8-2 **23** · uc-8-3 **13** · uc-8-4 **8** · uc-8-5 **15**）。

## 怎么读这几张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「API 操作」列的 `UC-n` 指向本束 [`usecases.md`](./usecases.md) 的用例编号；
`I-n` 指向 [`domain.md`](./domain.md) 的不变量。
「前端消费点」列填**已建成界面**（`/chat`）里的**真实 `data-testid`**（已在
`apps/web/components/chat/` 里逐个核实）；填不出来的写 `—（API 层验收）`，**但不许空着**。

⚠ **机械抽取会漏行**：`verify-uc-coverage.ts` 的正则只认行首 `- Vn`，
而这五份 UC 里**加粗的 `- **Vn（…`、以及带后缀的 `V4b/V7c/V1b` 一律抓不到**。
下面各表是**逐份人工核实过的完整编号集合**，比门控要求的更全——这是刻意的。

---

## 一、uc-8-1 R12（8 条：V1–V8）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：研究阶段与现场分组两入口调同一列表接口，卡片字段结构完全一致 | `UC-4 listThreads`（同一 schema，只换数据源与 filter） | `/chat` `chat-left-panel` `chat-thread-list` | ✅ |
| **V2** | AC2 徽标同源：转录服务运行中 → `status=转录中`；`待复核数` 与 UC-8.2 消息头「待复核 N」**同一字段、两处相等** | `UC-4` 的 `badges[]` + `UC-9` 的 `badges[]` 读**同一投影**（I-13 I-14） | `chat-thread-list` ＋ `chat-badge-review`（消息头） | ⚠ **缺口 1**（同源靠单源实现，需门控） |
| V3 | 权限态：五身份遍历，返回数据与可执行动作严格符合 UC-8.5 判定（本 UC 不另定义） | `UC-0 resolveVisibility`（委托 `identity` 中间件） | `chat-observer-tag` `chat-readonly-note`（`?as=` 四视角） | ✅ |
| V4 | 空态：无线程时显示真实空态与「新建对话」，不生成示例线程 | `UC-4` → `groups: []` | `chat-thread-list`（空态）＋ `chat-new-thread` | ✅ |
| V5 | 归档态：默认筛选不返回；显式筛选可读但全部写操作被拒 | `UC-4 includeArchived` + `UC-5` → `THREAD_ARCHIVED_READONLY`（I-15） | `chat-thread-<id>`（归档徽标）；写拒绝 —（API 层验收） | ⚠ **缺口 2**（显式筛选入口未建） |
| V6 | 依赖失败：输入与最近成功数据保留，错误可解释可重试 | `UC-4` / `UC-1` 依赖失败出口 | `/chat?state=dep-failed`（七态矩阵已覆盖） | ✅ |
| V7 | 并发：两人同时改名/删除同一线程不静默覆盖，可识别最终版本 | `UC-5` `expectedVersion` → `VERSION_CHANGED` | —（API 层验收） | ✅ |
| V8 | 审计：新建/改名/删除三类动作可按操作者/时间/对象/结果检索；越权尝试也留痕 | `UC-27 queryAudit` + `UC-5` 的 `auditEventId` | —（API 层验收；活动流屏在 17-gov） | ⚠ **缺口 3**（查询面跨束） |

---

## 二、uc-8-2 R12（23 条：V1–V4c、V5–V7d、V8–V18）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | AC2 闸门态：高影响动作触发后 ① 动作未执行 ② 状态 `已暂停` ③ 响应体含调用链/模型/预算与金额/数据范围/三出口五组字段 | `UC-17` → `status:"paused"` + 六项披露（I-27 I-28） | `chat-approval-card` `chat-approval-status` `chat-approval-callchain-toggle` `chat-approval-model` `chat-approval-budget` `chat-approval-datascope` `chat-approval-actions` | ✅ |
| **V2** | 三出口各跑一遍：批准→执行且产生后台任务；改参→生成新请求、原请求存档「已改参」；不用了→永不执行且记审计 | `UC-18 approve/reparam/decline`（I-29 I-30） | `chat-approval-approve` `chat-approval-confirm-yes` `chat-approval-reparam` `chat-approval-reparam-run` `chat-approval-decline` `chat-approval-approved` `chat-approval-declined` `chat-approval-queue` | ✅ |
| **V3** | 机密数据强制：含机密 + 云端模型 → **服务端拒绝**，错误指向「含机密仅本地模型」；API 层成立，不依赖界面禁用 | `UC-17` → `MODEL_POLICY_VIOLATION`（I-32） | `chat-approval-policy-violation` `chat-approval-datascope-note` `chat-approval-toggle-local` | 🔴 **缺口 4 —— 口径未裁决** |
| **V4** | 过期态：超时后调批准接口被拒，状态 `已过期 · 未执行`；默认现场 5 分钟 / 非现场 24 小时且可配 | `UC-18` → `APPROVAL_EXPIRED`（O-36） | `chat-approval-expired-note` `chat-approval-status` | ⚠ **缺口 5**（原型无过期态，现有呈现是实现补的） |
| **V4b** | 预算耗尽：用到 100% → 转「等待输入」求追加，**不硬停也不继续**；追加后可继续 | `UC-17` → `BUDGET_EXHAUSTED`（状态而非终止）+ `UC-19` `needs-input` | —（API 层验收；任务屏在 11-task） | ⚠ **缺口 6**（跨 11-task） |
| **V4c** | model registry：模型标识、单价、折算金额、用途策略全来自 registry；改 registry 单价卡上金额随之变；本模块无硬编码模型名或价目 | `UC-17` 读 registry（I-31） | `chat-approval-model` `chat-approval-budget` | ❌ **缺口 7 —— 现状相反**（价目住在 `lib/mock/chat.ts`） |
| **V5** | AC3 调用链：每条返回 `function`/`args`/`hit_count 或 reuse_flag`/`status` 四项非空；汇总数=明细条数、读取量=各条之和 | `UC-14 expandToolCalls`（I-22 I-25） | `chat-tool-calls` `chat-tool-calls-toggle` `chat-tool-calls-detail` `chat-tool-call-row` | ✅ |
| **V6** | AC4 主动发言必带来源：取不到来源时**没有任何消息被发出**；关闭该 agent 主动插话后只在被 `@` 时发言 | `UC-10 proactiveSpeak` → `{emitted:false}`（I-19） | `chat-team-toggle-<id>`（单 agent 开关）；发言缺席 —（API 层验收） | ⚠ **缺口 8**（「单个 agent 可关」的持久化契约未定） |
| **V7** | 引用角标三段：`index` / `source_full_name` / `page 或 transcript_range` 三项非空 | `UC-15 resolveCitation`（I-24） | `chat-citations` `chat-citation-row` `chat-citation-anchor` | ✅ |
| **V7b** | 血缘：① 每条工具调用对应一条 `provenance_events` 且**改它被拒**（append-only）② 展开条数与事件条数**严格相等** ③ `agent_run` 关联可重放的 `context_packs` ④ anchor 100% 可定位 | `UC-14` + `UC-16 replayContextPack`（I-22 I-23 I-24） | `chat-tool-call-row`（条数一致靠断言，不靠界面） | ⚠ **缺口 3**（provenance 查询面跨束） |
| **V7c** | Context API：静态检查 agent 取上下文路径无对 `segments`/向量库/对象存储的直连；跨 tenant/项目泄漏为零 | 静态门控（`lint-arch-deps` 扩展）+ 泄漏测试（I-26） | —（API 层验收） | ⚠ **缺口 9**（门控脚本未写） |
| **V7d** | file-first：① 该会话在对象存储有**一个** `messages.jsonl`（不是 N 个）② 在 22-files 可见可下载且按 UC-8.5 判权 ③ 任一消息 Segment 的 anchor 为 `messageId` 且可定位 | `UC-6 getThreadFile`（I-16 I-12） | `/projects/[id]/files` `files-preview-jsonl`（22-files 束） | ⚠ **缺口 10**（跨 22-files 束） |
| **V8** | AC5 角标位置：降级生成 → 该条消息 `badges` 含 `降级运行 · <模型名>`，其它消息不含；`待复核 N` 与线程卡数值相等 | `UC-9` 的 `badges[]`（I-13） | `chat-badge-degraded` `chat-badge-review` | ⚠ 同 **缺口 1** |
| **V9** | 右栏五标签：返回**恰好五个** `转录/执行/洞察/产物/材料`，每个计数与列表长度一致（`执行` 为 `已完成/总数`） | `UC-11 getRightTabs`（I-20） | `chat-right-panel` `chat-tab-transcript` `chat-tab-execution` `chat-tab-insight` `chat-tab-artifact` `chat-tab-material` | ✅ |
| **V10** | AI 团队三态：每个 agent 返回 `在场\|跑批中\|空闲` 之一与**非空职责一句话**；越枚举或职责空即失败 | `UC-7 getTeamPanel`（I-17） | `chat-team-panel` `chat-team-agent-<id>` `chat-team-presence-<id>` | ✅ |
| **V11** | 改派提示响应体含非空 `reason`（原型例「有行业数据库授权」） | `UC-12 reassignSuggestion`（I-21） | `chat-reassign-bar` `chat-reassign-reason` `chat-reassign-apply` | ✅ |
| V12 | AC1：两个入口打开同一线程，标题、组名与措辞完全一致 | `UC-1 getThreadDetail`（同一 schema） | `chat-thread-header` `chat-main` | ⚠ **缺口 11**（「项目工作台 → 与 AI 的对话」入口未建） |
| V13 | 权限态：五身份遍历；**观察者**响应体中**不含**输入区/批准卡/原始转写/任何操作按钮的能力标记 | `UC-1` 的观察者投影（I-5） | `chat-observer-tag` `chat-readonly-note`（`?as=observer`） | ✅ |
| V14 | 空态：新线程无消息时显示真实空态与下一步，**不生成示例对话**；右栏五标签计数全 0 且**不隐藏标签** | `UC-9` → `[]` + `UC-11` 全 0（I-20） | `chat-message-stream`（空态）＋ `chat-tabpanel-<key>` | ✅ |
| V15 | 依赖失败：MCP/模型/转录任一失败 → 失败条在调用链中可见并标失败，基于它的结论标不完整，输入与最近成功数据保留 | `UC-14` 的 `status:"failed"` + `incomplete`（I-25） | `chat-tool-call-row`（失败态）；`/chat?state=dep-failed` | ✅ |
| V16 | 降级分级三分支各有独立断言：普通生成自动降级并标注；研究/财务/合规/决策辅助**先问人**；含机密**明确失败**而非降级 | `UC-17`（先问人 = 出批准卡）+ `UC-9` `badges`（自动降级）+ `MODEL_POLICY_VIOLATION`（明确失败） | `chat-badge-degraded` `chat-approval-card` `chat-approval-policy-violation` | 🔴 同 **缺口 4**（第三分支依赖裁决） |
| V17 | 并发：两人同时点批准，只有一个生效，另一个收到状态已变化 | `UC-18` `expectedStatus` → `APPROVAL_STATUS_CHANGED`（I-29） | —（API 层验收） | ✅ |
| V18 | 审计：批准/改参/拒绝/每次工具调用/agent 编制变更五类事件可按操作者、触发 agent、时间、对象、结果检索；越权也留痕 | `UC-27 queryAudit` | —（API 层验收） | ⚠ 同 **缺口 3** |

---

## 三、uc-8-3 R12（13 条：V1–V4d、V5–V10）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | AC2 门控（优先级最高）：实时关联对四个下游接口**全部拒绝**指向「需先定版」；固定快照全部成功；草稿同样全拒 | `UC-21 referenceForDownstream`（委托 phase-00 `artifact`，I-34） | —（下游屏在 10-report / 13-deliv / 09-kg / 14-brain） | ⚠ **缺口 12**（12 格矩阵跨四个下游） |
| **V2** | AC1 出处回链：任取一条落地产出，返回 `conversation_id`/`message_id`/`citations[]` 三项非空且能定位回原消息 | `UC-20 landArtifact` 的 `provenanceBacklink`（I-33） | `chat-artifact-card` `chat-artifact-action-<i>`（`[加入报告]`） | ✅ |
| **V3** | AC3 标灰门：无引用的结论只允许落草稿；调「加入报告」被拒；列表中 `has_source = false` | `UC-20` → `MISSING_PROVENANCE_BACKLINK` + `UC-22` 的 `hasSource`（I-37） | `chat-artifact-card`（标灰呈现**未建**） | ⚠ **缺口 13**（对话侧标灰无原型，见 domain 待裁决 7） |
| **V4** | 快照不可变：定版 `artifact@v1` 后改源再读 v1 **内容字节一致**；改/删 v1 被拒并记审计 | `UC-20 mode:"pinned"` → 委托 `pinVersion`；写路径 → `SNAPSHOT_IMMUTABLE` | `/projects/[id]/files` `files-version-row`（`artifact` 束） | ✅（机制在 phase-00） |
| **V4b** | 快照 = `artifact_versions` + SHA-256：①四项非空 ②重算哈希相等 ③生成 v2 后 v1 仍可读且哈希不变 ④`supersedes_*` 指回 v1 且 v1 未删 ⑤到期删除不触及快照 | 委托 phase-00 `artifact`（本束不重复实现，D-38）；I-42 覆盖⑤ | `files-version-copy-sha` `files-integrity-badge`（`artifact` 束） | ✅（机制在 phase-00） |
| **V4c** | file-first：每个产出版本在 22-files 可见可下载；AI 产出另有 `provenance.json`（prompt/model/run/引用清单）；对话本身为**一个** `messages.jsonl`；**草稿在文件浏览器中同样仅创建者可见** | `UC-6` + `UC-20` 的物化（I-12 I-16 I-36） | `/projects/[id]/files` `files-preview-jsonl`（22-files 束） | ⚠ 同 **缺口 10** |
| **V4d** | 引用可定位：定版时固化的 Context Pack 引用清单 **100% 可定位**；含不可定位引用的产出**定版被拒、只能落草稿** | `UC-20` → `CITATION_UNRESOLVABLE_REQUIRES_DRAFT` + `UC-15`（I-24 I-33） | —（API 层验收） | ✅ |
| **V5** | 模式徽标：右栏产物列表每条返回 `mode`/`version`/`pinned_by`/`pinned_at`（草稿除外），徽标文案与 `mode` 一一对应 | `UC-22 listChatArtifacts` | `chat-tab-artifact` `chat-tabpanel-artifact` `chat-artifact-card` | ⚠ **缺口 14**（三模式徽标与选择器在对话侧未建） |
| **V6** | 权限态：五身份遍历；**草稿模式产出仅创建者可读，其余（含管理员）返回 404 而非 403** | `UC-22` / `UC-0`（I-36 I-3） | `?as=` 四视角 | ✅ |
| V7 | 空态：线程无产出时右栏「产物」计数为 0 且显示真实空态，不生成伪产出 | `UC-22` → `[]` + `UC-11` 计数 0 | `chat-tab-artifact` `chat-tabpanel-artifact`（空态） | ✅ |
| V8 | 依赖失败：报告/图谱服务失败时**产出与其绑定关系不变**，错误可解释可重试 | `UC-21` 下游失败不回写本束状态 | `/chat?state=dep-failed` | ✅ |
| V9 | 并发：两人同时对同一 Artifact 定版，只产生一个新版本号，另一方收到版本已变化 | `UC-20` → `VERSION_CHANGED`（委托 `pinVersion` 的乐观并发） | —（API 层验收） | ✅ |
| V10 | 审计：落地/定版/绑定/解绑四类动作可按操作者、时间、对象、结果检索；越权也留痕 | `UC-27 queryAudit` | —（API 层验收） | ⚠ 同 **缺口 3** |

---

## 四、uc-8-4 R12（8 条：V1、V1b、V1c、V2–V6）

⚠ 本 UC 的**全部核心行为标 `[Backlog]`**——「预设」二字在原型抽取档案中 **0 命中**。
下表「前端消费点」列里凡写「**未建**」的，不是遗漏，是**整块屏不存在**。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：三人各自开始同一预设 → 计数为 **3**（实例数）；下发给 10 人只 3 人开始，计数仍为 3 | `UC-26 getPresetUsage`（I-38）+ `UC-25` 的幂等 | **未建**（预设使用计数无原型） | ❌ **缺口 15** |
| **V1b** | 预设 ≠ 实例：预设对被下发者可见，但 A 开始后生成的实例对 B 不可见（判定来自 UC-8.5） | `UC-25` + `UC-0`（I-39） | **未建**（预设列表无原型）；实例侧 `chat-thread-list` | ❌ 同 **缺口 15** |
| **V1c** | 范围校验：预设引用「仅能源组」的 agent 下发给非能源组 → **下发接口即拒绝**，错误标明是**组织层**可见性限制 | `UC-24 dispatchPreset` → `AGENT_OUT_OF_SCOPE`（I-40） | **未建**（下发对象选择器无原型） | ❌ 同 **缺口 15** |
| V2 | 权限态：五身份遍历，返回数据与可执行动作严格符合 R5 | `UC-0` + `UC-23/24/25` 的角色前置 | `?as=` 四视角（对实例生效）；预设屏**未建** | ⚠ 部分 |
| V3 | 空态：无目标数据时显示真实空态与下一步，不生成伪数据 | `UC-26` / `UC-24` → 空集合 | **未建** | ❌ 同 **缺口 15** |
| V4 | 依赖失败：输入与最近成功数据保留，错误可解释可重试 | `UC-23/24` 的依赖失败出口 | **未建**（七态矩阵未覆盖预设屏） | ❌ 同 **缺口 15** |
| V5 | 并发：两人修改同一资源不静默覆盖，可识别最终版本 | `UC-23` `expectedVersion` → `VERSION_CHANGED` | —（API 层验收） | ✅ |
| V6 | 审计：关键动作可按操作者、时间、对象、结果检索；越权尝试也留痕 | `UC-27 queryAudit` | —（API 层验收） | ⚠ 同 **缺口 3** |

---

## 五、uc-8-5 R12（15 条：V1–V4b、V5–V14）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | AC2 跨组不可见：第 2 组组员/组长请求第 3 组对话 → 拒绝且**不泄露是否存在**；引导师请求同一对话 → 成功 | `UC-0` → `NOT_VISIBLE`（I-6 I-3） | `?as=groupLead\|member\|facilitator` | ✅ |
| **V2** | 组员私聊三方可见：A 本人 / 本组组长 / 引导师均可读；同组组员 B 与观察者不可读 | `UC-0` 的 `member-private` 判定（I-7） | `?as=` 四视角；私聊线程**未建**（无入口） | ⚠ **缺口 16**（私聊入口与告知文案未建） |
| **V3** | AC3 观察者降级（服务端）：响应体中**不存在**原始转写字段、私聊消息、任何写能力标记；直接调这些写接口全部拒绝 | `UC-1` 观察者投影（I-5）+ 各写端口拒绝 | `chat-observer-tag` `chat-readonly-note`（`?as=observer`） | ✅ |
| **V4** | 管理员审计读（O-04）：无项目角色的项目里读**项目层**内容 → **成功返回内容（不是 403）**；①产生审计事件 ②项目负责人可查 ③读**个人层**只返计数 | `UC-2 adminAuditRead`（I-8） | —（API 层验收；活动流屏在 17-gov） | ⚠ **缺口 17**（旧稿断言方向相反，见下） |
| **V4b** | agent 私聊归属（O-24）：①归属层 = `project` ②管理员可读并留痕 ③入口含「本对话属于本项目，可被审计」④组员发起**默认被拒**，引导师开关后放行 ⑤在场态计数不变 ⑥`[转出到主线程]` 后可被审计检索（无断链） | `UC-0` + `UC-2` + `UC-7`（I-9 I-10）；③④⑥ **无端口** | 私聊入口**未建** | ⚠ 同 **缺口 16** |
| **V5** | AC4 拒绝可解释：组织层拒绝与项目层拒绝的判定记录中 `denied_layer` 分别为 `organization` / `project` | `UC-0` 的 `deniedLayer`（I-4） | `/chat?state=denied`（区分两层的文案**未建**） | ⚠ **缺口 18** |
| **V6** | 研究阶段两档：`私有` 仅创建者可读；`团队可见` 对同团队可读、对其他团队不可读 | `UC-0` 的 `private` / `team-visible`（I-1 I-2） | —（API 层验收；范围徽标未建） | ⚠ **缺口 19** |
| **V7** | 单独授权与自动失效：授权期间可读且**留痕**；**环节结束后同一请求被拒绝** | `UC-3 grantObserverTempAccess`（`expiresOn:"stage-end"`） | —（API 层验收） | ⚠ **缺口 20**（「环节结束」触发点未定） |
| **V8** | AC1 徽标态：列表与详情接口对每条对话返回 `visibility_scope` 且取值在枚举内；界面徽标**待补原型后再定 testid** | `UC-4` / `UC-1` 的 `visibilityScope`（I-1） | **待补原型**（`chat-share-scope-note` 是分享范围，不是可见范围徽标） | ⚠ 同 **缺口 19** |
| V9 | 空态：无可见对话时显示真实空态而非空列表伪装，**不泄露存在但不可见的条目数** | `UC-4` → `groups: []`（I-3） | `chat-thread-list`（空态） | ✅ |
| V10 | 依赖失败：**鉴权服务不可用时一律拒绝，不得降级为放行** | `UC-0` → `AUTHZ_UNAVAILABLE`（硬拒） | `/chat?state=dep-failed` | ✅ |
| V11 | 并发：操作过程中项目角色被撤回，后续读写立即失败，已完成步骤保留审计 | `UC-1`/`UC-5` → `ROLE_REVOKED_MIDFLIGHT` | —（API 层验收） | ✅ |
| V12 | 审计：越权尝试、观察者单独授权、管理员审计访问三类事件均可按操作者、时间、对象检索 | `UC-27 queryAudit` | —（API 层验收） | ⚠ 同 **缺口 3** |
| **V13** | file-first + 权限不旁路：①每会话**一个** `messages.jsonl`、anchor 为 `messageId` ②在 22-files 中组员取不到别组会话与他人私聊、观察者取不到转写与私聊 ③管理员可下载项目层文件但**产生审计事件** | `UC-6 getThreadFile`（I-12 I-16）+ `UC-2` | `/projects/[id]/files`（22-files 束） | ⚠ 同 **缺口 10** |
| **V14** | Context API + RLS：①静态检查无对 `segments`/向量库/对象存储的直连 ②跨 tenant/项目泄漏为零 ③应用 DB 连接**不是表 owner 角色** ④多来源摘要取**最严格**可见性 | 静态门控 + 泄漏测试（I-26 I-11）；③委托 phase-00 `api-kernel`/`identity` 的 RLS | —（API 层验收） | ⚠ 同 **缺口 9** |

---

## 六、缺口清单（这一件的真正价值所在）

> 这 20 条是**这一轮设计的产出**，不是失败。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **「待复核 N」两处显示、一处计算**。线程卡徽标（uc-8-1 V2）与消息头角标（uc-8-2 V8）**必须数值相等**。现在没有任何东西保证它们同源 | 单源风险（**本仓第一高发缺陷**） | `chat.ts` 里只暴露一个 `reviewPendingCount` 投影，两处都读它；加一条门控断言两接口返回值相等。⚠ **不要**让列表接口自己 `count(*)` 一遍 |
| **2** | **归档线程的显式筛选入口未建**。V5 要求「显式筛选可读」，`/chat` 上没有筛选控件（移动端筛选条 `全部/远洋项目/我的 AI 团队` 也不含归档） | 界面缺口 | 随 F109 交付；API 侧 `includeArchived` 可先行开工并用 API 断言验收 |
| **3** | **审计/provenance 查询面跨束**。V8（8-1）/ V18（8-2）/ V10（8-3）/ V6（8-4）/ V12（8-5）**五份 UC 都要求同一件事**：按操作者/时间/对象检索。phase-00 `artifact` 与 `identity` 束的缺口①也是这件事 | **跨束** | 提**阶段一致性复核**：统一一个 provenance/audit 查询面。本束是它的消费者，**不得自建**。这是 `design-signoff.md` 的 X-2 |
| **4** | 🔴 **含机密的模型路由口径未裁决**（V3 / V16 第三分支）。D-U1 说「整轮走本地」，`ui-preview` **S-01** 说实现取的是「机密走本地、云端并存」，原型自己字面矛盾 | **跨束 + 需人类裁决** | 见 `domain.md` 待裁决第 1 条。**裁决前 I-32 的判定函数不得写死**；`agent-runtime` 束写同一条、指向同一裁决（X-1）。**gateway 只能有一个实现** |
| **5** | **批准卡过期态原型缺失**。卡片六项 + 三出口逐项渲染完整，**无任何过期呈现**；现有 `chat-approval-expired-note` 是实现补的 | 界面缺口 + 待确认 | 补原型；O-36 已给时限默认值（现场 5min / 非现场 24h），文案与力度需产品确认 |
| **6** | **预算耗尽转「等待输入」跨 11-task**。V4b 的「不硬停也不继续」发生在任务侧，不在对话侧 | 跨束 | 一致性复核确认 11-task 的 `needs-input` 态与本束 `BUDGET_EXHAUSTED` 是同一件事，不各定义一套 |
| **7** | ❌ **model registry 供数：现状与 V4c 相反**。`apps/web/lib/mock/chat.ts` 里就住着模型型号与价目；`ui-preview` **S-13** 自承「18 台模型的型号与定价全是编的」 | 已知的反例 | F112 开工第一件事：`chat.ts` 落地后 mock **从契约生成**，型号/价目改由 registry 供；加静态门控禁止本模块出现模型字面量与货币单价常量 |
| **8** | **「单个 agent 可关主动插话」的持久化契约未定**。V6 要求关掉后「只在被 `@` 时发言」，但这个开关存在哪一层（线程级 / 项目级 / 组织级）UC 没写 | 需裁决 | 提签核：建议线程级（与「本线程的 AI 团队」同层），但这是产品的决定。界面上 `chat-team-toggle-<id>` 已存在但只是本地态 |
| **9** | **Context API 直连禁止 + RLS 非 owner 连接，无门控脚本**（V7c / V14）。这两条是「静态检查」，而本仓的纪律是**没有脚本的规范条目视为未落地** | 门控缺口 | 扩 `lint-arch-deps.mjs`：禁止 chat 模块 import 向量库/对象存储 SDK；加一条 DB 连接角色断言。⚠ 写完立刻造反证 |
| **10** | **`messages.jsonl` 与文件浏览器判权跨 22-files 束**（V7d / V4c / V13）。**五份 UC 全都重复写了这条**——这是它容易被两处各实现一遍的信号 | **跨束** | 一致性复核：文件侧**不得自建判权**，与 `UC-0` 共用一套 `acl_bindings`。这是 X-5 |
| **11** | **「项目工作台 → 与 AI 的对话」入口未建**。V12 要求两个入口打开同一线程措辞一致，现在只有一级导航「对话」一个入口 | 界面缺口 | 随项目工作台屏交付；契约侧同一 schema 已足够，可 API 断言先行 |
| **12** | **引用资格 12 格矩阵的四个下游都不在本束**（8-3 V1）。phase-00 `artifact` 的缺口③正是同一件事的另一侧 | **跨束** | 一致性复核确认：10-report / 13-deliv / 09-kg / 14-brain **各自都要过同一个 `referenceForDownstream`**，不各判各的。这是 X-3 |
| **13** | **对话侧「未挂来源标灰」无原型**（8-3 V3）。标灰原文在**洞察报告工作台**，对话屏已完整探明、未见任何标灰 | 界面缺口 + 待裁决 | 见 `domain.md` 待裁决第 7 条。`hasSource` 的服务端判定可先行（它是 API 层的），界面呈现等裁决 |
| **14** | **三模式选择器与产物徽标在对话侧未建**（8-3 V5）。phase-00 `artifact` 束的缺口④说的也是这个（「三模式选择流点进去无任何屏」） | 界面缺口（**与 phase-00 同一处**） | ⚠ 三模式选择必须**并列展示各自后果**（能否被引用 / 是否随源变动），**不是三个裸单选**。两个束指的是同一块 UI，别做两遍 |
| **15** | ❌ **F115 的整块屏不存在**。预设列表、编辑器、下发对象选择器、使用计数、接收入口在已完整探明的对话屏、后台九子模块、组员入口中**全部无入口** | 界面缺口（**最大的一块**） | uc-8-4 自述「本 UC 全部主流程步骤据此不得按 `[原型]` 实现」。需 ui-prototyper 补画后才能签第 ① 件 |
| **16** | **私聊入口与告知文案未建**（8-5 V2 / V4b③④）。契约上组长能看本组组员私聊、组员默认不可私聊、入口须明示可被审计——**三条都没有界面** | 界面缺口 + 待裁决 | 见 `domain.md` 待裁决第 9 条。⚠ 「组长能看组员私聊」是反直觉的，无告知即上线是合规风险 |
| **17** | **管理员越权断言的方向被 O-04 反转过**（8-5 V4）。早期稿本写「无项目角色即一律被拒」，档案与裁决都是「可读、必留痕」 | 已知的陷阱 | uc-8-5 逐字写着「早期稿本的断言**作废**，不得据此写测试」。**照旧稿写会产出一个方向相反的绿灯**——签核时请确认写测试的人知道这条 |
| **18** | **「为什么被拒」区分两层的界面未建**（8-5 V5）。`?state=denied` 有七态占位，但**不区分组织层/项目层** | 界面缺口 | AC4 的服务端一半（`deniedLayer`）可先行；界面文案需补 |
| **19** | **可见范围徽标整体缺原型**（8-5 V8 / V6）。线程卡与线程头上**没有这个徽标**，UC 自己承认了 | 界面缺口 + 待裁决 | 见 `domain.md` 待裁决第 2 条。**服务端 `visibility_scope` 字段是 [原型] 明确的**，缺的只是界面这一半 |
| **20** | **观察者单独授权「环节结束自动失效」的触发点未定**（8-5 V7）。「环节切换」还是「环节标记完成」，两者在边界上行为不同 | 需裁决 | 见 `domain.md` 待裁决第 10 条。UC-3 的 `expiresOn: "stage-end"` 是个占位，语义待填 |

---

## 七、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `UC-0 resolveVisibility` | 8-5 V1 V2 V3 V5 V6 V10 V11；其余四份 UC 的全部权限态 | ✅ 本束地基 |
| `UC-1 getThreadDetail` | 8-2 V12 V13 V14；8-5 V3 V8 | ✅ |
| `UC-2 adminAuditRead` | 8-5 V4 V4b② V13③ | ✅ |
| `UC-3 grantObserverTempAccess` | 8-5 V7 | ✅ |
| `UC-4 listThreads` | 8-1 V1 V4 V5；8-5 V8 V9 | ✅ |
| `UC-5 create/rename/deleteThread` | 8-1 V5 V7 V8 | ✅ |
| `UC-6 getThreadFile` | 8-2 V7d；8-3 V4c；8-5 V13 | ✅ |
| `UC-7 getTeamPanel` | 8-2 V10；8-5 V4b⑤ | ✅ |
| `UC-8 updateRoster`（`[编制]`） | 8-2 V18（编制变更审计） | ⚠ **弱**：`[编制]` 是原型空按钮，只有审计一条 R12 要它。**保留但标 `[设计]`**，签核时确认是否本轮做 |
| `UC-9 listMessages` | 8-2 V8 V14 V15 | ✅ |
| `UC-10 proactiveSpeak` | 8-2 V6 | ✅ |
| `UC-11 getRightTabs` | 8-2 V9 V14；8-3 V7 | ✅ |
| `UC-12 reassignSuggestion` | 8-2 V11 | ✅ |
| `UC-13 transcriptControl` | 8-2 V13（观察者不得有此能力）；R3 步骤 7 转录卡 | ⚠ **弱**：R12 里只有反向要求（观察者不能用），**正向验收线索缺失**。实时转录本体属 05-rec，本束只留控制入口 |
| `UC-14 expandToolCalls` | 8-2 V5 V7b V15 | ✅ |
| `UC-15 resolveCitation` | 8-2 V7 V7b④；8-3 V4d | ✅ |
| `UC-16 replayContextPack` | 8-2 V7b③ | ✅ |
| `UC-17 requestApproval` | 8-2 V1 V3 V4b V4c V16 | ✅ |
| `UC-18 approve/reparam/decline` | 8-2 V2 V4 V17 V18 | ✅ |
| `UC-19 getTaskStatus` | 8-2 V2（「产生一条后台任务」）V4b | ⚠ **可能多余**：任务态本体属 11-task。本束只需**回流那条结果消息**。一致性复核时确认是引用还是重造 |
| `UC-20 landArtifact` | 8-3 V2 V3 V4 V4d V9 | ✅ |
| `UC-21 referenceForDownstream` | 8-3 V1 | ✅ **但它不是本束的实现**——委托 phase-00 `artifact`（见缺口 12） |
| `UC-22 listChatArtifacts` | 8-3 V5 V6 V7 | ✅ |
| `UC-23 createPreset` | 8-4 V5；R7（不得预批准 / 不得绕过同意位） | ✅ |
| `UC-24 dispatchPreset` | 8-4 V1c V2 | ✅ |
| `UC-25 startPresetInstance` | 8-4 V1 V1b | ✅ |
| `UC-26 getPresetUsage` | 8-4 V1 V3 | ✅ |
| `UC-27 queryAudit` | 8-1 V8；8-2 V18；8-3 V10；8-4 V6；8-5 V12 | ⚠ **五份 UC 共用** —— 正因如此它**不该是本束的接口**，见缺口 3 |

**结论**：无孤儿接口。三个「弱」项（UC-8 / UC-13 / UC-19）与一个「共用」项（UC-27）
在签核时需人类确认是**保留、降级为委托、还是移出本束**。
