/**
 * `createFeedbackDraft`（UC-17.8 B1）—— 建一条草稿。**任何组织成员都能用**。
 *
 * ⚠ 正文允许空（契约逐字：草稿的意义正是「先占个位」）；空正文在 `submitFeedbackDraft` 被拒。
 * ⚠ 附件挂靠同 `submitFeedback`：best-effort，认领失败只记日志、不阻塞草稿创建。
 */
import { feedbackLoop } from "@repo/contracts";
import type { FeedbackKind, FeedbackStructured, FeedbackTarget } from "../ports";
import type { FeedbackDraftDeps } from "./draft-shared";

export interface CreateFeedbackDraftDeps extends FeedbackDraftDeps {
  readonly newDraftId: () => string;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export interface CreateFeedbackDraftInput {
  readonly ownerId: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly detail: string;
  readonly structured?: FeedbackStructured;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
  readonly attachmentIds?: readonly string[];
}

export async function createFeedbackDraft(
  deps: CreateFeedbackDraftDeps,
  input: CreateFeedbackDraftInput,
): Promise<{ readonly draftId: string }> {
  const draftId = deps.newDraftId();
  await deps.drafts.create({
    id: draftId,
    ownerId: input.ownerId,
    kind: input.kind,
    target: input.target,
    detail: input.detail,
    structured: input.structured ?? null,
    occurredRoute: input.occurredRoute,
    appVersion: input.appVersion,
  });

  const ids = (input.attachmentIds ?? []).slice(0, feedbackLoop.FEEDBACK_ATTACHMENT_MAX);
  if (ids.length > 0) {
    try {
      const claimed = await deps.attachments.claimForDraft(deps.orgId, draftId, ids, input.ownerId);
      if (claimed !== ids.length) {
        deps.log?.("feedback draft create: some attachments failed to claim (not fatal)", { draftId, requested: ids.length, claimed });
      }
    } catch (e) {
      deps.log?.("feedback draft create: attachment claim failed (best-effort, draft already created)", { draftId, err: e });
    }
  }
  return { draftId };
}
