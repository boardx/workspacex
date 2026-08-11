/**
 * chat-file-upload（V9 文件上传）UI 原型的 mock 数据 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 这是**签核前的原型 mock**，不接任何后端（V9-a 后端尚未建）。所有附件都是内存里的
 *   假数据，仅用于让人类在 sign-off 时点得动、看得到六种界面态。**不混进活路由**
 *   `chat-live-message-panel.tsx`——那条路径保持「无真实数据不做假 UI」的红线。
 *
 * ## 参数单一事实源（V9-a 契约落地后收敛）
 * 签核数值（25MB / 10 / 白名单）的唯一事实源现在是契约 `chat-file-upload.ts` 的
 * `ATTACHMENT_LIMITS` / `ATTACHMENT_MIME_ALLOWLIST`——本文件**从契约派生**，不再手写第二份
 * 「25MB」「10 个」（本仓已五次因「同一事实两处声明」漂移）。展示助手（formatBytes /
 * iconKindForMime / 标签）从 `../chat-attachment-format` 取，活路由 composer 也从那里取，
 * 一份实现两处用。
 */
import { ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST } from "../live-chat";
import {
  formatBytes,
  iconKindForMime,
  mimeLabel,
  WHITELIST_LABELS,
  type AttachmentIconKind,
} from "../chat-attachment-format";

// 原型（chat-file-upload-preview）仍从本 mock 模块取这些展示助手——转手再导出，一份实现。
export { formatBytes, iconKindForMime, WHITELIST_LABELS, type AttachmentIconKind };

/** 单文件大小上限（派生自契约签核值）。 */
export const MAX_FILE_BYTES = ATTACHMENT_LIMITS.maxBytesPerFile;

/** 每条消息附件数上限（派生自契约签核值）。 */
export const MAX_ATTACHMENTS = ATTACHMENT_LIMITS.maxAttachmentsPerMessage;

/**
 * MIME 白名单（从契约 `ATTACHMENT_MIME_ALLOWLIST` 派生）。`label` 是给「不支持的文件类型」
 * 报错文案与 `accept` 属性用的人读串/mime 串。顺序即契约顺序。
 */
export const MIME_WHITELIST: ReadonlyArray<{ mime: string; label: string }> =
  (ATTACHMENT_MIME_ALLOWLIST as readonly string[]).map((mime) => ({ mime, label: mimeLabel(mime) }));

/** 附件在原型里的上传态。真实后端落地后由服务端响应驱动，这里是 mock 定值。 */
export type AttachmentStatus = "done" | "uploading" | "error";

export interface MockAttachment {
  /** 附件 id —— 小写 kebab，直接进 `chat-attachment-chip-<id>` testid（D-35 不得携带业务数据）。 */
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly status: AttachmentStatus;
  /** 仅 uploading 态有意义：0–100。 */
  readonly progress?: number;
  /** 仅 error 态有意义：就地报错文案（超大小 / 非白名单 / 上传失败）。 */
  readonly error?: string;
  /** error 态是否可重试（上传失败可重试；类型/大小/数量错不可重试，是用户选错了文件）。 */
  readonly retryable?: boolean;
}

/**
 * 「附件已挂好、待随消息发送」的稠密样本 —— 刻意接近上限（8/10）且类型混杂，
 * 让 sign-off 能看出真实信息密度（一屏三行假数据看不出排布问题，正是要暴露的东西）。
 */
export const ATTACHED_SAMPLE: MockAttachment[] = [
  { id: "a1", filename: "项目立项书-v3-终稿.pdf", mime: "application/pdf", bytes: 3_246_182, status: "done" },
  { id: "a2", filename: "用户访谈纪要-2026-08.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: 486_400, status: "done" },
  { id: "a3", filename: "竞品功能对比矩阵.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: 1_149_240, status: "done" },
  { id: "a4", filename: "路演材料-投资人版.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 8_733_921, status: "done" },
  { id: "a5", filename: "首页重设计线框稿.png", mime: "image/png", bytes: 2_412_990, status: "done" },
  { id: "a6", filename: "北极星指标清单.csv", mime: "text/csv", bytes: 65_536, status: "done" },
  { id: "a7", filename: "接入说明.md", mime: "text/markdown", bytes: 12_284, status: "done" },
  { id: "a8", filename: "现场调研照片.jpg", mime: "image/jpeg", bytes: 1_902_336, status: "done" },
];

/** 上传中样本：混合「已完成 / 上传中带进度 / 排队」。 */
export const UPLOADING_SAMPLE: MockAttachment[] = [
  { id: "a1", filename: "项目立项书-v3-终稿.pdf", mime: "application/pdf", bytes: 3_246_182, status: "done" },
  { id: "a2", filename: "路演材料-投资人版.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 8_733_921, status: "uploading", progress: 62 },
  { id: "a3", filename: "现场调研照片.jpg", mime: "image/jpeg", bytes: 1_902_336, status: "uploading", progress: 18 },
];

/** 上传失败可重试样本：一条 done、一条网络失败（retryable）。 */
export const RETRY_SAMPLE: MockAttachment[] = [
  { id: "a1", filename: "项目立项书-v3-终稿.pdf", mime: "application/pdf", bytes: 3_246_182, status: "done" },
  { id: "a2", filename: "路演材料-投资人版.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 8_733_921, status: "error", error: "上传中断，请重试", retryable: true },
];

/** 超大小被拒样本：一条 done，一条 >25MB 的 error（不可重试——换个文件才行）。 */
export const OVERSIZE_SAMPLE: MockAttachment[] = [
  { id: "a1", filename: "接入说明.md", mime: "text/markdown", bytes: 12_284, status: "done" },
  { id: "a2", filename: "产品全量演示录屏.mp4-封面帧.png", mime: "image/png", bytes: 41_281_536, status: "error", error: `单个文件不超过 ${formatBytes(MAX_FILE_BYTES)}（该文件 ${formatBytes(41_281_536)}）`, retryable: false },
];
