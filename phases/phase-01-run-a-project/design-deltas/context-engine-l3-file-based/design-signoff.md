---
status: confirmed         # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: context-engine-l3-file-based
base_bundle: chat-context-engine
scope: l3-retrieval-goes-file-based-keyword-search-not-embedding-similarity
covers: [F155]
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-14"
confirmed_via: "contract.md 审阅确认：L3 改走 Postgres 原生全文检索（tsvector/ts_rank，零新外部依赖），覆盖聊天附件+已落地画布产物（含 mermaid 图），不重做 L1/L2，旧五路召回引擎保留不删。批准理由：EmbeddingPort 实测零生产实现，已签方案今天跑不起来。"
---

# design delta 签核 · L3 检索改走文件式检索（不依赖 embedding）

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类 2026-08-14 原话：「参考 Claude code 的实现，context engine 应该如何设计，必须基于文件的
方式来实现上下文，可以支持持续的对话，另外上传的文件要包括在上下文中，不论是什么文件类型，
生成的 mermaid 格式的文档也要在检索的范围，重新设计 context engine，纠正范围。」

已签 `chat-context-engine` 束把 L3 定为"复用既有五路召回引擎（含向量检索）"——实测确认这条
引擎的向量一路（`EmbeddingPort`）**全仓零生产实现**，且引擎自身"任一路失败即 block、不降级"
的纪律意味着这条路径目前**没有一条现成方式能真正跑起来**。本 delta 提议换一条不依赖尚不存在
的 embedding 基础设施、现在就能接的实现路径：Postgres 原生全文检索，检索范围覆盖附件、
落地的画布产物（含保存的 mermaid 图）、不重做已经在做的对话历史分层（L1/L2）。

## 与本仓其他 delta 的关系（人类之前已经批过一次同类先例）

- 同 F156 delta（`personal-thread-own-attachment-recall`，已签）的**精神**一致：那条 delta
  已经预见并登记了 `GAP-CE-PERSONAL-RECALL-BRIDGE`——"附件全文 → 可检索片段"这座桥尚未建成。
  本 delta 就是那座桥的实现方案，二者签核后要一起看。
- **与 F156 delta 的不同**：那条是 coord-main 代裁、人类事后确认（"线程内文件可搜"是既有口径
  的自然延伸）；本 delta 改的是 L3 的**核心实现机制**（从"复用现成五路引擎"换成"新建全文检索
  路径"），属于人类原话直接要求的方向，main agent 未代裁，**原样等人类看过再动工**。

## 签核前请重点确认（逐条在 `contract.md` 展开）

- [ ] **实现路径改变，不是不变量改变**：F155 的"L3 要做到什么"（相关性召回、权限约束、个人
      对话零跨范围召回）不变；变的是"L3 怎么实现"——从复用向量五路召回引擎，换成 Postgres
      全文检索，覆盖附件+落地产物+（不重做）对话历史（§1）。确认这个改动范围。
- [ ] **既有五路召回引擎不删除、不改动**——留给未来 embedding provider 选型落地后并入
      （§2 第三点、§5 最后一条）。确认"先用文件式检索把 L3 从零填到能用，不等 embedding"
      这个优先级。
- [ ] **mermaid 生成产物的检索接线**（§4）：只有**用户点了保存**（走 #1149 已接的
      `landAsArtifact`）的图才进检索范围；没保存的只在当次回复文本里随 L1/L2 沉浮。确认这条
      "不落地不检索"的边界符合预期，而不是要求"AI 每次画的图都自动可检索"。
- [ ] **失败降级纪律**（§3.3）：全文检索失败 = 本次 L3 未召回，不 fail run——与 L1/L2 已在用的
      降级哲学一致，**不**套用五路召回引擎"任一路失败即 block"那条（理由是文件式检索是单路径、
      没有跨路融合，降级为空是诚实答案）。确认这条选择合理。
- [ ] **分期**（§5）：`GAP-CE-FTS-INDEX-MIGRATION`（加 tsvector/GIN 索引的迁移）是签核后第一步；
      F157 可审计快照不在本 delta 范围，L3 先做完、快照字段等 F157 落地时再接。确认这个顺序。

## 与既有束的关系

- **不修改** `contracts/chat-context-engine/` 下任何已签文件的 `status`；本 delta 是那束 L3
  实现路径的修订，规范以本目录 `contract.md` 为准，签核后由 requirement-author 把 F155 的
  `verification`/实现指引按本 delta 口径改写。
- 触及已签束"L3 复用既有 context-pack/retrieval 引擎"这句话（`08-chat/uc-8-7-上下文引擎分层
  历史.md` R7/R10/R11②）——这处文本的改写**在人类签本 delta 后**才做，不提前动。
- F154（L1/L2，已实现，#1111/#1123）不受本 delta 影响，本 delta 只动 L3。
