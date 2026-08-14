# design delta 契约 · L3 检索改走文件式检索（不依赖 embedding，参考 Claude Code 的上下文模型）

> **规范唯一来源。** 已签核的 `chat-context-engine` 束**保持不变、不被本文件静默修改**——
> 本 delta 修订其中 L3 的**实现路径**（不是不变量，是"L3 复用既有 context-pack/retrieval
> 五路召回引擎"这条实现决定），并把修订写在这里等人类签。
> 若实现与已签束正文冲突，**实现停下等人类签**，不允许 agent 改已签束的 `status`。
>
> - **覆盖 feature**：F155（L3 接线）；对 F156（个人对话零召回反证）已签 delta
>   `personal-thread-own-attachment-recall` 标记的 `GAP-CE-PERSONAL-RECALL-BRIDGE`
>   ——本 delta **就是**那座桥的实现方案。
> - **base_bundle**：`chat-context-engine`（已签，`status: confirmed`）。
> - **派工依据**：人类 2026-08-14 原话「参考 Claude code 的实现，context engine 应该如何
>   设计，必须基于文件的方式来实现上下文，可以支持持续的对话，另外上传的文件要包括在
>   上下文中，不论是什么文件类型，生成的 mermaid 格式的文档也要在检索的范围，重新设计
>   context engine，纠正范围」——main agent 起草，**待人类签核**（未获 coord-main 代裁，
>   不同于 F156 delta 的处理方式，因为这条改的是实现机制而非只是边界收窄，值得人类直接看）。
> - 验收口径见同目录 [`verification.md`](./verification.md)；签核栏见 [`design-signoff.md`](./design-signoff.md)。

## §0 背景（实测 SHA `2865768d`，2026-08-14）

已签 `chat-context-engine` 束把 L3 的实现方式定为：

> **L3 复用既有 context-pack/retrieval 引擎**（五路召回、权限约束），接线不重写。
> （`08-chat/uc-8-7-上下文引擎分层历史.md` R7/R10/R11②）

`retrieveCandidates`（`apps/api/src/application/retrieval/retrieve-candidates.ts`）是这条既有
引擎的入口：五路召回（含向量召回一路）、RLS 权限过滤在融合**之前**、RRF 融合、重排。文件头注
明确写着不可协商的顺序，以及**任一路失败即整体 block、不降级为"无上下文直接生成"**
（`RetrievalUnavailableError` → 契约码 `RETRIEVAL_UNAVAILABLE`，见该文件顶部注释第三段）。

**实测确认**（`apps/api/src/application/retrieval/ports.ts:114`，`EmbeddingPort` 接口自己的
文档注释逐字）：

> No production implementation exists in phase-00. No embedding model has been chosen.

`grep -rln "implements EmbeddingPort" apps/api/src`（排除测试）**零命中**——全仓没有一处生产代码
真正实现了这个端口。这意味着"L3 复用既有引擎、接线不重写"这条已签决定，字面执行时会撞上：
五路召回的向量一路没有生产实现 ⇒ 要么这一路从未真正被规划进 channel plan（那么"五路"名不副实，
且需要重新核实是否漏了 R7 要求的 `embedding-similarity` 传播路径覆盖）、要么规划了但一调用就
`RetrievalUnavailableError`——按引擎自己的不降级纪律，**整个 L3 会 block 而不是优雅关闭**。
F155「接线不重写」目前没有一条现成的路径能不撞上这个缺口就把 L3 真正跑起来。

同时，F156 delta（`personal-thread-own-attachment-recall`，人类已签）里明确标了
`GAP-CE-PERSONAL-RECALL-BRIDGE`：既有五路召回引擎召回的是 `segments`（artifact 侧已建索引的
片段），而 F153 附件抽取的全文（`extracted_ref`）**从未被切成 segment 进检索索引**——那座桥
"尚未闭合"，该 delta 把它列为独立缺口、随"CE-012 摄取链闭合再接"。

## §1 修订的实现路径（这份 delta 的核心内容）

把 F155 的实现路径从：

> L3 复用既有 context-pack/retrieval 五路召回引擎（含 embedding 向量召回）。

修订为：

> L3 走**文件式检索**——对**已经存在、已经抽取成文本的内容**做关键词/全文检索（Postgres
> `tsvector`/`ts_rank`，非 embedding 相似度），检索范围覆盖三类"文件"：
>   1. **聊天附件**：`chat_message_attachments.extracted_ref`（全文，对象存储）+
>      `extracted_excerpt`（4000 字摘录，已在 DB，F153 已建）；
>   2. **落地的画布产物**（含 AI 生成的 mermaid 图）：`landAsArtifact`（`chat.ts`，已签核端点，
>      #1149 已把 VZ-fabric 的"保存"接上这条真实路径）落成的 canvas artifact 内容
>      （`content.md`，对象存储，`materializeArtifact` 已写）；
>   3. **线程历史本身**：L1/L2（已实现，#1111/#1123）已经覆盖"持续对话"，L3 不重做这一层，
>      只负责"文件"这一类上下文。

一句话：**上下文 = 这个组织/项目/线程里所有"文件"（附件 + 生成产物 + 对话本身）的集合，
检索靠关键词全文索引找相关片段，不靠向量相似度**——这是 Claude Code 对"上下文"的建模方式
（工作区里的文件树 + 精确的 Read/Grep，而不是预先算好的语义向量库），移植过来对齐的是
"确定性、可解释、不依赖尚不存在的 embedding 基础设施"这几条属性，不是照抄它的工具形状。

## §2 为什么不是"扩大 L1/L2"或"补一个 embedding 实现"

- **不是扩大 L1/L2 的行数/字符预算**：R7 已签"`HISTORY_MAX_MESSAGES` 不撑大"，L1/L2 解决的是
  "对话本身"的分层，不解决"这个项目/线程里还有哪些相关文件"这个不同维度的问题——法典里没有
  两个不同的东西该合并成一个的理由，硬撑大预算只会让每次 model 调用都更贵、更慢，且回答不到
  没在近期对话里提过的旧文件。
- **不是现在就补一个 embedding 实现**：F155 的验收线索（R12 V3）只要求"L3 接线、权限约束"，
  不要求"必须是向量检索"——已签正文把**实现方式**（复用既有引擎）和**行为要求**（相关性召回、
  权限约束、个人对话零跨范围召回）混在一起写了，本 delta 只动前者。补一个真的 embedding 服务
  是另一个数量级的工程（选型、托管、成本、latency），且五路召回引擎既有的"任一路失败即 block"
  纪律意味着"能不能上"要等那个服务先稳定——继续等下去，"检索召回"这个能力在生产里就是零。
  关键词全文检索用 Postgres 原生 `tsvector` 即可，**零新增外部依赖**，可以现在就接。
- **既有五路召回引擎不作废**：不删除、不改动 `apps/api/src/application/retrieval/`
  与 `apps/api/src/application/context-pack/` 任何一行——它是为**更复杂的检索场景**
  （文档库/知识库/项目级"洞察"这类需要语义相似度而非关键词命中的场景）设计的，
  embedding provider 选型落地后，L3 可以在文件式检索之外**并行**接上它，而不是互斥。
  本 delta 只是说：**在 embedding 落地之前，L3 不能是"空"的，先用文件式检索把它填上。**

## §3 检索范围与权限（复用既有判权，不新增第二套）

1. **范围锚点**：三类文件的检索范围 = 当前 actor 在当前线程/项目下**可见**的附件与产物——
   复用既有 `resolveVisibility`（thread 可见性）与附件/产物各自的既有权限判定，**不新增**
   第二套权限模型。个人线程复用 F156 delta 已签的边界：`own_attachment_retrieval` 允许，
   `cross_scope_retrieval_requests == 0` 恒真——本 delta 是那条边界的**实现落地**，不改边界。
2. **索引方式**：`chat_message_attachments`/`artifacts`（或产物内容表）各加一个
   `tsvector` 生成列（`GENERATED ALWAYS AS (to_tsvector('simple', ...)) STORED`）+ GIN 索引，
   query 用同一个 `to_tsvector`/`plainto_tsquery`/`ts_rank` 三件套——这是 Postgres 内置能力，
   零新服务、零新端口。检索不跨表 JOIN 出权限之外的行：SQL 谓词本身带 `org_id`/`thread_id`/
   可见性判定，与本仓其余读路径同一套纪律（RLS + 显式谓词）。
3. **失败降级**：全文检索失败（索引未建好、DB 短暂不可用等）**不 fail run**——降级为「本次
   L3 未召回」，快照记录降级（与已签束"失败/缺失一律降级不 fail"的整体纪律一致，也是
   L1/L2 已经在用的同一种保守失败模式）。**不复用**五路召回引擎"任一路失败即 block"那条
   纪律——那条纪律服务于五路召回互相依赖融合排序的场景，文件式检索是单路径，没有融合，
   降级为空是诚实的答案，不是丢失了排序输入。

## §4 与 mermaid 生成产物的接线（人类原话第二条要求）

AI 生成的 mermaid 图，此前只活在**当次回复的文本**里（VZ-01/VZ-02 渲染），一旦这条消息滚出
L1 窗口就再也检索不到。#1149 已经把 VZ-fabric 的「保存」接上真实 `landAsArtifact`（`mode:"draft"`，
`payloadRef` = 编辑后的 mermaid 源）——这条路径**已经存在**，本 delta 要求的是：

- 任何经这条路径落地的 canvas artifact（含用户在画布里编辑过的 mermaid），**自动**进 §1 第 2 类
  的检索范围——不需要用户额外操作，落地即可检索，这是 `materializeArtifact` 已经在写的
  `content.md` 上直接加检索索引，不是新的写路径。
- **未落地**（用户没点保存）的 mermaid 图**不**进检索范围——只在当次回复的文本里、随 L1/L2
  正常沉浮，这与"没保存的东西不该被当成持久知识"这条产品直觉一致，不需要另外的判断逻辑：
  不落地就没有 `content.md`，天然不在索引里。

## §5 具名缺口与分期

- **`GAP-CE-FTS-INDEX-MIGRATION`**：`chat_message_attachments`/`artifacts` 加 `tsvector`
  生成列 + GIN 索引的迁移本身未写，是本 delta 签核后第一步要做的事。
- **`GAP-CE-PERSONAL-RECALL-BRIDGE`（F156 delta 已登记）— 本 delta 视为其实现方案**：签核后
  两个 delta 一起看，F156 delta 定的是"个人线程能召回自己的附件"这条**边界**，本 delta 定的是
  "怎么召回"这条**机制**——同一座桥的两半。
- **F157（可审计快照）不在本 delta 范围**：`agent_run_context` 该记录"这次 L3 召回了几条、
  来自哪类文件、关键词是什么"，但快照表本身还没建（F157 独立 not_started），本 delta 的
  L3 实现完成后，F157 落地时把这些字段接上快照即可，不需要现在就等 F157。
- **原五路召回引擎何时并入**：留白，不在本 delta 承诺任何时间点——那是"embedding provider
  选型"这个更大的、跨越本 UC 范围的决定，本 delta 只保证不删除、不破坏它，留出并入空间。
