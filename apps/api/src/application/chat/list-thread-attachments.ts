/**
 * `listThreadAttachments` —— 右侧栏「材料」列表（#728 D9，人类 2026-08-21 裁决选项 A：
 * 先做「产物 + 材料」两个有真实数据支撑的标签；转录控件保留在消息面板上方，不搬进
 * 右侧栏；「执行/洞察」两个待后端建模，本轮不做——见
 * `docs/proposals/CHAT-728-PENDING-DECISIONS.md` D9 一节）。
 *
 * 与 `list-thread-artifacts.ts` 同一套判权分工：先 `resolveVisibility`，不可见/不存在
 * 一律 `ThreadNotVisibleError`（控制器映射 404，I-3 裸 404 不带 reasonCode）。
 *
 * ⚠ 只返回**已挂到某条消息**的附件（`message_id IS NOT NULL`）——composer 里还在传、
 * 尚未随消息发出的 pending 附件不算「材料」：那是草稿态，不是这场对话已经产出的东西。
 */
import type { OrgId } from "../../domain/org-id";
import type { AttachmentCommandRepository } from "./upload-attachment";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export interface ThreadAttachmentItem {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly messageId: string;
}

export interface ListThreadAttachmentsDeps extends ResolveVisibilityDeps {
  readonly attachments: AttachmentCommandRepository;
}

export interface ListThreadAttachmentsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
}

export interface ListThreadAttachmentsResult {
  readonly items: readonly ThreadAttachmentItem[];
}

export async function listThreadAttachments(
  deps: ListThreadAttachmentsDeps,
  input: ListThreadAttachmentsInput,
): Promise<ListThreadAttachmentsResult> {
  const { userId, orgId, projectId, threadId } = input;

  const outcome = await resolveVisibility(deps, { userId, orgId, projectId, threadId });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const rows = await deps.attachments.listSentByThread(orgId, threadId);
  const items = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    bytes: r.bytes,
    createdAt: r.createdAt,
    messageId: r.messageId,
  }));

  return { items };
}
