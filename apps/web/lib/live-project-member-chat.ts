/** Independent human channel. All wire shapes derive from the approved contract. */
import * as C from "@repo/contracts/project-member-chat";
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectMemberMessage = z.infer<typeof C.MemberMessage>;
export type ProjectMemberThreadUpdate = z.infer<typeof C.ThreadUpdate>;
export type ProjectMemberStageReference = z.infer<typeof C.StageReference>;
export type MemberChatPage = z.infer<typeof C.operations.listMessages.out>;
export type MemberChatReplies = z.infer<typeof C.operations.listReplies.out>;
export type MemberChatPost = z.input<typeof C.operations.postMessage.in>;
export type MemberChatReceipt = z.infer<typeof C.operations.postMessage.out>;
type RequestContext = { sessionToken: string; signal?: AbortSignal };
function path(template: string, projectId: string, threadRootId?: string) {
  return template.replace(":projectId", encodeURIComponent(projectId)).replace(":threadRootId", encodeURIComponent(threadRootId ?? ""));
}
function query(input: { beforeSequence?: number; afterSequence?: number; limit: number }) {
  return { beforeSequence: input.beforeSequence?.toString(), afterSequence: input.afterSequence?.toString(), limit: String(input.limit) };
}
export async function listProjectMemberMessages(input: z.input<typeof C.operations.listMessages.in>, context: RequestContext): Promise<MemberChatPage> {
  const op = C.operations.listMessages, parsed = op.in.parse(input);
  const result = op.out.parse(await apiRequest<unknown>(path(op.path, parsed.projectId), { method: op.method, query: query(parsed), ...context, notifyCredit: false }));
  if (result.items.some((message) => message.projectId !== parsed.projectId)) throw new Error("Member channel response scope mismatch");
  return result;
}
export async function listProjectMemberReplies(input: z.input<typeof C.operations.listReplies.in>, context: RequestContext): Promise<MemberChatReplies> {
  const op = C.operations.listReplies, parsed = op.in.parse(input);
  const result = op.out.parse(await apiRequest<unknown>(path(op.path, parsed.projectId, parsed.threadRootId), { method: op.method, query: query(parsed), ...context, notifyCredit: false }));
  if (result.root.id !== parsed.threadRootId || result.root.projectId !== parsed.projectId || result.root.threadRootId !== null || result.items.some((message) => message.projectId !== parsed.projectId || message.threadRootId !== parsed.threadRootId)) throw new Error("Member topic response scope mismatch");
  return result;
}
export async function postProjectMemberMessage(input: MemberChatPost, context: RequestContext): Promise<MemberChatReceipt> {
  const op = C.operations.postMessage, parsed = op.in.parse(input), { projectId, ...body } = parsed;
  const result = op.out.parse(await apiRequest<unknown>(path(op.path, projectId), { method: op.method, body, ...context, notifyCredit: false }));
  if (result.message.projectId !== projectId || result.message.clientMessageId !== parsed.clientMessageId || result.message.threadRootId !== (parsed.threadRootId ?? null)) throw new Error("Member send receipt scope mismatch");
  return result;
}

/** Optional names from existing authorized project directories, never the organization roster.
 * members:null is the published non-workshop discriminator; a failed members read must not fall back.
 */
export async function listProjectMemberNames(projectId: string, context: RequestContext): Promise<Map<string, string>> {
  const members = project.operations.listProjectMembers;
  const result = members.out.parse(await apiRequest<unknown>(path(members.path, projectId), { method: members.method, ...context, notifyCredit: false }));
  if (context.signal?.aborted) throw new Error("Member directory read cancelled");
  const entries = result.members === null
    ? project.operations.listNonWorkshopMembers.out.parse(await apiRequest<unknown>(path(project.operations.listNonWorkshopMembers.path, projectId), { method: project.operations.listNonWorkshopMembers.method, ...context, notifyCredit: false })).members
    : result.members;
  return new Map(entries.filter((entry) => entry.displayName.trim()).map((entry) => [entry.userId, entry.displayName.trim()]));
}
