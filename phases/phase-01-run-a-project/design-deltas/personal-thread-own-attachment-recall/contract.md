# design delta 契约 · 个人线程可召回本线程自己上传的附件

> **规范唯一来源。** 已签核的 `chat-context-engine` 束**保持不变、不被本文件静默修改**——
> 本 delta 只**修订其中一条不变量的边界**（F156「个人对话零召回」），并把修订写在这里等人类签。
> 若实现与已签束正文冲突，**实现停下等人类签**，不允许 agent 改已签束的 `status`。
>
> - **覆盖 feature**：F156（个人对话零召回反证）；对 F155（L3 接线）的可见范围口径有影响。
> - **base_bundle**：`chat-context-engine`（已签，`status: confirmed`）。
> - **派工依据**：coord-main 2026-08-12 转达人类口径「线程内文件可搜适用于个人对话」，
>   coord-main 代裁、**人类可推翻**（同 `contracts/chat/MIGRATION-IMPACT.md` 的轻量先例精神）。
> - 验收口径见同目录 [`verification.md`](./verification.md)；签核栏见 [`design-signoff.md`](./design-signoff.md)。

## §0 背景（实测 SHA `9cb2b6bc`）

已签 `chat-context-engine` 束把 L3（检索召回）定为**受 actor 可见范围约束**，并立了一条硬不变量：

> **个人对话无项目 ⇒ 零召回**（`domain.md:19` 不变量 3；`usecases.md:16-17` UC3；
> `design-signoff.md:28` 参数表；`coverage.md:15` V4 `retrieval_requests == 0`）。

其立意是对的：个人对话不该把**任何组织/项目的数据**召回进上下文——那是跨范围泄漏。

F153（V9-b，已并入 main）之后出现了一个签核时未预见的场景：**用户在个人对话里自己上传了文件**，
文件内容已抽成 markdown（`chat_message_attachments.extracted_ref` 全文进对象存储、
`extracted_excerpt` 4000 字进 DB）。人类 2026-08-12 口径：「线程内文件可搜」**也适用于个人对话**——
用户问「我刚才传的那份合同里第几条提到违约金」，个人对话理应能从**他自己这条线程的附件**里找到答案。

「个人对话零召回」如果逐字执行，会把用户**自己刚上传、就在这条线程里**的文件也挡在外面。
这不是签核立意要挡的东西（要挡的是**别人/组织/项目**的数据），是逐字规则误伤了自有数据。

## §1 修订的不变量（这份 delta 的全部规范内容）

把 F156 的不变量从：

> 个人线程（无所属项目）run 时 **不发起任何检索请求**，`retrieval_requests == 0`。

修订为：

> 个人线程（无所属项目）run 时，**不发起任何跨组织/项目的检索**——`cross_scope_retrieval_requests == 0`
> 恒成立（这条**不放宽**，仍是硬泄漏边界）；但**允许**对**本线程自己**的已上传附件发起召回
> （`own_attachment_retrieval` 允许），召回范围严格限定 `chat_message_attachments.thread_id == 当前线程`
> 且该线程 `created_by == 当前 actor`（个人线程本就仅创建者可见，见 F108/`resolveVisibility`）。

一句话：**个人线程可召回自己这条线程上传的文件，仍零召回任何组织/项目数据。**

## §2 边界与权限（不可放宽的部分）

1. **范围锚点**：个人线程召回的 query 范围**只**是「本线程的附件」，绝不扩到任何 `segments`/artifact/
   项目/组织索引。L3 引擎（`retrieveCandidates`）的既有权限 disclose 对**项目线程**不变；个人线程走
   一条**受限召回路径**（只吃本线程附件，projectId 恒 null，不进跨范围的五路召回）。
2. **反证口径重定义**（F156 验收随之改）：原 `retrieval_requests == 0` 拆成两个可分别断言的量——
   - `cross_scope_retrieval_requests == 0`（**恒真**，个人对话对 org/project 数据零召回，硬断言）；
   - `own_thread_attachment_recall` 允许 > 0（仅当本线程真有已抽取附件时）。
   `agent_run_context`（F157 快照）需能分辨这两者（来源标记 `own-attachment` vs `project-retrieval`），
   否则 F156 反证退化成「数一个不再为 0 的总数」，测不出泄漏。
3. **可见性复用既有判定**：个人线程 = 无项目、仅创建者可读（既有 F108 语义）。召回只吃
   `thread_id == 本线程 ∧ created_by == actor` 的附件，**不新增第二套判权**。

## §3 具名缺口与分期（如实标）

- **`GAP-CE-PERSONAL-RECALL-BRIDGE`**：L3 引擎召回的是 `segments`（artifact 侧已索引的片段），
  而 F153 的附件全文（`extracted_ref`）**尚未被切成 segment 进检索索引**——这条桥属 CE-012 摄取链，
  尚未闭合。**分期取舍**：
  - **近端窗口内**的附件内容已由 F153 的 `extracted_excerpt`（4000 字）**直接进 L1 上下文**
    （`withAttachmentNotice`），本 delta **无需**额外召回即覆盖——这是第一版就有的。
  - 本 delta 真正解锁的是**超出近端窗口的旧附件**（对话很长、附件在很早的轮次）。这一段需要
    「附件全文 → 可检索 segment」的桥先建成；桥未建成前，个人线程召回**降级为空**（不 fail run，
    与已签束不变量 4「失败/缺失一律降级不 fail」一致），并在 `agent_run_context` 记降级。
  - 所以本 delta 的**可立即实现部分** = 反证口径重定义 + 受限召回路径的骨架 + 降级；**桥**单列
    `GAP-CE-PERSONAL-RECALL-BRIDGE`，随 CE-012 摄取链闭合再接。
