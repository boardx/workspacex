/**
 * #946 · V9-a F150 —— 上传附件用例（application 层编排）。
 *
 * 编排顺序（失败面穷举，契约 `ChatAttachmentError`）：
 *   ① 写权：`findThreadFacts` → `resolveVisibility` → 只拒 `projectRole === "observer"`。
 *      **刻意与 `message-roundtrip.ts` 的判权一致，不是 `land-as-artifact` 的**——后者拒
 *      `null` role（个人线程），会误伤个人对话的合法上传。你上传完是要 `createMessage`
 *      发消息的，而个人对话能发消息，所以上传的写权口径必须与发消息一致。
 *   ② 大小 + 白名单：纯领域 `checkAttachmentBytesAndType`。字节数以**实际接收**为准
 *      （`bytes.byteLength`），不是客户端声明。`mime` 是**控制器已核验**的权威值
 *      （声明 mime 与实际字节格式不符 = `MIME_MISMATCH`，在控制器 sniff 时判，先于本用例）。
 *   ③ 数量：该线程 pending（未挂消息）数 `checkAttachmentCount`。
 *   ④ 先对象存储后落库：`putOnce` 失败 ⇒ 不 insert（不产生幽灵附件，`STORAGE_UNAVAILABLE`）。
 */
import type { OrgId } from "../../domain/org-id";
import {
  checkAttachmentBytesAndType,
  checkAttachmentCount,
} from "../../domain/chat/attachment-upload";
import type { ObjectStore } from "../artifact/ports";
import type { IdFactory } from "../artifact/ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES } from "../../domain/chat/attachment-extraction";
import { extractAttachment } from "./attachment-extraction-worker";
import type { AttachmentExtractionStore } from "./attachment-extraction-store";
import type { AttachmentToMarkdownPort } from "./attachment-to-markdown.port";
import type { AttachmentVisionPort } from "./attachment-vision.port";
import type { AttachmentExtractionExecutorPort } from "./attachment-extraction-executor.port";

/** 上传失败——携带契约 `ChatAttachmentError` 的具体码，控制器映射成 HTTP 错误响应。 */
export class AttachmentUploadError extends Error {
  constructor(public readonly code:
    | "FILE_TOO_LARGE"
    | "FILE_TYPE_REJECTED"
    | "ATTACHMENT_LIMIT_EXCEEDED"
    | "NO_WRITE_ROLE"
    | "STORAGE_UNAVAILABLE") {
    super(code);
    this.name = "AttachmentUploadError";
  }
}

export interface AttachmentRow {
  readonly id: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly storageRef: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly createdAt: string;
}

export interface AttachmentCommandRepository {
  /**
   * 该线程当前 pending（`message_id IS NULL`）附件数——数量上限校验用。
   * 返回 `Guarded<number>`：租户表的读一律经 permission-filter 出门（R7 / coherence X-1，
   * 由 lint-permission-paths 门控），调用方须以判定 disclose 后才拿得到数值。
   */
  countPendingByThread(orgId: OrgId, threadId: string): Promise<Guarded<number>>;
  /** 落一行 pending 附件（`message_id` 恒 NULL，挂消息在另一条路径 set）。 */
  insertAttachment(row: AttachmentRow): Promise<void>;
  /**
   * #1584 —— 按 id 查一行附件（预览/下载用），`null` 表示这个线程里没有这个 id。
   * 返回 `Guarded<AttachmentRow | null>`：租户表读一律经 permission-filter 出门（R7），
   * 调用方须以判定 disclose 后才拿得到值。不区分 pending / 已挂消息——两者读权限相同，
   * 都取决于「这个线程你能不能看」，不取决于附件是否已经挂上某条消息。
   */
  findById(orgId: OrgId, threadId: string, attachmentId: string): Promise<Guarded<AttachmentRow | null>>;
}

/** DI 令牌——与 `CHAT_MESSAGE_COMMAND_REPOSITORY` 同套，绑定在 kernel.module。 */
export const CHAT_ATTACHMENT_COMMAND_REPOSITORY = Symbol("ChatAttachmentCommandRepository");

export interface UploadAttachmentDeps extends ResolveVisibilityDeps {
  readonly attachments: AttachmentCommandRepository;
  readonly store: ObjectStore;
  readonly attachmentIds: IdFactory;
  readonly clock: { now(): string };
  /**
   * F153（V9-b，可选）—— 内容抽取子系统。三者齐备才触发抽取；缺省则只上传+存储（附件仍成功，
   * 内容不进上下文）。可选是为了不逼每个 uploadAttachment 单测都接一套抽取假件。
   */
  readonly extraction?: AttachmentExtractionStore;
  readonly converter?: AttachmentToMarkdownPort;
  /** #1560 P1：图片视觉抽取端口。缺省 ⇒ 图片如实落 failed + `visionNotConfigured`（不假装抽到）。 */
  readonly vision?: AttachmentVisionPort;
  readonly executor?: AttachmentExtractionExecutorPort;
}

export interface UploadAttachmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly filename: string;
  /** 控制器已核验的权威 MIME（非客户端裸声明）。 */
  readonly mime: string;
  /** 实际接收到的字节。`byteLength` 是权威大小。 */
  readonly bytes: Uint8Array;
}

export interface UploadedAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly createdAt: string;
}

export async function uploadAttachment(
  deps: UploadAttachmentDeps,
  input: UploadAttachmentInput,
): Promise<UploadedAttachment> {
  // ① 写权（与 message-roundtrip 一致：只拒 observer，允许个人对话 null role）
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new ThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId, threadId: input.threadId, projectId: facts.projectId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();
  if (outcome.actor.projectRole === "observer") throw new AttachmentUploadError("NO_WRITE_ROLE");

  // ② 大小 + 白名单（纯领域；字节以实际接收为准）
  const byteLen = input.bytes.byteLength;
  const typeErr = checkAttachmentBytesAndType({ bytes: byteLen, mime: input.mime });
  if (typeErr) throw new AttachmentUploadError(typeErr);

  // ③ 数量（该线程 pending 数）——租户表读经 permission-filter 出门，以本次判定 disclose。
  const guardedCount = await deps.attachments.countPendingByThread(input.orgId, input.threadId);
  const disclosedCount = discloseDecided(guardedCount, outcome.base);
  if (!isDisclosed(disclosedCount)) throw new ThreadNotVisibleError();
  const countErr = checkAttachmentCount(disclosedCount.payload);
  if (countErr) throw new AttachmentUploadError(countErr);

  // ④ 先对象存储后落库——存储失败不产生幽灵附件
  const id = deps.attachmentIds.next("att");
  const storageRef = `chat-attachments/${input.orgId}/${id}`;
  try {
    await deps.store.putOnce(storageRef, input.bytes, input.mime);
  } catch (e) {
    // #1704：原来是裸 `catch {}`。对外仍是 STORAGE_UNAVAILABLE（契约错误码不变，
    // 也不把内部路径泄给调用方），但**原因必须留下痕迹**——上一次这条路径整片红时，
    // 每个上传只回一个笼统的 STORAGE_UNAVAILABLE，EEXIST / ENOSPC / EACCES 无从分辨，
    // 诊断只能靠猜。压平错误码是契约要求，压平**证据**不是。
    console.error(
      `[chat-attachment] putOnce failed key=${storageRef}: ` +
      (e instanceof Error ? `${e.name}: ${e.message}` : String(e)),
    );
    throw new AttachmentUploadError("STORAGE_UNAVAILABLE");
  }
  const createdAt = deps.clock.now();
  await deps.attachments.insertAttachment({
    id, orgId: input.orgId, threadId: input.threadId, storageRef,
    filename: input.filename, mime: input.mime, bytes: byteLen, createdAt,
  });

  // ⑤ F153：触发内容抽取。**绝不影响上传结果**——附件已持久，抽取 best-effort。
  //    ≤3MB 内联（内容返回时即就绪）；更大 or 内联遇可重试故障 → 入队 + kick 异步。
  await triggerExtraction(deps, input.orgId, id, byteLen);

  return { id, filename: input.filename, mime: input.mime, bytes: byteLen, createdAt };
}

/** F153：上传成功后触发抽取，任何抽取侧问题都不得让上传失败（附件已存好）。 */
async function triggerExtraction(
  deps: UploadAttachmentDeps,
  orgId: OrgId,
  attachmentId: string,
  byteLen: number,
): Promise<void> {
  const { extraction, converter, vision, executor, store } = deps;
  if (!extraction || !converter || !executor) return; // 未接抽取子系统（部分单测）——跳过。
  try {
    if (byteLen <= ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES) {
      // 内联：小文件当场抽，内容上传返回时即就绪。
      const outcome = await extractAttachment({ store, extraction, converter, vision }, orgId, attachmentId);
      if (outcome !== "retry") return; // 终态（extracted/unsupported/failed/gone）
      // retry（可重试 I/O 故障）→ 回落异步兜底。
    }
    await extraction.enqueue(orgId, attachmentId);
    executor.kick(orgId);
  } catch {
    // 抽取触发本身出错——尽力入队让异步兜底，但绝不抛（上传不能因此失败）。
    try {
      await extraction.enqueue(orgId, attachmentId);
      executor.kick(orgId);
    } catch {
      /* 连入队都失败——放弃抽取，附件仍是成功上传的。 */
    }
  }
}
