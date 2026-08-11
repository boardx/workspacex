# 契约束 `chat-file-upload` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP/对象存储/PostgreSQL。
> `infrastructure` 实现这里的端口；`interface` 调用这里的用例。API 形状的权威是
> ③ 件契约 `packages/contracts/src/chat-file-upload.ts`——本文件描述**用例流程与失败面**，不复述字段。
> 覆盖 feature：见 `design-signoff.md` 的 `covers:`（权威）。依据 UC：`08-chat/uc-8-6`（R8/R12）。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面异常态全靠它。失败枚举见契约
`ChatAttachmentError`，本文件说明每条**何时触发**。

## UC1 · 上传附件（F149）
actor 对某线程有写权 → 选/拖一个文件 → `uploadAttachment`（契约）→ 服务端**完整重做**大小/
白名单/mime 核验/张数/写权五校验 → 落 `chat_message_attachments` + 对象存储（先 PG 元数据后
存储，存储失败不提交）→ 返回 Attachment id。失败：`FILE_TOO_LARGE`/`FILE_TYPE_REJECTED`/
`MIME_MISMATCH`/`ATTACHMENT_LIMIT_EXCEEDED`/`NO_WRITE_ROLE`/`THREAD_NOT_VISIBLE`/`STORAGE_UNAVAILABLE`。

## UC2 · 挂到消息 + 回读（F150）
拿到附件 id 后，`chat.createMessage` 带 `attachmentIds` 把附件挂到消息（服务端校验这些 id 属
该线程、未挂到别的消息）；`chat.listMessages` 回读每条消息的 `attachments`。刷新后仍在（落库）。

## UC3 · 随线程级联删除（F150）
删除线程/消息 → 附件随 FK CASCADE 删除，对象存储对象由清理路径回收。

## UC4 · composer UI（F151）
📎/拖拽/预览条/上传中/失败就地报错/移除二次确认——见 ① ui.md。前端预检用契约的
`ATTACHMENT_LIMITS`/`ATTACHMENT_MIME_ALLOWLIST` 做体验优化，**不替代服务端校验**。

## UC5 · 抽取进 context（F152 · V9-b · 本束不实现）
附件内容抽取成 markdown 进 context engine 的 L3 检索层——**实现选型见 anydoc 提案
`PROP-CHAT-ANYDOC-INTEGRATION-001`**（队列异步、失败降级），属 chat-context-engine 束的组装，
`ModelCallPort` 不动。本束 V9-a 阶段 `extracted_ref` 恒 null。
