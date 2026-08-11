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
  /** 该线程当前 pending（`message_id IS NULL`）附件数——数量上限校验用。 */
  countPendingByThread(orgId: OrgId, threadId: string): Promise<number>;
  /** 落一行 pending 附件（`message_id` 恒 NULL，挂消息在另一条路径 set）。 */
  insertAttachment(row: AttachmentRow): Promise<void>;
}

export interface UploadAttachmentDeps extends ResolveVisibilityDeps {
  readonly attachments: AttachmentCommandRepository;
  readonly store: ObjectStore;
  readonly attachmentIds: IdFactory;
  readonly clock: { now(): string };
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

  // ③ 数量（该线程 pending 数）
  const countErr = checkAttachmentCount(await deps.attachments.countPendingByThread(input.orgId, input.threadId));
  if (countErr) throw new AttachmentUploadError(countErr);

  // ④ 先对象存储后落库——存储失败不产生幽灵附件
  const id = deps.attachmentIds.next("att");
  const storageRef = `chat-attachments/${input.orgId}/${id}`;
  try {
    await deps.store.putOnce(storageRef, input.bytes, input.mime);
  } catch {
    throw new AttachmentUploadError("STORAGE_UNAVAILABLE");
  }
  const createdAt = deps.clock.now();
  await deps.attachments.insertAttachment({
    id, orgId: input.orgId, threadId: input.threadId, storageRef,
    filename: input.filename, mime: input.mime, bytes: byteLen, createdAt,
  });
  return { id, filename: input.filename, mime: input.mime, bytes: byteLen, createdAt };
}
