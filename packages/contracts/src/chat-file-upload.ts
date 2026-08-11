/**
 * 契约束 `chat-file-upload` — ③ API 契约（**唯一事实源**，ADR-020）
 *
 * 这一份生成后端 DTO / 前端类型 / OpenAPI / mock，任何一样都不许手写第二份。
 * 本束的 md 材料（domain/usecases/coverage/ui）**只指针引用本文件，不复述数值**——
 * 端点、25MB、白名单、10 张这些参数**只在这里出现一次**（本仓五次「同一事实两处声明」教训）。
 *
 * ## 签核来源
 * 参数逐字来自 `phases/phase-01-run-a-project/contracts/chat-file-upload/design-signoff.md`
 * （人类 2026-08-11「yes to all」）。分期：V9-a = 上传 + 存储 + 预览（本契约的三个操作）；
 * V9-b = 附件内容抽取进 context engine 的 L3 检索层（不在本 HTTP 契约里——那是端口内侧
 * 的组装，`ModelCallPort` 不动，见 chat-context-engine 束）。
 *
 * ## 与 `chat` 束的边界
 * 上传（`uploadAttachment`）先拿 attachment id；发消息（`chat.createMessage`）带上
 * `attachmentIds` 把附件挂到消息上；读消息（`chat.listMessages`）回读每条消息的附件。
 * 「挂到消息 / 回读」是对 `chat` 束既有操作的**字段扩展**（见那份契约的 MIGRATION-IMPACT），
 * 本文件只定义**上传**这个新端点 + 附件实体本身。
 */
import { z } from "zod";

/** 上传后落库的附件实体（回给前端渲染预览条用）。`bytes`/`mime` 是服务端校验后的权威值。 */
export const Attachment = z
  .object({
    id: z.string(),
    /** 原始文件名（服务端不改写；用于预览条显示）。 */
    filename: z.string().min(1),
    /** MIME 类型；服务端按白名单校验后的权威值。 */
    mime: z.string().min(1),
    /** 字节数；服务端按上限校验后的权威值。 */
    bytes: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();
export type Attachment = z.infer<typeof Attachment>;

/**
 * 附件容量约束（**唯一事实源**——签核值只在这里出现一次）。
 * 服务端上传时用它们做权威校验；前端预检只是体验优化、不可信。
 */
export const ATTACHMENT_LIMITS = {
  /** 单文件字节上限。签核值：25 MB。 */
  maxBytesPerFile: 25 * 1024 * 1024,
  /** 每条消息附件数上限。签核值：10。 */
  maxAttachmentsPerMessage: 10,
} as const;

/**
 * 允许上传的 MIME 白名单（**唯一事实源**）。签核值：PDF / 纯文本·markdown / 常见图片 /
 * 常见 Office / csv。服务端**必须**按它拒绝白名单外的类型（`FILE_TYPE_REJECTED`），
 * 且不信任客户端声明的 `mime`——须由服务端从字节/扩展名核验后再比对（防伪造 MIME）。
 */
export const ATTACHMENT_MIME_ALLOWLIST = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
] as const;

/** 本束失败面枚举（穷举——界面异常态全靠它，不得静默）。 */
export const ChatAttachmentError = z.enum([
  /** 越过单文件字节上限（`ATTACHMENT_LIMITS.maxBytesPerFile`）。 */
  "FILE_TOO_LARGE",
  /** MIME 不在 `ATTACHMENT_MIME_ALLOWLIST` 里。 */
  "FILE_TYPE_REJECTED",
  /** 声明的 mime 与服务端核验出的字节格式不符（防伪造）。 */
  "MIME_MISMATCH",
  /** 这条线程已挂附件数会超过 `ATTACHMENT_LIMITS.maxAttachmentsPerMessage`。 */
  "ATTACHMENT_LIMIT_EXCEEDED",
  /** actor 对该线程无写能力（同 land-as-artifact / mutate-thread 的写权规则；观察者被拒）。 */
  "NO_WRITE_ROLE",
  /** 线程对 actor 不可见（对外与「不存在」逐字节相同）。 */
  "THREAD_NOT_VISIBLE",
  /** 对象存储写入失败等下游不可用；事务不提交、不产生幽灵附件。 */
  "STORAGE_UNAVAILABLE",
]);
export type ChatAttachmentError = z.infer<typeof ChatAttachmentError>;

export const operations = {
  /**
   * `uploadAttachment` —— 上传一个附件到某线程，拿到 attachment id（随后由
   * `chat.createMessage` 的 `attachmentIds` 挂到消息上）。
   *
   * 🔴 **前端预检只是体验优化，服务端必须完整重做全部校验**（大小/白名单/张数/写权）。
   * ⚠ 文件字节本身走 multipart body，不在此 Zod 形状里（同 `files.uploadArtifact` 的约定：
   *   契约描述**元数据**，文件本体是 multipart part）。`sizeBytes`/`mime` 是客户端声明值，
   *   **服务端不信任**：落库前须自行核验字节大小与格式，再按 `ATTACHMENT_LIMITS` /
   *   `ATTACHMENT_MIME_ALLOWLIST` 比对。
   * ⚠ 张数上限按「该线程**当前已挂 + 本次**」算，越限回 `ATTACHMENT_LIMIT_EXCEEDED`。
   * ⚠ 对象存储写入失败 ⇒ 事务不提交、不产生幽灵附件（`STORAGE_UNAVAILABLE`）。
   */
  uploadAttachment: {
    method: "POST",
    path: "/chat/threads/:threadId/attachments",
    in: z
      .object({
        threadId: z.string(),
        filename: z.string().min(1),
        /** 客户端声明的 MIME；服务端核验后再比对白名单（见上）。 */
        mime: z.string().min(1),
        /** 客户端声明的字节数；服务端以实际接收字节为准。 */
        sizeBytes: z.number().int().nonnegative(),
      })
      .strict(),
    out: Attachment,
    err: [
      "FILE_TOO_LARGE",
      "FILE_TYPE_REJECTED",
      "MIME_MISMATCH",
      "ATTACHMENT_LIMIT_EXCEEDED",
      "NO_WRITE_ROLE",
      "THREAD_NOT_VISIBLE",
      "STORAGE_UNAVAILABLE",
    ] as const,
  },
} as const;
