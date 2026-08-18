# chat 用户画像生成与图表保存读回闭环（G1+G2）· contract delta

Status: proposed; human signoff required。

> 背景来源：人类 2026-08-18 提出并**真机验证过**的端到端场景，本材料直接采信该验证结论，
> 不重复调查。凡引用具体代码位置的判断都标注文件路径与行号，供人类自行复核。

实测基线：`origin/main`（SHA `41208c8f`，分支 `worker/usamshen-chat-persona-roundtrip-signoff`），
`packages/contracts/src/chat.ts`、`apps/web/components/chat/`、
`apps/api/migrations/20260801190000_f114_chat_artifact_landings.sql`。

## 零、端到端场景与两个缺口（人类真机验证结论，原样登记）

场景：后台基于 persona 模板开新版 → chat 里触发「生成用户画像」并在返回消息里渲染 →
最大化编辑保存 → 退出重进看到保存的版本。

| 环节 | 现状 | 依据 |
|---|---|---|
| `mintTemplateVersion` 开新版 | ✅ 真实可用 | #988 已签已实现（`design-deltas/canvas-mermaid-templates/`） |
| chat 里 ```mermaid 围栏自动渲染 | ✅ 真实可用 | `apps/web/components/chat/markdown-message.tsx` → `chat-diagram-fabric.tsx` |
| 最大化编辑后保存 | ✅ 真实落库 | `chat-diagram-canvas-modal.tsx` 的 `handleSave` 走 `landAsArtifact`（`POST /chat/threads/:threadId/artifacts`），保存为**新的独立 canvas draft artifact**，不改原消息 |
| **G1：保存后读回** | ❌ 缺失 | `listThreadArtifacts.out`（chat.ts:996-1011）条目只有 `artifactId/title/mode/version/pinnedBy/pinnedAt/hasSource`——**没有 `messageId`，也没有任何按 artifactId 取回落地内容（markdown）的操作**。chat 束与 artifact 束（artifact.ts 八操作：saveDraft/pinVersion/bindToProjectStep/upgradeBinding/listBackflow/referenceForDownstream/getIngestionStatus/markEvidenceWithdrawn）都没有内容读取端口。退出全屏重进，modal 永远从原始消息文本初始化（`chat-diagram-canvas-modal.tsx:45` 的 `initialMarkdown` 来自消息 `code`），看不到保存的修改 |
| **G2：生成用户画像触发点** | ❌ 缺失 | 后端 `summarizePersonaFromThread`（`apps/api/src/application/chat/summarize-persona-from-thread.ts`，契约 chat.ts:949-970，`POST /chat/threads/:threadId/persona-summary`）已实现、有真栈测试，但契约标注 🟡 待人类补签（`KNOWN_CONTRACT_GAPS.C_CHAT_11`，chat.ts:1413），且 apps/web 全仓零触发点。现在的产出是落一份 Artifact，不在消息里渲染 |

本 delta 覆盖两件事，均**只产出设计材料，不改契约代码**——`packages/contracts/src/chat.ts` 分文不动：

1. **G1 读回闭环**：`listThreadArtifacts` 条目补 `messageId` + 新操作 `getThreadArtifactSource`
   取回落地 markdown，modal 重开时用最新保存版初始化。
2. **G2 触发与呈现**：`summarizePersonaFromThread` 补签现状形状 + 新增「产出以 assistant
   消息形式进入线程、内容为 mermaid mindmap 围栏」的行为约定 + chat UI 触发入口。

---

## 一、UI（对应第①件）

> 无原型截图工具，以下用文字描述交互流程与状态，不虚构截图文件（同 #988 材料的处理方式）。

### 1.1 G2 触发入口——候选落点（列出供人类选）

实测 `apps/web/components/chat/` 现状：消息输入区是 `composer.tsx`
（`chat-composer` / `chat-composer-status` 状态条 / `chat-composer-settings` 设置入口 /
`chat-composer-send`）；**每条消息已有一个「落地为产物」动作**
（`chat-live-message-panel.tsx:1375` 的 `chat-land-artifact-open-${message.id}`，
点击展开内联表单调 `landAsArtifact`）。三个候选落点：

- **候选 A（推荐）：composer 状态条动作**。在 `chat-composer-status` 行（今天放
  settings 入口与状态徽章的那一行）加一个「生成用户画像」按钮
  （`data-testid="chat-persona-summary-trigger"`）。理由：画像是**对整个线程**的收敛
  （`summarizePersonaFromThread.in` 只要 `threadId` + 锚定 `messageId`），不是对某一条
  消息的动作，挂在 composer 层级与语义一致；且与既有 per-message「落地为产物」动作
  不打架。
- **候选 B：per-message 工具栏动作**。仿 `chat-land-artifact-open-${message.id}` 在
  每条消息尾部再加一个「生成用户画像」。缺点：语义错位（画像扫的是全线程，不是这条
  消息），且消息尾部动作区已经有落地入口，再加一个会拥挤。
- **候选 C：右栏产物面板（`chat-artifacts-panel.tsx`）头部动作**。缺点：右栏是「看
  产物」的地方，把「生成」动作藏在那里可发现性差，与「返回消息里渲染」的产出形态
  也不在同一视线。

三个候选都不需要新增布局容器，选定后由实现 feature 落 `data-testid`。

### 1.2 G2 产出形态——mermaid mindmap 围栏（关键设计取舍，供人类裁决）

产出以 **assistant 消息**进入线程，正文为一个 ```mermaid mindmap 围栏：
根节点 = 画像名，六个分支对应 persona 模板六分区（权威源
`packages/fabric-markdown/src/diagrams/persona.ts:26-33` 的 `PERSONA_SECTIONS`）：
`用户描述 / 目标和需求 / 行为与偏好 / 痛点和挑战 / 动机 / 影响因素`，各分支下挂线程里
真实收敛出的要点（`sufficient: false` 时六分支下各挂一个「信息不足」占位节点，不编造）。

**取舍：用 mindmap，不扩展渲染白名单。**

- **方案甲（本材料推荐）**：```mermaid mindmap 围栏。渲染（`markdown-message.tsx` →
  `chat-diagram-fabric.tsx`）、最大化（`chat-diagram-maximize`）、编辑、保存
  （`landAsArtifact`）**全部复用现有 mermaid 通道，零白名单契约改动**——mindmap 已在
  `@repo/fabric-markdown` 的 `DiagramKind` 里（`src/model.ts`），#988 裁定的
  `MermaidDiagramType` 12 类也含 `mindmap`。
- **方案乙**：```persona 围栏 + 扩展 chat 渲染白名单，让消息里直接渲染 persona 画布
  模板（`template-engine.ts` 那条路径）。优点：产出形态与后台 persona 模板逐字段同构；
  缺点：改动面大得多——chat 消息渲染通道要新认一种围栏、最大化/编辑/保存三环节都要
  为 template 路径另接一遍，且 `summarizePersonaFromThread` 现落 Artifact 的行为约定
  也要连带改写。
- 本材料按方案甲写其余各节；若人类裁方案乙，G2 各节需要重出一版材料。

### 1.3 G1 读回交互

点击消息里图表的「最大化」（`chat-diagram-maximize`）时：

- 前端先查该 `(threadId, messageId)` 是否已有保存过的落地版本（依赖 G1a 的
  `listThreadArtifacts.out.items[].messageId` 才能建立这个关联）；有 ⇒ 调 G1b 的
  `getThreadArtifactSource` 取回最新保存的 markdown，modal 用**最新保存版**初始化。
- **不能静默替换**：modal 顶部显示提示条「已加载你 X 时间前保存的版本」
  （`data-testid="chat-diagram-loaded-saved"`，时间来自 `savedAt` 的相对格式化），
  旁边一个「回到原始版本」按钮（`data-testid="chat-diagram-revert-original"`）——点击
  把编辑区重置为原始消息文本初始化的 `initialMarkdown`，提示条切换为「正在查看原始
  版本」+「回到保存版」出口，用户任何时刻都能分辨看到的是原始还是编辑版。
- 无保存版 ⇒ 行为与今天完全一致（原始消息文本初始化，无提示条）。
- 读回失败（`NOT_VISIBLE`，如换了账号看别人草稿）⇒ 静默退回原始版本初始化 + 不显示
  提示条——草稿仅创建者可见（I-36），别人本就该看到原始消息。**待裁决**：是否要在
  这种场合显示「有你看不到的草稿版本」的提示（本材料默认不显示，避免泄露草稿存在性；
  与 I-36 的 404 语义一致）。

---

## 二、用例（对应第②件）

| 用例 | 触发 | 前置条件 | 输出 | 失败模式 |
|---|---|---|---|---|
| **生成画像（线程有内容）** | 用户点「生成用户画像」 | 线程可见 + 有写角色；线程正文含 `persona` 文本语法可辨认的信息 | assistant 消息进入线程，正文为 mindmap 围栏（六分支有真实要点），`sufficient: true`；同时落一份 draft Artifact（现有行为保留，见三 3.3） | `NOT_VISIBLE` / `NO_WRITE_ROLE` / `STORAGE_UNAVAILABLE`（现契约三码，不新增） |
| **生成画像（线程为空/无可辨认信息）** | 同上 | 线程可见 + 有写角色；正文无画像信息 | assistant 消息 mindmap 六分支各挂「信息不足」占位节点，`sufficient: false`——不编造 | 同上三码；**待裁决**（C_CHAT_11 原登记问题）：信息不足是拒绝（新增错误码）还是落占位（现状）——本材料推荐维持落占位，拒绝会让空线程用户得不到任何可编辑起点 |
| **渲染** | assistant 消息到达 | 消息正文含 ```mermaid 围栏 | `chat-diagram-fabric` 内联渲染 mindmap | mermaid 语法非法 ⇒ 走 `markdown-message.tsx` 既有的解析失败降级（原文代码块展示），不新增失败态 |
| **最大化** | 点 `chat-diagram-maximize` | 图已渲染 | 全屏 `ChatDiagramCanvasModal` | — |
| **编辑保存（项目线程，有权限）** | modal 内改动后点保存 | `threadId`/`messageId`/`orgId` 俱全 + 有写角色 | `landAsArtifact` 落 draft，`chat-diagram-saved` 徽章 | 既有 `landAsArtifact.err` 九码，UI 走 `describeMessageFailure` 既有映射 |
| **编辑保存（个人线程，无权限）** | 同上 | 个人线程无项目写角色 | — | `NO_WRITE_ROLE` ⇒ `chat-diagram-save-error` 展示（既有行为，`chat-live-message-panel.tsx:850` 注释已登记这个 403 场景） |
| **重开读回（有保存版）** | 再次点「最大化」 | 该 `(threadId, messageId)` 存在本人可见的落地记录 | modal 用最新保存版初始化 + 「已加载你 X 时间前保存的版本」提示条 | `getThreadArtifactSource` 返回 `NOT_VISIBLE` ⇒ 静默退回原始版本（见 1.3） |
| **重开读回（无保存版）** | 同上 | 无落地记录 | 与今天一致：原始消息文本初始化，无提示条 | — |
| **回到原始版** | 提示条上点「回到原始版本」 | modal 处于保存版状态 | 编辑区重置为 `initialMarkdown`，可再切回保存版 | —（纯前端状态切换，无网络失败面） |
| **同一消息多次保存** | 反复编辑保存 | 同上保存前置 | 每次 `landAsArtifact` 落**新的** draft artifact（现状语义，不去重）；读回取 `savedAt` 最新一条 | **待裁决**：多次保存产生多个 draft 行是否需要收敛成「同一消息一个草稿、覆盖式更新」——本材料默认维持现状（不改 `landAsArtifact` 语义），读回按最新，历史行留作审计 |

---

## 三、API 契约草案（对应第③件；Zod 草案只写在本文档，不落 chat.ts）

### 3.1 G1a：`listThreadArtifacts.out.items[]` 追加 `messageId`

数据侧已就绪：`chat_artifact_landings` 表**本来就有** `message_id text NOT NULL`
（`apps/api/migrations/20260801190000_f114_chat_artifact_landings.sql:29`，出处回链
I-33 的落库半边，来自 `landAsArtifact.in.messageId`）——**不需要补列，不需要迁移**，
只是读路径没有把它投影出来。

草案（**未落代码，仅设计稿**）：

```ts
// listThreadArtifacts.out.items[] 追加一个字段：
items: z.array(z.object({
  artifactId: z.string(),
  title: z.string(),
  mode: LandingMode,
  version: z.number().int().positive().nullable(),
  pinnedBy: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  hasSource: z.boolean(),
  /**
   * 该产物落地时的来源消息（chat_artifact_landings.message_id）。
   * nullable 语义：列本身 NOT NULL，但产物列表未来可能纳入非 landing 来源的行
   * （如 phase-00 侧直接绑进线程的产物），彼时无来源消息可指——
   * ⚠ 待裁决：今天全部行都有 message_id，是签 z.string()（严格，未来要改再改）
   * 还是 z.string().nullable()（预留）。本材料按任务要求列 nullable 草案，
   * 但如实指出「严格版」是更小的承诺面。
   */
  messageId: z.string().nullable(),
}).strict()),
```

### 3.2 G1b：新操作 `getThreadArtifactSource`

```ts
/**
 * getThreadArtifactSource —— 取回一次落地的源 markdown，供 modal 重开时初始化。
 * ⚠ 草稿仅创建者可见 → 其余 NOT_VISIBLE（I-36 的同一形状，与 listThreadArtifacts
 *   同码同语义，不发明新码）。
 * ⚠ 只读端口，不新起版本机制（D-38 延续）：markdown 从 phase-00
 *   materializeArtifact 已写下的字节读回，本操作不写任何东西。
 */
getThreadArtifactSource: {
  method: "GET", path: "/chat/threads/:threadId/artifacts/:artifactId/source",
  in: z.object({ threadId: z.string(), artifactId: z.string() }).strict(),
  out: z.object({
    markdown: z.string(),
    version: z.number().int().positive().nullable(),  // 与 listThreadArtifacts 同义：draft 无冻结版本 ⇒ null
    savedAt: z.string(),      // ISO 时间戳，读回提示条「X 时间前」的数据源
    savedBy: z.string(),      // chat_artifact_landings.created_by
  }).strict(),
  err: ["NOT_VISIBLE"] as const,
},
```

未定点，如实标出留待签核：

- 同一 `(threadId, artifactId)` 若有多条 landing 行，取 `created_at` 最新一条——是否
  需要在契约层暴露「取第几次」（本材料默认不暴露，modal 只需要最新）。
- `STORAGE_UNAVAILABLE` 是否该进 err：字节从对象存储读回，存储不可用是真实失败面。
  本材料**建议加上**（`err: ["NOT_VISIBLE", "STORAGE_UNAVAILABLE"]`，两码都是既有码），
  但任务原文只点名 `NOT_VISIBLE`，列出差异供人类裁。

### 3.3 G2：`summarizePersonaFromThread` 补签 + 行为约定

**现状形状（chat.ts:949-970 原样摘录，供补签对照）**：

```ts
summarizePersonaFromThread: {
  method: "POST", path: "/chat/threads/:threadId/persona-summary",
  in: z.object({
    threadId: z.string(),
    messageId: z.string(),
  }).strict(),
  out: z.object({
    artifactId: z.string(),
    versionId: z.string().nullable(),
    contentHash: z.string().nullable(),
    mode: LandingMode,
    hasSource: z.boolean(),
    /** 线程里有没有找到任何可辨认的画像信息——false 时落地内容是「信息不足」占位。 */
    sufficient: z.boolean(),
    provenanceBacklink: z.object({
      conversationId: z.string(),
      messageId: z.string(),
      citations: z.array(Citation),
    }).strict(),
  }).strict(),
  err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "STORAGE_UNAVAILABLE"] as const,
},
```

**新增行为约定（与现状 out 的冲突，如实列出）**：产出以 assistant 消息形式进入线程、
内容为 mermaid mindmap 围栏。现契约 out **只有 Artifact 侧的回执，没有消息侧的回执**
——前端触发后要把新消息渲染出来，拿不到消息 id 就只能整线程重拉。需要的改动草案：

```ts
// out 追加一个字段（加一段不替一段，其余字段原样保留）：
/**
 * 画像以 assistant 消息进入线程（正文为 ```mermaid mindmap 围栏，根节点=画像名，
 * 六分支= persona 模板 PERSONA_SECTIONS 六分区）。本字段是那条消息的 id，
 * 供前端定位渲染，不必整线程重拉。
 */
resultMessageId: z.string(),
```

- 命名沿用既有先例：`getBackgroundTask.out.resultMessageId`（chat.ts:885）已有同名
  同义字段，不发明新名。
- `in.messageId` 语义维持现状（画像扫描的锚定消息 / 出处回链），不改。
- mode 恒为 `draft` 的既有约定维持（doc-comment 已写明理由），不改。
- **待裁决**（C_CHAT_11 原登记的两个开放问题，一并裁）：① mode 是否永远不该有
  live/pinned（本材料推荐：是，恒 draft）；② 信息不足时拒绝还是落占位（本材料推荐：
  落占位，理由见二节用例表）。

### 3.4 与既有契约的交叉检查

- **不触碰 artifact 束八操作**：G1b 是 chat 束自己的只读投影端口，读的是 chat 自己的
  landing 表 + phase-00 已写的字节，不给 artifact 束加第九个操作——与 C_CHAT_10 登记
  的「chat 在自己的 landing 表上工作」现状一致，不放大也不缩小该缺口。
- **`resultMessageId` 与 `getBackgroundTask` 同名字段语义一致**（都是「产出落成的那条
  消息」），同一事实不声明两处的纪律下这是复用而非复制。
- **G1a 的 `messageId` 与 `landAsArtifact.out.provenanceBacklink.messageId` 是同一事实
  的两个读投影**，权威源都是 `chat_artifact_landings.message_id` 单列，不产生第二份声明。
