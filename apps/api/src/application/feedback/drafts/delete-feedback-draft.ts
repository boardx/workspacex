/**
 * `deleteFeedbackDraft`（UC-17.8 B1）—— 硬删。先把挂在草稿上的附件放回未认领（显式一步，
 * 数据库 FK `ON DELETE SET NULL` 是兜底），再删草稿。释放失败不拦删除——附件回收有清理任务兜着。
 */
import { FeedbackDraftNotFoundError, type FeedbackDraftDeps } from "./draft-shared";

export interface DeleteFeedbackDraftDeps extends FeedbackDraftDeps {
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export async function deleteFeedbackDraft(
  deps: DeleteFeedbackDraftDeps,
  input: { readonly draftId: string; readonly ownerId: string },
): Promise<{ readonly draftId: string }> {
  const current = await deps.drafts.get(input.draftId, input.ownerId);
  if (current === null) throw new FeedbackDraftNotFoundError();
  try {
    await deps.attachments.releaseDraftAttachments(deps.orgId, input.draftId);
  } catch (e) {
    deps.log?.("feedback draft delete: attachment release failed (FK ON DELETE SET NULL is the backstop)", { draftId: input.draftId, err: e });
  }
  const deleted = await deps.drafts.delete(input.draftId, input.ownerId);
  if (!deleted) throw new FeedbackDraftNotFoundError();
  return { draftId: input.draftId };
}
