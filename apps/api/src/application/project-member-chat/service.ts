import type { z } from "zod";
import type { operations } from "@repo/contracts/project-member-chat";
import { ProjectMemberChatError } from "../../domain/project-member-chat/errors";
import { deriveReadOnlyReason } from "../../domain/project/readonly-reason";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { DatabasePort } from "../ports/database.port";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { PageInput, PostInput, ProjectMemberChatRepository, RepliesInput, Viewer } from "./ports";

export interface ProjectMemberChatDeps {
  readonly db: DatabasePort; readonly auth: AuthorizeDeps;
  readonly repo: ProjectMemberChatRepository; readonly enabled: () => boolean;
}
function reveal<T>(value: Guarded<T>, decision: PermissionDecision): T {
  const disclosed = discloseDecided(value, decision);
  if (!isDisclosed(disclosed)) throw new ProjectMemberChatError("NOT_FOUND");
  return disclosed.payload;
}
/** Every request, including retries and incremental reads, passes the canonical project ACL.
 * Existing project content-write authorization supplies the editable tier. No new roles.
 */
async function execute<T>(deps: ProjectMemberChatDeps, viewer: Viewer,
  work: (decision: PermissionDecision, access: { canWrite: boolean; readOnlyReason: "archived" | "org-disabled" | "role" | null }) => Promise<T>): Promise<T> {
  if (!deps.enabled()) throw new ProjectMemberChatError("MODULE_DISABLED");
  try {
    return await deps.db.withTenant(viewer.orgId, async () => {
      let decision = await authorize(deps.auth, {
        ...viewer, object: { kind: "project", id: viewer.projectId }, action: "read.published",
      });
      if (!decision.allowed) throw new ProjectMemberChatError("NOT_FOUND");
      // Human discussion is restricted to actual members. General-project org managers
      // can read the project overview as observers, but that is not channel membership.
      const workshopMember = await deps.auth.repo.findProjectMembership(viewer.userId, viewer.projectId, viewer.orgId);
      const generalMember = workshopMember === null
        ? await deps.auth.repo.findNonWorkshopStanding(viewer.userId, viewer.projectId, viewer.orgId) : null;
      if (workshopMember === null && generalMember?.memberRole == null) throw new ProjectMemberChatError("NOT_FOUND");
      const facts = reveal(await deps.repo.facts(viewer), decision);
      if (!facts) throw new ProjectMemberChatError("NOT_FOUND");
      // facts() holds the member row. Re-evaluate the role after acquiring that lock,
      // so a demotion committed between the first ACL read and the lock cannot send.
      decision = await authorize(deps.auth, {
        ...viewer, object: { kind: "project", id: viewer.projectId }, action: "read.published",
      });
      if (!decision.allowed) throw new ProjectMemberChatError("NOT_FOUND");
      // Reuse the existing generic project content-write action, as the stage service
      // does; do not maintain another role-to-write matrix in this module.
      const writeDecision = await authorize(deps.auth, {
        ...viewer, object: { kind: "project", id: viewer.projectId }, action: "content.renameFile",
      });
      const lifecycleReason = deriveReadOnlyReason(facts);
      const readOnlyReason = lifecycleReason ?? (!writeDecision.allowed ? "role" : null);
      return work(decision, { canWrite: readOnlyReason === null, readOnlyReason });
    });
  } catch (error) {
    if (error instanceof ProjectMemberChatError) throw error;
    throw new ProjectMemberChatError("DEPENDENCY_UNAVAILABLE");
  }
}
export async function listMemberMessages(deps: ProjectMemberChatDeps, viewer: Viewer, input: PageInput): Promise<z.infer<typeof operations.listMessages.out>> {
  return execute(deps, viewer, async (decision, access) => ({ ...reveal(await deps.repo.page(viewer, input), decision), ...access }));
}
export async function postMemberMessage(deps: ProjectMemberChatDeps, viewer: Viewer, input: PostInput): Promise<z.infer<typeof operations.postMessage.out>> {
  return execute(deps, viewer, async (decision, access) => {
    if (!access.canWrite) throw new ProjectMemberChatError(access.readOnlyReason === "archived" ? "READ_ONLY_ARCHIVED"
      : access.readOnlyReason === "org-disabled" ? "READ_ONLY_ORG_DISABLED" : "READ_ONLY_ROLE");
    return reveal(await deps.repo.post(viewer, input), decision);
  });
}
export async function listMemberReplies(deps: ProjectMemberChatDeps, viewer: Viewer, input: RepliesInput): Promise<z.infer<typeof operations.listReplies.out>> {
  return execute(deps, viewer, async (decision, access) => {
    const root = reveal(await deps.repo.findMessage(viewer, input.threadRootId), decision);
    if (!root) throw new ProjectMemberChatError("NOT_FOUND");
    if (root.threadRootId !== null) throw new ProjectMemberChatError("THREAD_ROOT_INVALID");
    const { threadUpdates: _updates, ...page } = reveal(await deps.repo.page(viewer, input, root.id), decision);
    return { ...page, root, ...access };
  });
}
