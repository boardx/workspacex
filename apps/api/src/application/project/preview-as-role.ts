/**
 * `PreviewAsRole` -- F04, UC-1.4 R4-A1: the viewpoint switcher, "preview what someone else
 * sees" for a facilitator / project lead.
 *
 * ## Invariant I-30, both halves
 *
 * 1. Preview must not grant any read beyond the previewed role's own ceiling -- satisfied
 *    structurally here: the projection is looked up for `asRole`, never for the caller's
 *    real (necessarily-broader, since only facilitators may preview) role. There is no code
 *    path in this function that reads the caller's own `visibleBlocksFor`.
 * 2. Preview must not allow writing "as" the previewed role. This function does not execute
 *    or expose any write itself -- it is a read projection -- so that half of the invariant
 *    is enforced by `authorize-project-write.ts`, which every write endpoint must call
 *    through with `previewing: true` for the duration of a preview session. This file does
 *    not (and cannot, on its own) prove that every future write endpoint does so; that is a
 *    call-site discipline documented on `authorizeProjectWrite`.
 *
 * ## Why the audit event type is `"role-changed"` with a note, not a new enum member
 *
 * The closed `ProvenanceEventType` enum (`packages/contracts/src/provenance.ts`) has no
 * member for "previewed another role's view" -- growing it requires an ADR (the file's own
 * header: "新增走 ADR"). Rather than invent a member unilaterally, this borrows the closest
 * existing type and records the gap in `detail.op`, the same move F109 documented for chat
 * thread lifecycle events (`CHAT_LIFECYCLE_AUDIT_TYPE`, marked 🔴 in that file). A precise
 * `"role-preview"` type is a signoff decision, not an implementation one.
 */
import type { ProjectRole } from "../../domain/identity/roles";
import { skeletonFor, visibleBlocksFor, actionEndpointsFor, ROLE_VIEW_GATE_ACTION } from "../../domain/identity/role-view";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { ProvenanceWriter } from "../provenance/ports";
import { ProjectError } from "./errors";

export interface PreviewAsRoleDeps extends AuthorizeDeps {
  readonly provenance: ProvenanceWriter;
}

export interface PreviewAsRoleInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly screen: string;
  readonly asRole: ProjectRole;
}

export interface PreviewAsRoleResult {
  readonly skeleton: ReturnType<typeof skeletonFor>;
  readonly visibleBlocks: readonly string[];
  readonly actionEndpoints: readonly string[];
  readonly previewing: true;
  readonly exitTo: string;
  readonly auditEventId: string;
}

export async function previewAsRole(
  deps: PreviewAsRoleDeps,
  input: PreviewAsRoleInput,
): Promise<PreviewAsRoleResult> {
  const { userId, orgId, projectId, screen, asRole } = input;

  const decision = await authorize(deps, {
    userId,
    orgId,
    projectId,
    object: { kind: "project", id: projectId },
    action: ROLE_VIEW_GATE_ACTION,
  });

  // usecases.md: "调用者的真实 projectRole = facilitator". Anyone else -- including a
  // groupLead, who could otherwise pass the gate above -- is refused the switcher itself.
  if (!decision.allowed || decision.projectLayer?.role !== "facilitator") {
    throw new ProjectError("PROJECT_ROLE_INSUFFICIENT");
  }

  // "预览动作本身留痕" -- written BEFORE the response is assembled, same ordering reasoning
  // as `read-content.ts`: a failure after the return would otherwise leave a preview with no
  // record of it having happened.
  const auditEventId = await deps.provenance.append({
    orgId,
    type: "role-changed",
    actorId: userId,
    target: { kind: "project", id: projectId },
    detail: { op: "role-preview", asRole, screen },
  });

  return {
    skeleton: skeletonFor(screen),
    visibleBlocks: visibleBlocksFor(asRole),
    // Deliberately non-empty when `asRole` has buttons (e.g. previewing as groupLead shows
    // `group.submitOutput`) -- the contract's own note: "被预览角色看得见按钮，但调用它们必
    // 拒". Rendering them hidden here would misrepresent what the previewed role actually
    // sees; the refusal lives in `authorizeProjectWrite`, not in this list.
    actionEndpoints: actionEndpointsFor(asRole),
    previewing: true,
    exitTo: `/projects/${projectId}/role-view`,
    auditEventId,
  };
}
