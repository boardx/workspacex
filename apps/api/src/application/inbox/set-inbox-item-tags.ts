/**
 * `setInboxItemTags` —— 2026-09-08，契约见 `packages/contracts/src/inbox.ts` 同名操作头注
 * （那里是唯一的语义权威，这里只落地）。
 */
import { normalizeInboxTags } from "../../domain/inbox/tags";
import type { InboxTagRepository, InboxTaggableKind } from "./inbox-tags.port";
import { InboxPermissionRevokedError } from "./list-inbox";

export { InboxPermissionRevokedError };

export interface SetInboxItemTagsDeps {
  readonly tags: InboxTagRepository;
}

export interface SetInboxItemTagsInput {
  /** `null` ⟺ 不是本组织成员——同 `reorderInboxItem` 的门。 */
  readonly viewerOrgRole: string | null;
  readonly kind: InboxTaggableKind;
  readonly id: string;
  readonly tags: readonly string[];
}

export interface SetInboxItemTagsResult {
  readonly kind: InboxTaggableKind;
  readonly id: string;
  readonly tags: readonly string[];
}

export async function setInboxItemTags(
  deps: SetInboxItemTagsDeps,
  input: SetInboxItemTagsInput,
): Promise<SetInboxItemTagsResult> {
  if (input.viewerOrgRole === null) throw new InboxPermissionRevokedError();
  const tags = normalizeInboxTags(input.tags);
  await deps.tags.setTags(input.kind, input.id, tags);
  return { kind: input.kind, id: input.id, tags };
}
