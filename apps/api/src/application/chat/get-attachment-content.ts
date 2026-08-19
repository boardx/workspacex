/**
 * #1584 —— 聊天附件的字节读路径（点击预览/下载）。
 *
 * 判权口径**是读，不是写**：与 `uploadAttachment` 的 `NO_WRITE_ROLE` 门不同，这里任何能看见
 * 这个线程的角色都能读附件字节，包括 observer——`resolve-visibility.ts` 头注明确把「文件
 * 下载」列为必须走 `resolveVisibility` 的读路径之一，本用例就是把那句话落地。
 *
 * 编排顺序：
 *   ① 线程可见性：`findThreadFacts` → `resolveVisibility`，不可见 ⇒ `ThreadNotVisibleError`
 *      （控制器映射成裸 404，I-3，与不存在的附件同响应，不泄露"这个线程存在但你看不到"）。
 *   ② 附件行：`attachments.findById` 拿 `Guarded`，用 ① 判出的 `outcome.base` 解禁——不可见时
 *      与①同码同响应（同一个裸 404），不区分"线程不可见"与"线程可见但没这个附件 id"。
 *   ③ 对象存储：`store.get(storageRef)`。理论上不会为 null（先写对象存储后落库，见
 *      `upload-attachment.ts` ④）——万一出现（人工删了对象、存储故障后的孤儿行），如实报
 *      `ObjectMissingError`，控制器映射 503，而不是假装 200 回空字节。
 */
import type { OrgId } from "../../domain/org-id";
import type { AttachmentCommandRepository } from "./upload-attachment";
import type { ObjectStore } from "../artifact/ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import { discloseDecided, isDisclosed } from "../security/permission-filter";

export class ObjectMissingError extends Error {
  constructor(readonly storageRef: string) {
    super(`object missing for ${storageRef}`);
  }
}

export interface GetAttachmentContentDeps extends ResolveVisibilityDeps {
  readonly attachments: AttachmentCommandRepository;
  readonly store: ObjectStore;
}

export interface GetAttachmentContentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly attachmentId: string;
}

export interface AttachmentContent {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export async function getAttachmentContent(
  deps: GetAttachmentContentDeps,
  input: GetAttachmentContentInput,
): Promise<AttachmentContent> {
  // ① 线程可见性
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new ThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId, threadId: input.threadId, projectId: facts.projectId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();
  // 读路径不设写权门槛——observer 与其余角色一样能读附件（对齐 listMessages）。

  // ② 附件行——同一个 outcome.base 解禁，找不到与不可见同码。
  const guardedRow = await deps.attachments.findById(input.orgId, input.threadId, input.attachmentId);
  const disclosed = discloseDecided(guardedRow, outcome.base);
  if (!isDisclosed(disclosed) || disclosed.payload === null) throw new ThreadNotVisibleError();
  const row = disclosed.payload;

  // ③ 对象存储
  const bytes = await deps.store.get(row.storageRef);
  if (bytes === null) throw new ObjectMissingError(row.storageRef);

  return { filename: row.filename, mime: row.mime, bytes };
}
