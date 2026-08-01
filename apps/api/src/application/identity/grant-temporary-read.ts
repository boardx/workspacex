/**
 * `grantTemporaryRead` -- F05, UC-1.4 R4: a facilitator/project-lead hands someone an extra
 * read on top of their existing project role, tied to the agenda segment it expires with.
 *
 * ## Who may grant
 *
 * `usecases.md` names two grantors: "引导师/项目负责人". In this ontology (see
 * `query-provenance.ts`'s header, same distinction) "项目负责人" is the ORG role `lead`, not
 * a project role -- so the gate is "real projectRole is `facilitator`" OR "org role is
 * `lead`", exactly one `authorize()` call away from `previewAsRole`'s single-role gate, not a
 * second hand-rolled permission check.
 *
 * ## Why granting is refused for an already-terminal segment
 *
 * Granting a read that "lasts until this segment ends" against a segment that has ALREADY
 * ended cannot mean anything -- it would create a grant born already-expired, and the only
 * two ways to handle that silently (pretend it succeeded, or auto-pick a different segment)
 * both misrepresent what the caller asked for. So this is refused up front rather than
 * created and immediately dead.
 *
 * ## Why this does not stack a second live grant on the same scope
 *
 * `TemporaryGrantRepository.findActive` is a single-row lookup (see that port's header) --
 * if the same grantee already holds a live grant for the same `(action, groupId)`, a second
 * `create()` would leave two rows claiming to be the authoritative one for the same question
 * ("is this access live"), and a future revoke would only need to hit one of them to leave a
 * false positive behind. Re-granting while one is still live is treated as replacing it:
 * the old row is marked revoked (reason `agenda-segment-terminal` would be wrong here, but
 * there is no second reason code in the closed `TemporaryGrantRevokedReason` union to invent
 * one for a case `usecases.md` never describes -- re-granting mid-segment is not itself an
 * acceptance criterion, so this function DENIES it outright instead of guessing a behaviour
 * nobody signed off on. See `GRANT_ALREADY_ACTIVE` below.)
 */
import { authorize, type AuthorizeDeps } from "./authorize";
import type { OrgId } from "../../domain/org-id";
import type { TemporaryGrant, TemporaryGrantScope } from "../../domain/identity/temporary-grant";
import type { ProvenanceWriter } from "../provenance/ports";
import type { AgendaSegmentStateReader, TemporaryGrantRepository } from "./temporary-grant-ports";
import { isSegmentTerminalForGrant } from "../../domain/identity/temporary-grant";

/** The gate action: same weakest-read-every-role-holds choice `role-view.ts` documents for
 *  `ROLE_VIEW_GATE_ACTION` -- this call only needs to learn "does the granter have a project
 *  role at all", the facilitator/lead check below does the real gating. */
const GRANT_GATE_ACTION = "read.published";

export class GrantForbiddenError extends Error {
  readonly code = "PROJECT_ROLE_INSUFFICIENT";
  constructor() {
    super("PROJECT_ROLE_INSUFFICIENT");
  }
}

/** No `agenda_segments` row for this workshop/segment. */
export class GrantSegmentNotFoundError extends Error {}

/** The named segment has already ended -- see file header. */
export class GrantSegmentTerminalError extends Error {}

/** The grantee already holds a live grant for this exact (action, groupId). See file header. */
export class GrantAlreadyActiveError extends Error {}

export interface GrantTemporaryReadDeps extends AuthorizeDeps {
  readonly grants: TemporaryGrantRepository;
  readonly segments: AgendaSegmentStateReader;
  readonly provenance: ProvenanceWriter;
  readonly ids: AuthorizeDeps["ids"];
  readonly clock: { now(): string };
}

export interface GrantTemporaryReadInput {
  readonly granterId: string;
  readonly granteeId: string;
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly scope: TemporaryGrantScope;
  readonly agendaSegmentId: string;
}

export interface GrantTemporaryReadOutput {
  readonly grant: TemporaryGrant;
  readonly provenanceEventId: string;
}

export async function grantTemporaryRead(
  deps: GrantTemporaryReadDeps,
  input: GrantTemporaryReadInput,
): Promise<GrantTemporaryReadOutput> {
  const { granterId, granteeId, orgId, workshopId, scope, agendaSegmentId } = input;

  const decision = await authorize(deps, {
    userId: granterId,
    orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: GRANT_GATE_ACTION,
  });
  // The "lead" half of "引导师/项目负责人" is an ORG-level mandate (`query-provenance.ts`'s
  // header draws the identical distinction): a lead may grant on a project even holding no
  // project-role row there themselves, so this checks `orgLayer` directly rather than
  // requiring `decision.allowed` -- the base `authorize()` call above denies a lead with no
  // project membership via the PROJECT layer (`NO_PROJECT_ROLE`), which is the right verdict
  // for "may this org member read the workbench", not for "may this org lead grant".
  const grantsAsLead = decision.orgLayer.passed && decision.orgLayer.role === "lead";
  const grantsAsFacilitator = decision.allowed && decision.projectLayer?.role === "facilitator";
  if (!grantsAsLead && !grantsAsFacilitator) {
    throw new GrantForbiddenError();
  }

  const segmentState = await deps.segments.findState(orgId, workshopId, agendaSegmentId);
  if (segmentState === null) throw new GrantSegmentNotFoundError(`agenda segment ${agendaSegmentId} not found`);
  if (isSegmentTerminalForGrant(segmentState)) {
    throw new GrantSegmentTerminalError(`agenda segment ${agendaSegmentId} has already ended`);
  }

  const existing = await deps.grants.findActive(orgId, granteeId, scope);
  if (existing !== null) throw new GrantAlreadyActiveError();

  const createdAt = deps.clock.now();
  const grant = await deps.grants.create({
    id: deps.ids.next(),
    orgId,
    workshopId,
    granterId,
    granteeId,
    scope,
    agendaSegmentId,
    createdAt,
  });

  // See `preview-as-role.ts` header for why `"role-changed"` is the borrowed type: the closed
  // `ProvenanceEventType` enum has no dedicated member for "temporary grant created" (growing
  // it is an ADR, `packages/contracts/src/provenance.ts` line 18), so this borrows the
  // closest existing member and records the precise action in `detail.op`, same as F04's
  // `role-preview` and F109's `CHAT_LIFECYCLE_AUDIT_TYPE`.
  const provenanceEventId = await deps.provenance.append({
    orgId,
    type: "role-changed",
    actorId: granterId,
    target: { kind: "project", id: workshopId },
    detail: {
      op: "temp-grant-created",
      granteeId,
      action: scope.action,
      groupId: scope.groupId,
      agendaSegmentId,
      grantId: grant.id,
    },
  });

  return { grant, provenanceEventId };
}
