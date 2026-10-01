import type { OrgId } from "../../domain/org-id";
import type { ObjectStore } from "../artifact/ports";
import type { PhysicalPurgePort } from "../files/physical-delete-ports";
import type { AttachmentExtractionStore } from "./attachment-extraction-store";

/** Only deterministic server-owned attachment keys; never a request/storageRef key. */
export async function cleanupPendingAttachment(
  deps: { store: ObjectStore; purge?: PhysicalPurgePort; extraction: AttachmentExtractionStore },
  orgId: OrgId,
  id: string,
): Promise<void> {
  if (!deps.purge?.purgeExact || !deps.extraction.completeCancelled) throw new Error("cleanup unavailable");
  for (const key of [`chat-attachments/${orgId}/${id}`, `chat-attachments-extracted/${orgId}/${id}.md`]) {
    const head = await deps.store.head(key);
    if (!head) continue;
    if (!head.versionTag) throw new Error("object generation unavailable");
    const result = await deps.purge.purgeExact(key, head.versionTag);
    // A concurrent retry may already have removed this generation.
    if ((!result.deleted || !result.versionMatched) && await deps.store.head(key)) throw new Error("cleanup incomplete");
  }
  await deps.extraction.completeCancelled(orgId, id);
}
