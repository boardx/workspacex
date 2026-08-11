/**
 * chat-file-upload（V9 文件上传）UI 原型的 mock 数据 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 这是**签核前的原型 mock**，不接任何后端（V9-a 后端尚未建）。所有附件都是内存里的
 *   假数据，仅用于让人类在 sign-off 时点得动、看得到六种界面态。**不混进活路由**
 *   `chat-live-message-panel.tsx`——那条路径保持「无真实数据不做假 UI」的红线。
 *
 * ## 参数单一事实源（逐字抄自已签核的 design-signoff.md「人类确认的参数」）
 * 这三个常量与白名单**只在这里声明一次**。原型 UI 的文案/校验提示全部读它们，
 * 不在组件里再手写第二份「25MB」「10 个」——本仓已五次因「同一事实两处声明」漂移。
 * 真正落地时后端会有自己的权威校验；此处只是把签核值材料化给人看。
 */

/** 单文件大小上限：25 MB（design-signoff：「单文件大小上限 = 25 MB」）。 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** 每条消息附件数上限：10（design-signoff：「每消息附件数上限 = 10」）。 */
export const MAX_ATTACHMENTS = 10;

/**
 * MIME 白名单（design-signoff：「PDF / text·markdown / 图片(png·jpg·webp) /
 * Office(docx·xlsx·pptx) / csv」，保守起步）。`label` 是给「不支持的文件类型」
 * 报错文案里列出「支持哪些」用的人读串。
 */
export const MIME_WHITELIST: ReadonlyArray<{ mime: string; label: string }> = [
  { mime: "application/pdf", label: "PDF" },
  { mime: "text/plain", label: "TXT" },
  { mime: "text/markdown", label: "Markdown" },
  { mime: "text/csv", label: "CSV" },
  { mime: "image/png", label: "PNG" },
  { mime: "image/jpeg", label: "JPG" },
  { mime: "image/webp", label: "WEBP" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "DOCX",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "XLSX",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PPTX",
  },
];

/** 白名单人读串，供报错文案「支持：PDF、DOCX、…」直接拼。 */
export const WHITELIST_LABELS = MIME_WHITELIST.map((m) => m.label).join("、");

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

/** 人读文件大小，1024 进制，最多一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${round1(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${round1(mb)} MB`;
  return `${round1(mb / 1024)} GB`;
}
function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** MIME → 类型图标族（组件按此选 lucide 图标；不认识的回落到通用文件图标）。 */
export type AttachmentIconKind = "pdf" | "doc" | "sheet" | "slides" | "image" | "text" | "file";

export function iconKindForMime(mime: string): AttachmentIconKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "doc";
  if (mime.includes("spreadsheetml") || mime === "text/csv") return "sheet";
  if (mime.includes("presentationml")) return "slides";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/plain" || mime === "text/markdown") return "text";
  return "file";
}
