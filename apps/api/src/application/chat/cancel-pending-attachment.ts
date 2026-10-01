import type { UploadAttachmentDeps } from "./upload-attachment";
import { AttachmentUploadError } from "./upload-attachment";
import type { PhysicalPurgePort } from "../files/physical-delete-ports";
import type { OrgId } from "../../domain/org-id";
import { resolveVisibility } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import { cleanupPendingAttachment } from "./pending-attachment-cleanup";

export class AttachmentAlreadySentError extends Error {}

export async function cancelPendingAttachment(
  deps: UploadAttachmentDeps & { purge?: PhysicalPurgePort },
  input: { orgId: OrgId; threadId: string; attachmentId: string; userId: string },
): Promise<void> {
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (!facts) throw new ThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, {
    orgId: input.orgId, threadId: input.threadId, userId: input.userId, projectId: facts.projectId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();
  if (outcome.actor.projectRole === "observer") throw new AttachmentUploadError("NO_WRITE_ROLE");
  if (!deps.attachments.cancelPending || !deps.extraction) throw new AttachmentUploadError("STORAGE_UNAVAILABLE");
  const state = await deps.attachments.cancelPending(input.orgId, input.threadId, input.attachmentId, input.userId);
  if (state === "missing") return;
  if (state === "sent") throw new AttachmentAlreadySentError();
  if (state === "denied") throw new AttachmentUploadError("NO_WRITE_ROLE");
  try {
    await cleanupPendingAttachment({ ...deps, extraction: deps.extraction }, input.orgId, input.attachmentId);
  } catch {
    deps.executor?.kick(input.orgId);
    throw new AttachmentUploadError("STORAGE_UNAVAILABLE");
  }
}
