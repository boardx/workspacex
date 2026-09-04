/**
 * UC-17.8 B1 —— 六条草稿用例共用的两样东西：错误类型 + 投影到契约 `FeedbackDraft` 的函数。
 *
 * 投影只写一遍：`title` 由 `deriveFeedbackTitle`（服务端权威规则）从 `detail` 派生，空正文 ⇒ `null`；
 * `attachments` 的 url 与 `list-feedback.ts` 同一个形状（`/feedback/attachments/:id`）。
 */
import type { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import { deriveFeedbackTitle } from "../../../domain/feedback/derive-feedback-title";
import type { OrgId } from "../../../domain/org-id";
import type { FeedbackAttachmentRepository, FeedbackAttachmentRow } from "../attachment-ports";
import type { FeedbackDraftRepository, FeedbackDraftRow } from "../draft-ports";

export type FeedbackDraftView = z.infer<typeof feedbackLoop.FeedbackDraft>;

/** 不存在**或不是你的**——同一个错误，同 404 非 403 纪律（契约 `DRAFT_NOT_FOUND`）。 */
export class FeedbackDraftNotFoundError extends Error {}
/** 正文 trim 后为空时提交（契约 `DRAFT_EMPTY`）。 */
export class FeedbackDraftEmptyError extends Error {}

export interface FeedbackDraftDeps {
  readonly drafts: FeedbackDraftRepository;
  readonly attachments: FeedbackAttachmentRepository;
  readonly orgId: OrgId;
}

export function projectFeedbackDraft(
  row: FeedbackDraftRow,
  attachments: readonly FeedbackAttachmentRow[],
): FeedbackDraftView {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    title: deriveFeedbackTitle(row.detail),
    detail: row.detail,
    structured: row.structured,
    attachments: attachments.map((a) => ({ id: a.id, url: `/feedback/attachments/${a.id}`, mime: a.contentType })),
    chat: [...row.chat],
    refineSeeded: row.refineSeeded,
    occurredRoute: row.occurredRoute,
    appVersion: row.appVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 一批草稿各自的附件——一次查询，按 draftId 分组。 */
export async function attachmentsByDraftId(
  deps: FeedbackDraftDeps,
  draftIds: readonly string[],
  ownerId: string,
): Promise<ReadonlyMap<string, FeedbackAttachmentRow[]>> {
  const map = new Map<string, FeedbackAttachmentRow[]>();
  if (draftIds.length === 0) return map;
  for (const a of await deps.attachments.findByDraftIds(deps.orgId, draftIds, ownerId)) {
    if (a.draftId === null) continue;
    const list = map.get(a.draftId) ?? [];
    list.push(a);
    map.set(a.draftId, list);
  }
  return map;
}

/** `get` + 投影，找不到就抛——update / submit 都要这一步。 */
export async function loadDraftView(deps: FeedbackDraftDeps, draftId: string, ownerId: string): Promise<FeedbackDraftView> {
  const row = await deps.drafts.get(draftId, ownerId);
  if (row === null) throw new FeedbackDraftNotFoundError();
  const byId = await attachmentsByDraftId(deps, [row.id], ownerId);
  return projectFeedbackDraft(row, byId.get(row.id) ?? []);
}
