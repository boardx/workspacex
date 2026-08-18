/**
 * #946 · F153/W1（V9-b）—— 附件抽取子系统的仓储端口（outbox 队列 + 抽取结果读写）。
 *
 * outbox 部分镜像 files 的 ingestion outbox（enqueue/claimNext/complete/markJobFailed），
 * 结果部分把抽取产物落回 `chat_message_attachments`（extracted_ref + extraction_status）。
 * anydoc 不出现在这里（那是 `AttachmentToMarkdownPort`）；本端口只碰 DB。
 */
import type { OrgId } from "../../domain/org-id";
import type { ConvertErrorCode } from "./attachment-to-markdown.port";
import type { VisionErrorCode } from "./attachment-vision.port";

/**
 * 落进 `chat_message_attachments.extraction_error` 的封闭失败码：文档转换侧（anydoc）与图片视觉
 * 侧（VLM，#1560）各自的枚举之并。列名只有一个，码集合也只有这一处定义。
 */
export type ExtractionErrorCode = ConvertErrorCode | VisionErrorCode;

/** 认领到的一条抽取待办。 */
export interface AttachmentExtractionJob {
  readonly jobId: string;
  readonly attachmentId: string;
  /** 已尝试次数（含本次）——worker 用它做上限保护。 */
  readonly attempts: number;
}

/** 抽取要用到的附件事实（字节引用 + 权威 MIME）。 */
export interface AttachmentForExtraction {
  readonly storageRef: string;
  readonly mime: string;
}

export interface AttachmentExtractionStore {
  /** 入队一条抽取待办；`ON CONFLICT (attachment_id) DO NOTHING`——重复入队是 no-op。 */
  enqueue(orgId: OrgId, attachmentId: string): Promise<void>;

  /**
   * 认领一条 pending（或超过 `staleAfterMs` 的死 claim）待办，置 processing、attempts+1。
   * `FOR UPDATE SKIP LOCKED`——多 worker 不抢同一行。无活 → null。
   */
  claimNext(orgId: OrgId, workerId: string, staleAfterMs: number): Promise<AttachmentExtractionJob | null>;

  /** 完成即删 job 行（队列排空）。附件的结果状态另记在 record* 上，不靠 job 行留存。 */
  complete(orgId: OrgId, jobId: string): Promise<void>;

  /** job 层失败（I/O 等**可重试**故障）：status='failed'，靠 staleness 窗口重新可认领。 */
  markJobFailed(orgId: OrgId, jobId: string, error: string): Promise<void>;

  /** 读附件的抽取输入（字节引用 + MIME）。附件已删 → null。 */
  readAttachment(orgId: OrgId, attachmentId: string): Promise<AttachmentForExtraction | null>;

  /**
   * 记「已抽出」：`extractedRef` 指向对象存储里的**全文** markdown，`excerpt` 是进上下文的**有界摘录**
   * （domain `boundedExcerpt`），extraction_status='extracted'。
   */
  recordExtracted(orgId: OrgId, attachmentId: string, extractedRef: string, excerpt: string): Promise<void>;

  /** 记「抽不出文本」（图片等）：extraction_status='unsupported'，非错误，extracted_ref 保持 NULL。 */
  recordUnsupported(orgId: OrgId, attachmentId: string): Promise<void>;

  /**
   * 记「抽取失败」（确定性错误）：extraction_status='failed'，extraction_error=code。
   * 码来自 `ExtractionErrorCode`——convert 侧的 anydoc 码，或 vision 侧的 VLM 码（#1560）。
   */
  recordFailed(orgId: OrgId, attachmentId: string, code: ExtractionErrorCode): Promise<void>;
}

export const ATTACHMENT_EXTRACTION_STORE = Symbol("AttachmentExtractionStore");
