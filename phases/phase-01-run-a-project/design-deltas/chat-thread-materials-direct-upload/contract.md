# design delta 契约 · 右栏「材料」直接上传为线程材料（不经过 chat）

基于已签束 `chat-file-upload`（`packages/contracts/src/chat-file-upload.ts` 是数值与白名单的唯一事实源，本文不复述数值）。

## §0 背景（实测 SHA `baaef1e97`）

人类 2026-09-27 原话：「在右边的材料 panel 上传的文件，不需要经过 chat 提交，这个是两个上传的入口，不同的。不要混在一起啦，在 chat 提交的文件会进入右边的 panel，但是在右边 panel 上传的不要进入到 composer」。

现状：材料页签的「+」/拖拽复用 composer 的上传端口（`ChatMaterialsUploadPort` = composer 的 `pickFiles`），文件成为 composer 的待发附件（`chat_message_attachments.message_id IS NULL`），必须随下一条消息发出才进入材料列表；材料列表只读 `message_id IS NOT NULL` 的行；run 的输入清单只收触发消息的附件。系统里**没有**「挂在线程上、不挂消息」的材料概念。

## §1 数据：同一张表加一列 `scope`

`chat_message_attachments` 新增 `scope text NOT NULL DEFAULT 'message' CHECK (scope IN ('message','thread'))`。

| scope | message_id | 含义 |
|---|---|---|
| `message` | NULL | composer 待发附件（**语义不变**） |
| `message` | 非空 | 随消息发出的附件（**语义不变**） |
| `thread` | 恒 NULL | 从材料页签直接上传的线程材料（新增） |

不变量：
- **T1** `scope='thread' ⇒ message_id IS NULL`（CHECK 约束）。
- **T2** `createMessage` 的绑定只绑 `scope='message'` 的待发行——线程材料永远不会被某条消息「带走」。
- **T3** composer 待发计数（每条消息上限）只数 `scope='message' AND message_id IS NULL`——线程材料不占 composer 名额，也不出现在 composer 里。
- 不新建第二张表：对象存储、抽取 outbox、全文检索、预览、RLS 全部沿用这一张表（避免「同一事实两处」）。

## §2 接口（新增两个 operation，修改一个出参）

1. **`uploadThreadMaterial`** `POST /chat/threads/:threadId/materials`（multipart，字段 `file`）
   - 单文件大小、MIME 白名单：沿用 `ATTACHMENT_LIMITS.maxBytesPerFile` / `ATTACHMENT_MIME_ALLOWLIST`。
   - 线程材料总数上限：新增 `ATTACHMENT_LIMITS.maxThreadMaterials = 50`（写在契约常量里，唯一事实源）；超出 ⇒ `ATTACHMENT_LIMIT_EXCEEDED`。
   - 判权与现有 `uploadAttachment` 相同（线程可见 + 写权限）；错误码沿用 `ChatAttachmentError`。
   - 出参：`Attachment`。
2. **`deleteThreadMaterial`** `DELETE /chat/threads/:threadId/materials/:attachmentId`
   - 只能删 `scope='thread'` 的行；随消息发出的附件属于那条消息，**不可删**（请求它 ⇒ `MATERIAL_NOT_DELETABLE`）。
   - 判权同上；不存在 / 不在本线程 ⇒ `MATERIAL_NOT_FOUND`。新增这两个错误码。
   - 删除：删行（抽取结果随外键级联），对象存储尽力删除；返回 `{ deleted: true }`。
3. **`listThreadAttachments`** 出参项改为 `Attachment.extend({ messageId: z.string().nullable(), source: z.enum(["message","thread"]) })`：返回「随消息发出的附件 ∪ 本线程的线程材料」，按 `createdAt` 排序；composer 待发附件**仍不**出现在这里。

## §3 Agent 可见性（人类裁决 ①：每轮都能读到）

run 的输入清单 = 触发消息的附件 ∪ **本线程全部线程材料**（按 attachment id 去重），沿用现有清单的大小/条数上限与 `@文件名` 提及规则。线程内全文检索本就按 `thread_id` 过滤（已签 `personal-thread-own-attachment-recall`），线程材料自然在内，不改判权。

## §4 界面

- 材料页签的「+」/拖拽 → `uploadThreadMaterial`，**不再**进入 composer；上传进度与失败在材料页签里显示。
- composer 的附件入口不变；随消息发出的附件照旧出现在材料列表。
- 材料列表每项标来源：「随消息」/「直接上传」；「直接上传」的项带删除按钮（人类裁决 ②：这次一起做），删除前确认。
- 删掉材料页签里「上传的文件会加入下一条消息的附件，发送后才会出现在这个列表里」这句——它描述的正是被本 delta 取消的行为。

## §5 不做（具名）

- 不改 composer 附件的任何行为与上限。
- 不提供「把随消息附件移成线程材料」或反向操作。
- 不改项目级文件（`files` 束）；线程材料不自动进入项目文件库。
