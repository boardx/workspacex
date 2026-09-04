/** `getMyFeedbackDraftCount`（UC-17.8 B1）—— 导航徽标用的数，不拉列表。 */
import type { FeedbackDraftRepository } from "../draft-ports";

export async function countMyFeedbackDrafts(
  deps: { readonly drafts: FeedbackDraftRepository },
  input: { readonly ownerId: string },
): Promise<{ readonly count: number }> {
  return { count: await deps.drafts.countMine(input.ownerId) };
}
