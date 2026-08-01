/**
 * `checkTemporaryGrantAccess` -- F05's read-side choke point: "does this grantee's temporary
 * elevation still cover this action, right now".
 *
 * ## Why expiry is detected here, on read, rather than pushed by `advanceAgendaSegment`
 *
 * The acceptance criteria (UC-1.4 R4 / F127 notes) require the failure to be enforced by the
 * SERVER, "不依赖前端/轮询" -- not by front-end hiding and not by a client poll loop. That
 * requirement is about who decides, not about which direction the write happens: a decision
 * made by the server on every request, using the segment's actual current state, is exactly
 * as "server-enforced" as one pushed out at the moment `advanceAgendaSegment` runs -- the
 * caller can never observe stale access either way, since there is no interval between "the
 * segment ended" and "the next request against it is judged against that fact".
 *
 * The alternative -- have `advanceAgendaSegment` push revocations -- is deliberately NOT
 * done here: that file's own header says its `revokedTemporaryGrants` count is pinned at
 * zero because the grant storage layer is F127's undelivered scope, and reaching into
 * `advance-agenda-segment.ts` to wire a push from this feature would be doing F127's
 * cross-cutting integration work under F05's issue -- the write path stays F127's to build;
 * this function only has to make sure that whenever THAT integration lands, or absent it,
 * a read against an ended segment is refused starting from the read immediately after the
 * segment ended, for a reason `queryProvenance` can find. First-observed-expiry is also why
 * `markRevoked` is idempotent per grant id (`temporary-grant-ports.ts`): the first read after
 * termination writes the expiry audit event once; every read after that finds the grant
 * already marked and skips writing a duplicate.
 */
import type { OrgId } from "../../domain/org-id";
import {
  evaluateTemporaryGrant,
  grantCovers,
  type TemporaryGrant,
  type TemporaryGrantScope,
} from "../../domain/identity/temporary-grant";
import type { ProvenanceWriter } from "../provenance/ports";
import type { AgendaSegmentStateReader, TemporaryGrantRepository } from "./temporary-grant-ports";

export interface CheckTemporaryGrantAccessDeps {
  readonly grants: TemporaryGrantRepository;
  readonly segments: AgendaSegmentStateReader;
  readonly provenance: ProvenanceWriter;
  readonly clock: { now(): string };
}

export interface CheckTemporaryGrantAccessInput {
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly granteeId: string;
  readonly requested: TemporaryGrantScope;
}

export type TemporaryGrantAccessResult =
  | { readonly allowed: true; readonly grant: TemporaryGrant }
  | { readonly allowed: false; readonly reasonCode: "NO_TEMPORARY_GRANT" | "TEMPORARY_GRANT_EXPIRED" };

export async function checkTemporaryGrantAccess(
  deps: CheckTemporaryGrantAccessDeps,
  input: CheckTemporaryGrantAccessInput,
): Promise<TemporaryGrantAccessResult> {
  const { orgId, workshopId, granteeId, requested } = input;

  const grant = await deps.grants.findActive(orgId, granteeId, requested);
  if (grant === null || !grantCovers(grant, requested)) {
    return { allowed: false, reasonCode: "NO_TEMPORARY_GRANT" };
  }

  const segmentState = await deps.segments.findState(orgId, workshopId, grant.agendaSegmentId);
  const verdict = evaluateTemporaryGrant(grant, segmentState);
  if (verdict.valid) {
    return { allowed: true, grant };
  }

  // `ALREADY_REVOKED` means a prior read already wrote the expiry event -- do not write a
  // second one. `SEGMENT_TERMINAL` / `SEGMENT_NOT_FOUND` are both "this grant's segment is no
  // longer live", and this is the FIRST read to observe it, so record the revoke now.
  if (verdict.reason !== "ALREADY_REVOKED") {
    const revokedAt = deps.clock.now();
    await deps.grants.markRevoked(orgId, grant.id, revokedAt, "agenda-segment-terminal");
    await deps.provenance.append({
      orgId,
      type: "role-changed",
      actorId: granteeId,
      target: { kind: "project", id: workshopId },
      detail: {
        op: "temp-grant-expired",
        granteeId,
        action: requested.action,
        groupId: requested.groupId,
        agendaSegmentId: grant.agendaSegmentId,
        grantId: grant.id,
        revokedReason: "agenda-segment-terminal",
      },
    });
  }

  return { allowed: false, reasonCode: "TEMPORARY_GRANT_EXPIRED" };
}
