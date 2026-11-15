import type { z } from "zod";
import type { MemberMessage, operations, ThreadUpdate } from "@repo/contracts/project-member-chat";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
export type PageInput = z.infer<typeof operations.listMessages.in>;
export type PostInput = z.infer<typeof operations.postMessage.in>;
export type RepliesInput = z.infer<typeof operations.listReplies.in>;
export type Viewer = { readonly orgId: OrgId; readonly userId: string; readonly projectId: string };
export interface PageData {
  items: MemberMessage[]; nextBeforeSequence: number | null;
  nextAfterSequence: number; latestSequence: number; threadUpdates: z.infer<typeof ThreadUpdate>[];
}
export interface ProjectMemberChatRepository {
  /** Called inside the application's tenant transaction. Metadata is guarded too. */
  facts(viewer: Viewer): Promise<Guarded<{ projectStatus: "active" | "archived"; orgStatus: "active" | "disabled" } | null>>;
  page(viewer: Viewer, input: PageInput, threadRootId?: string): Promise<Guarded<PageData>>;
  findMessage(viewer: Viewer, id: string): Promise<Guarded<MemberMessage | null>>;
  post(viewer: Viewer, input: PostInput): Promise<Guarded<z.infer<typeof operations.postMessage.out>>>;
}
export const PROJECT_MEMBER_CHAT_REPOSITORY = Symbol("ProjectMemberChatRepository");
