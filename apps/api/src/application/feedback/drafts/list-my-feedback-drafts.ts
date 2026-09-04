/**
 * `listMyFeedbackDrafts`（UC-17.8 B1）—— 我的草稿，按 `updatedAt` 倒序。
 * ⚠ 没有 `scope`：草稿没有「全组织」口径，owner 谓词在仓储 SQL 里。
 */
import { attachmentsByDraftId, projectFeedbackDraft, type FeedbackDraftDeps, type FeedbackDraftView } from "./draft-shared";

export async function listMyFeedbackDrafts(
  deps: FeedbackDraftDeps,
  input: { readonly ownerId: string },
): Promise<readonly FeedbackDraftView[]> {
  const rows = await deps.drafts.listMine(input.ownerId);
  const byId = await attachmentsByDraftId(deps, rows.map((r) => r.id), input.ownerId);
  return rows.map((row) => projectFeedbackDraft(row, byId.get(row.id) ?? []));
}
