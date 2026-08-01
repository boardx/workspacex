/**
 * Ports for F05's temporary-grant use cases. Two new interfaces, not two more methods
 * bolted onto `IdentityRepository` -- same reasoning `application/project/ports.ts` gives
 * for F122/F123/F124 each getting their own port file: `pg-identity-repository.ts` has its
 * own `lint-permission-paths` exemption shaped around what it already does, and folding an
 * unrelated write surface (temporary grants) into it would drag that exemption somewhere
 * it wasn't reasoned about.
 *
 * F127 (this feature) adds the durable Postgres implementation this port was left waiting
 * for -- `pg-temporary-grant-repository.ts` (`temporary_grants` table, migration
 * `20260801200000_f127_temporary_grants_table.sql`) -- plus `findActiveBySegment` below,
 * the one additional query shape F05 did not need but `advanceAgendaSegment`'s push-revoke
 * does: "every grant still riding on THIS segment", not "the one grant this grantee holds
 * for a scope we already know". Nothing F05 shipped changes shape here -- `create` and
 * `findActive` are exactly as F05 left them. `markRevoked` gets two changes: it now takes
 * `orgId` (a real `DatabasePort.withTenant` implementation needs it to set the RLS tenant
 * GUC before the row is even visible -- F05's in-memory fake never needed a tenant context,
 * so the gap was invisible until a Postgres adapter existed), and it returns a boolean (see
 * its own doc comment). Both existing callers already hold the `orgId` they read the row
 * with, so neither change is a shape they cannot satisfy.
 */
import type { OrgId } from "../../domain/org-id";
import type {
  AgendaSegmentStateForGrant,
  TemporaryGrant,
  TemporaryGrantRevokedReason,
  TemporaryGrantScope,
} from "../../domain/identity/temporary-grant";

export interface CreateTemporaryGrantInput {
  readonly id: string;
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly granterId: string;
  readonly granteeId: string;
  readonly scope: TemporaryGrantScope;
  readonly agendaSegmentId: string;
  readonly createdAt: string;
}

export interface TemporaryGrantRepository {
  create(input: CreateTemporaryGrantInput): Promise<TemporaryGrant>;

  /**
   * The one still-live (not yet revoked) grant for this grantee+scope, if any. There is at
   * most one by construction of `grantTemporaryRead` (see that file's header on why it does
   * not stack a second live grant on the same scope).
   */
  findActive(
    orgId: OrgId,
    granteeId: string,
    scope: TemporaryGrantScope,
  ): Promise<TemporaryGrant | null>;

  /**
   * Marks a grant revoked. Idempotent per grant id -- called from the READ path the first
   * time expiry is observed (see `check-temporary-grant-access.ts`) AND from the WRITE path
   * when `advanceAgendaSegment` pushes a revoke at the moment a segment lands terminal
   * (F127) -- either one may reach an already-revoked row (e.g. a read raced the push, or
   * the push runs a second time against a segment `SEGMENT_TERMINAL` already rejected
   * re-advancing), so this must stay a no-op on a second call, not a second audit write.
   *
   * `orgId` (added in F127): both real callers already read this exact row via an
   * org-scoped `findActive`/`findActiveBySegment`, so they already have it; a real
   * `DatabasePort.withTenant` adapter needs it to set the RLS tenant GUC, or the UPDATE
   * would run against a session with no tenant context and (correctly, under FORCE RLS)
   * see zero rows no matter which id is named.
   *
   * Returns `true` the one time this call is the one that actually revoked the row (so the
   * caller knows whether to count it / write the one audit event), `false` when the row was
   * already revoked and nothing changed -- callers that never needed the distinction (F05's
   * `check-temporary-grant-access.ts`) can keep ignoring the return value.
   */
  markRevoked(orgId: OrgId, id: string, revokedAt: string, reason: TemporaryGrantRevokedReason): Promise<boolean>;

  /**
   * Every still-live grant riding on this exact agenda segment, regardless of grantee/scope
   * -- the shape `advanceAgendaSegment` needs (F127): "what must I revoke now that THIS
   * segment just went terminal", not "does THIS ONE grantee still have access" (that is
   * `findActive`, F05's shape). Not derivable from `findActive` without knowing every
   * grantee in advance, which the state machine does not.
   */
  findActiveBySegment(orgId: OrgId, workshopId: string, agendaSegmentId: string): Promise<readonly TemporaryGrant[]>;
}

export const TEMPORARY_GRANT_REPOSITORY = Symbol("TemporaryGrantRepository");

/**
 * The one fact this module needs from the agenda-segment state machine: what state is this
 * segment in RIGHT NOW. Not `AgendaSegmentRepository` itself (`application/project/ports.ts`)
 * -- that port returns the full `AgendaSegmentRow` plus an `advance()` write method neither
 * grant nor expiry ever calls, and depending on the whole interface for one read field is
 * exactly the "reach across bundles for convenience" seam `no-frontend-copy`-style tests
 * exist to catch elsewhere. A thin reader is what a `project`-side adapter implements by
 * delegating to the real `AgendaSegmentRepository.findById` (one line), without `identity`
 * importing `project`'s port shape.
 */
export interface AgendaSegmentStateReader {
  findState(orgId: OrgId, workshopId: string, agendaSegmentId: string): Promise<AgendaSegmentStateForGrant | null>;
}

export const AGENDA_SEGMENT_STATE_READER = Symbol("AgendaSegmentStateReader");
