# 契约束 `chat-file-upload` — 领域模型与不变量（支撑材料）

> 洋葱最内层。**不依赖任何外层**：不知道 HTTP、不知道对象存储、不知道 PostgreSQL。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）。
> 依据 UC：`08-chat/uc-8-6-对话文件上传.md`（全读）。
> ⚠ **数值不在这里复述**：25MB/白名单/10 张的唯一事实源是
> `packages/contracts/src/chat-file-upload.ts` 的 `ATTACHMENT_LIMITS` / `ATTACHMENT_MIME_ALLOWLIST`。

## 实体

- **Attachment**（附件）：一条消息可挂多个。字段权威定义见契约 `Attachment`
  （id / filename / mime / bytes / createdAt）。`bytes`/`mime` 是**服务端校验后**的权威值，
  不是客户端声明值。
- 归属：Attachment **属于一条 message**（`message_id` FK），message 属于 thread。
  抽取文本引用 `extracted_ref` 在 V9-a 恒 null（V9-b 才填，见 chat-context-engine 束）。

## 不变量

1. **写权即线程写权**：能给某线程上传附件 ⟺ 对该线程有写能力（与 land-as-artifact /
   mutate-thread 同一条规则）。观察者不可上传（契约 `NO_WRITE_ROLE`）。
2. **容量是硬约束、服务端权威**：单文件 ≤ `ATTACHMENT_LIMITS.maxBytesPerFile`、
   每消息 ≤ `ATTACHMENT_LIMITS.maxAttachmentsPerMessage`、mime ∈ `ATTACHMENT_MIME_ALLOWLIST`——
   前端预检只是体验，服务端必须完整重做。声明 mime 与实际字节格式不符 ⇒ `MIME_MISMATCH`（防伪造）。
3. **随线程删除**：附件生命周期从属其消息/线程（FK `ON DELETE CASCADE`），无独立留存策略。
4. **不产生幽灵附件**：对象存储写入失败 ⇒ 事务不提交（`STORAGE_UNAVAILABLE`）。
5. **附件本体与「进 context」解耦**：V9-a 只管存下 + 可下载/预览；`extracted_ref`（进 L3 检索）
   是 V9-b（F152）。抽取失败不删附件、不 fail 上传（见 chat-context-engine 束的失败降级）。
