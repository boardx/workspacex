/**
 * `TemporaryGrantRepository`'s PostgreSQL implementation (F127) -- the durable store
 * `temporary-grant-ports.ts` was left waiting for (`temporary_grants` table, migration
 * `20260801200000_f127_temporary_grants_table.sql`).
 *
 * ## `lint-permission-paths` exemption
 *
 * `create()` only ever writes the ROW THE CALLER JUST ASKED TO CREATE (echoed back, same
 * shape as `pg-project-repository.ts`'s F117 exemption): `grant-temporary-read.ts` has
 * already run `authorize()` and its own facilitator/lead check BEFORE this repository is
 * ever reached. `findActive` / `findActiveBySegment` are the narrow reads their two callers
 * need, not an open content-disclosure surface: `checkTemporaryGrantAccess` asks "does THIS
 * grantee still have THIS scope" (never returns a stranger's grant to a requester -- the
 * caller supplies the `granteeId` it is checking access FOR), and `advanceAgendaSegment`
 * asks "what must I revoke because THIS segment I was just authorized to advance just went
 * terminal" -- `authorize({ action: "agendaSegment.advance" })` already ran one layer up in
 * that use case, same ordering `pg-agenda-segment-repository.ts`'s F119 entry documents.
 * `markRevoked` only ever flips the caller's own already-identified row. ⚠ The exemption is
 * valid ONLY while this file names no tenant table other than `temporary_grants`, so it is
 * not left as a claim: `tests/auth/temp-grant-pg-repo-guard.test.ts` parses the file and
 * fails if any other tenant table appears in a FROM/JOIN/INTO/UPDATE. If that test is ever
 * deleted, this entry must go with it (and the `lint-permission-paths.mjs` allowlist entry
 * alongside it).
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  TemporaryGrant,
  TemporaryGrantRevokedReason,
  TemporaryGrantScope,
} from "../../domain/identity/temporary-grant";
import type { CreateTemporaryGrantInput, TemporaryGrantRepository } from "../../application/identity/temporary-grant-ports";

interface GrantRow {
  id: string;
  org_id: string;
  workshop_id: string;
  granter_id: string;
  grantee_id: string;
  action: string;
  group_id: string | null;
  agenda_segment_id: string;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: TemporaryGrantRevokedReason | null;
}

const SELECT_COLUMNS = `id, org_id, workshop_id, granter_id, grantee_id, action, group_id,
       agenda_segment_id, created_at, revoked_at, revoked_reason`;

function toGrant(r: GrantRow): TemporaryGrant {
  return {
    id: r.id,
    orgId: r.org_id,
    workshopId: r.workshop_id,
    granterId: r.granter_id,
    granteeId: r.grantee_id,
    scope: { action: r.action, groupId: r.group_id },
    agendaSegmentId: r.agenda_segment_id,
    createdAt: new Date(r.created_at).toISOString(),
    revokedAt: r.revoked_at === null ? null : new Date(r.revoked_at).toISOString(),
    revokedReason: r.revoked_reason,
  };
}

export class PgTemporaryGrantRepository implements TemporaryGrantRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateTemporaryGrantInput): Promise<TemporaryGrant> {
    return this.db.withTenant(input.orgId, async (s) => {
      const inserted = await s.query<GrantRow>(
        `INSERT INTO temporary_grants
           (id, org_id, workshop_id, granter_id, grantee_id, action, group_id, agenda_segment_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.workshopId,
          input.granterId,
          input.granteeId,
          input.scope.action,
          input.scope.groupId,
          input.agendaSegmentId,
          input.createdAt,
        ],
      );
      return toGrant(inserted.rows[0]!);
    });
  }

  async findActive(orgId: OrgId, granteeId: string, scope: TemporaryGrantScope): Promise<TemporaryGrant | null> {
    return this.db.withTenant(orgId, async (s) => {
      // `group_id = $3 OR group_id IS NULL` — when the requested scope has no group
      // ($3 is null), `group_id = NULL` is unknown (never true) in SQL, so this collapses to
      // exactly "group_id IS NULL", matching `grantCovers`'s domain rule (a null-group grant
      // covers a null-group request; a specific-group grant does not). When $3 is a real
      // group, both an exact-group row and a wildcard (null-group) row match, same as
      // `grantCovers` treating a null-group grant as covering every group.
      const found = await s.query<GrantRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM temporary_grants
          WHERE org_id = $1 AND grantee_id = $2 AND action = $3
            AND (group_id = $4 OR group_id IS NULL)
            AND revoked_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [orgId, granteeId, scope.action, scope.groupId],
      );
      const row = found.rows[0];
      return row === undefined ? null : toGrant(row);
    });
  }

  async findActiveBySegment(
    orgId: OrgId,
    workshopId: string,
    agendaSegmentId: string,
  ): Promise<readonly TemporaryGrant[]> {
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<GrantRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM temporary_grants
          WHERE org_id = $1 AND workshop_id = $2 AND agenda_segment_id = $3 AND revoked_at IS NULL`,
        [orgId, workshopId, agendaSegmentId],
      );
      return found.rows.map(toGrant);
    });
  }

  async markRevoked(
    orgId: OrgId,
    id: string,
    revokedAt: string,
    reason: TemporaryGrantRevokedReason,
  ): Promise<boolean> {
    // `orgId` (F127 addition to the port, see its doc comment) is what lets this be a plain
    // `withTenant` UPDATE instead of a second cross-tenant lookup just to bootstrap one --
    // both real callers already read this exact row via an org-scoped
    // `findActive`/`findActiveBySegment` and so already have it in hand.
    const updated = await this.db.withTenant(orgId, async (s) =>
      s.query<{ id: string }>(
        `UPDATE temporary_grants
            SET revoked_at = $2, revoked_reason = $3
          WHERE id = $1 AND org_id = $4 AND revoked_at IS NULL
          RETURNING id`,
        [id, revokedAt, reason, orgId],
      ),
    );
    return updated.rows.length > 0;
  }
}
