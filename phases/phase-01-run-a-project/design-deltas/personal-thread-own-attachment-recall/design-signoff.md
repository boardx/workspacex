---
status: confirmed
bundle: personal-thread-own-attachment-recall
base_bundle: chat-context-engine
scope: personal-thread-may-recall-its-own-uploaded-attachments-still-zero-recall-of-any-org-or-project-data
covers: [F156]
confirmed_by: yanbin shen
confirmed_at: 2026-08-12T13:35:00+08:00
confirmed_via: >-
  人类 2026-08-12「线程内文件可搜」口径（适用于个人对话）+ 同日晨全权授权；
  coord-main 备稿、人类亲手推送本 commit 生效（#1048 同法）。硬边界不放宽：
  cross_scope 召回恒 0，只放宽本线程自有附件。
---

# design delta 签核 · 个人线程可召回本线程自己上传的附件

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

已签的 `chat-context-engine` 束把 F156 定为**个人对话零召回**（`retrieval_requests == 0`）——
立意是「个人对话不该把组织/项目数据召回进上下文」，对。但 F153（V9-b，已合入 main）之后出现了
签核时未预见的场景：**用户在个人对话里自己上传的文件**，逐字执行「零召回」会把用户**自己刚传、
就在这条线程里**的文件也挡在外面。人类 2026-08-12 口径「线程内文件可搜适用于个人对话」要的是：
个人对话能搜**自己这条线程的附件**，但仍**零召回任何 org/project 数据**。这正是 ADR-023 立 delta
这条路的情形——已签束的一条不变量的**边界**要收窄修订，而不是推翻整束。

## 签核前请重点确认（逐条在 `contract.md` 展开）

- [ ] **硬边界不放宽**：个人对话对**任何组织/项目数据**仍是零召回（`cross_scope_retrieval_requests == 0`
      恒真）。放宽的**只**是「本线程自己上传的附件」（§1）。你要的是这个边界，对吗？
- [ ] **F156 反证口径改写**：原来一个 `retrieval_requests == 0` 拆成两个量——跨范围召回恒 0（硬断言）
      + 自有附件召回允许 > 0。`agent_run_context` 快照要能**分辨来源**（`own-attachment` vs
      `project-retrieval`），否则测不出泄漏（§2.2）。确认这个拆法。
- [ ] **只吃本线程 + 仅创建者**：召回严格限定 `thread_id == 本线程 ∧ created_by == actor`，复用既有
      F108 判权，不新增第二套（§2.3）。
- [ ] **分期取舍**（§3）：近端窗口内的附件内容 F153 已直接进上下文（无需召回）；本 delta 真正解锁的是
      **超窗口的旧附件**，需要「附件全文 → 可检索 segment」的桥（`GAP-CE-PERSONAL-RECALL-BRIDGE`）先建成；
      桥未建成前个人线程召回**降级为空、不 fail run**。确认可以先上「反证重定义 + 受限召回骨架 + 降级」，
      桥单列缺口随 CE-012 摄取链闭合再接。

## 与既有束的关系

- **不修改** `contracts/chat-context-engine/` 下任何已签文件的 `status`；本 delta 是那束 F156 不变量的
  **边界修订**，规范以本目录 `contract.md` 为准，签核后由 requirement-author 把 F156 的
  `user_visible_behavior`/`verification` 按本 delta 口径改写。
- 修订触及已签束的 4 处「零召回」文本（`domain.md:19` / `usecases.md:16-17` / 束 `design-signoff.md:28` /
  `coverage.md:15`）——这 4 处的**改写在人类签本 delta 后**才做，不提前动。
- F155（L3 接线）本身不被本 delta 改；只是它对个人线程的可见范围口径按本 delta 收窄到「本线程附件」。
