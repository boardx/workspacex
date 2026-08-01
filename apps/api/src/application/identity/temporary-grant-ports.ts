/**
 * Ports for F05's temporary-grant use cases. Two new interfaces, not two more methods
 * bolted onto `IdentityRepository` -- same reasoning `application/project/ports.ts` gives
 * for F122/F123/F124 each getting their own port file: `pg-identity-repository.ts` has its
 * own `lint-permission-paths` exemption shaped around what it already does, and folding an
 * unrelated write surface (temporary grants) into it would drag that exemption somewhere
 * it wasn't reasoned about.
 *
 * ⚠ `TemporaryGrantRepository` deliberately has NO durable Postgres implementation yet.
 * `advance-agenda-segment.ts`'s own header notes that "临时提权本身还没有存储层" is F127's
 * deliverable (`feature_list.json` F127, `status: not_started`, no owner, no sprint) --
 * building that table here would be doing F127's job under F05's issue, the exact
 * "same fact declared in two places" failure AGENTS.md calls out five times over. F05's
 * scope (its own two `tests/auth/*` verification files) is the enforcement LOGIC: grant,
 * check-while-live, expire-on-first-observed-termination, audit both. The port is the seam
 * a future Postgres adapter plugs into without this module changing.
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
   * time expiry is observed (see `check-temporary-grant-access.ts`), so a second read after
   * the first-observed expiry must be a no-op, not a second audit write.
   */
  markRevoked(id: string, revokedAt: string, reason: TemporaryGrantRevokedReason): Promise<void>;
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
