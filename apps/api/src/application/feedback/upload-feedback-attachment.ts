/**
 * `uploadFeedbackAttachment`（FB-5）—— 反馈图片附件上传。**不走** `uploadArtifact`
 * 的九态流水线：反馈不属于任何项目（`uploadArtifact` 强绑 `projectId`），套用会
 * 平白引入一个虚构的项目概念。这里复用同一个 `ObjectStore` 端口写字节，但走一条
 * 独立的、只到"存下来、能读回"这一步的轻量路径——同 `upload-own-avatar.ts` 的既有
 * 先例（头像同样不属于项目，同样只需要"存下来+服务端重新校验"这一步）。
 *
 * 两道安全检查（同 `upload-artifact.ts` 头部纪律"前端预检只是体验优化，服务端必须
 * 完整重做全部校验"，但只取其中与图片相关的两道，不搬 zip 炸弹检查——图片格式不是
 * 容器格式，那道检查对这里无意义）：
 *   ① magic-byte 嗅探——声明的 `contentType` 与实际字节不符一律拒绝，不信任声明。
 *   ② `scanForMalware`——同 `upload-artifact.ts` 用的同一个域函数。
 *
 * ⚠ **这一轮没有脱敏**（人类 2026-09-02 明确裁决：先出功能，不做 EXIF 剥离/内容
 *   脱敏）。见迁移文件头注：这是一条登记在案的已知限制，不是遗漏——`product_feedback`
 *   今天没有任何自动转发给开发 Agent 的下游链路（FB-4 未建），真建那条链路之前，
 *   必须先在这里或那条链路自己的入口补上脱敏这一步，否则含 PII 的截图会被原样转发。
 */
import { randomBytes } from "node:crypto";
import { computeContentHash } from "../../domain/artifact/content-hash";
import { scanForMalware } from "../../domain/files/malware-scan";
import { ObjectStoreUnavailableError, type ObjectStore } from "../artifact/ports";
import type { OrgId } from "../../domain/org-id";
import type { FeedbackAttachmentContentType, FeedbackAttachmentRepository } from "./attachment-ports";

export const FEEDBACK_ATTACHMENT_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const FEEDBACK_ATTACHMENT_SIZE_LIMIT_BYTES = 8 * 1024 * 1024;
/** 一条反馈最多带几张图——前端与这里各判一次，同 `TRIAGE_REASON_REQUIRED` 的既有纪律。 */
export const FEEDBACK_ATTACHMENT_MAX_PER_FEEDBACK = 4;

export class UploadFeedbackAttachmentError extends Error {
  constructor(readonly reasonCode: "FILE_TOO_LARGE" | "UNSUPPORTED_CONTENT_TYPE" | "MALWARE_DETECTED") {
    super(reasonCode);
  }
}

/** 极简 magic-byte 嗅探，同 `upload-own-avatar.ts` 的 `sniffImageType`——只覆盖三种
 *  允许的图片类型，不是通用 MIME sniffer（那套是 `files` 束为任意文件类型设计的，
 *  这里装整套是过度设计，见该文件头注）。两处独立实现是刻意的：一处是"头像"这个
 *  账号级概念，一处是"反馈附件"这个租户级概念，共用一个校验函数需要先造一个两者
 *  都要 import 的公共模块，为三行位运算不值得。 */
function sniffImageType(bytes: Uint8Array): FeedbackAttachmentContentType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function newAttachmentId(): string {
  return `fbattach-${randomBytes(12).toString("hex")}`;
}

export interface UploadFeedbackAttachmentDeps {
  readonly store: ObjectStore;
  readonly attachments: FeedbackAttachmentRepository;
}

export interface UploadFeedbackAttachmentInput {
  readonly orgId: OrgId;
  readonly uploadedBy: string;
  readonly declaredContentType: string;
  readonly bytes: Uint8Array;
}

export interface UploadFeedbackAttachmentResult {
  readonly attachmentId: string;
  readonly url: string;
}

export async function uploadFeedbackAttachment(
  deps: UploadFeedbackAttachmentDeps,
  input: UploadFeedbackAttachmentInput,
): Promise<UploadFeedbackAttachmentResult> {
  if (input.bytes.byteLength > FEEDBACK_ATTACHMENT_SIZE_LIMIT_BYTES || input.bytes.byteLength === 0) {
    throw new UploadFeedbackAttachmentError("FILE_TOO_LARGE");
  }
  const sniffed = sniffImageType(input.bytes);
  if (
    sniffed === null ||
    !FEEDBACK_ATTACHMENT_CONTENT_TYPES.includes(input.declaredContentType as FeedbackAttachmentContentType) ||
    sniffed !== input.declaredContentType
  ) {
    // 声明类型不在白名单、或与实际字节不符——同 `uploadOwnAvatar` 的处置，一律拒绝、
    // 不猜测意图（声明与嗅探谁"更可信"没有答案，宁可拒绝一个可能合法的上传）。
    throw new UploadFeedbackAttachmentError("UNSUPPORTED_CONTENT_TYPE");
  }

  const scan = scanForMalware(input.bytes);
  if (!scan.clean) throw new UploadFeedbackAttachmentError("MALWARE_DETECTED");

  const contentHash = computeContentHash(input.bytes);
  const attachmentId = newAttachmentId();
  const objectKey = `feedback-attachments/${input.orgId}/${attachmentId}`;

  try {
    await deps.store.putOnce(objectKey, input.bytes, sniffed);
  } catch (e) {
    if (e instanceof ObjectStoreUnavailableError) throw e;
    throw e;
  }

  await deps.attachments.create({
    id: attachmentId,
    orgId: input.orgId,
    uploadedBy: input.uploadedBy,
    objectKey,
    contentType: sniffed,
    sizeBytes: input.bytes.byteLength,
    sha256: contentHash,
  });

  return { attachmentId, url: `/feedback/attachments/${attachmentId}` };
}
