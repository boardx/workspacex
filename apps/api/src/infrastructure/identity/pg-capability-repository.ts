/**
 * PostgreSQL implementation of `CapabilityRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id`
 * predicates are the second.
 *
 * ## Why nothing here returns a plain row
 *
 * `capability_listings` carries tenant data with a per-row visibility scope, so it is a
 * table `lint-permission-paths` requires to be read behind the guard -- and rightly: the
 * admin console is the second-largest read surface in the product, and a repository handing
 * back raw rows makes forgetting to judge them an omission instead of a type error.
 *
 * The scope facts come back OUTSIDE the guard, because they are what the decision is made
 * FROM. Putting them inside would make the decision need the payload it is deciding about.
 *
 * ## Ids are minted here
 *
 * `cap-<uuid>`, never supplied by a caller. The prefix is for the same reason
 * `UuidIdFactory` uses one: these ids appear in `provenance_events.target_id`, where a bare
 * uuid tells a reader nothing about what it names.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CapabilityInsert,
  CapabilityPatch,
  CapabilityRepository,
  GuardedCapability,
} from "../../application/identity/capability-ports";
import { guard } from "../../application/security/permission-filter";
import type { CapabilityKind, CapabilityListing } from "../../domain/identity/capability-listing";
import type { VisibilityScope } from "../../domain/identity/roles";
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { OrgId } from "../../domain/org-id";

interface Row {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  scope: string;
  owner_team_id: string | null;
  enabled: boolean;
  endpoint: string | null;
  /** #619 */
  abbr: string | null;
  duty: string | null;
}

const COLUMNS = "id, org_id, kind, name, scope, owner_team_id, enabled, endpoint, abbr, duty";

function toGuarded(row: Row): GuardedCapability {
  const listing: CapabilityListing = {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind as CapabilityKind,
    name: row.name,
    scope: row.scope as VisibilityScope,
    enabled: row.enabled,
    endpoint: row.endpoint,
    // #619: null for every kind but agent; the CHECK constraint guarantees non-null here
    // for a `kind='agent'` row, so this is a straight passthrough, not a default.
    abbr: row.abbr,
    duty: row.duty,
    // Derived by `projectListingForOrg` in the use case, which is the only place that knows
    // the organization's kind. Null here rather than a guessed string: a reason invented at
    // the storage layer would be a second, unreconciled answer to "why is this row grey".
    disabledReason: null,
  };
  return {
    facts: {
      id: row.id,
      scope: row.scope as VisibilityScope,
      ownerTeamId: row.owner_team_id,
      endpoint: row.endpoint,
    },
    listing: guard({ kind: "capability", id: row.id }, listing),
  };
}

export class PgCapabilityRepository implements CapabilityRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * design-delta `platform-owned-skills` -- every read here also matches rows owned by
   * `PLATFORM_ORG_ID` (the four official Skills' `capability_listings` row), not just the
   * caller's own org. RLS's `capability_listings_platform_read` policy is what actually
   * permits reading them; this `OR` is what makes them show up in results instead of just
   * being technically-readable-but-never-queried. Today only `kind='skill'` rows exist
   * under the platform org, so this has no effect on agents/MCP/other kinds -- it would
   * naturally extend to those too if the platform ever owns one.
   */
  async listByKind(orgId: OrgId, kind: CapabilityKind): Promise<readonly GuardedCapability[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS} FROM capability_listings
          WHERE (org_id = $1 OR org_id = $3) AND kind = $2
          ORDER BY name`,
        [orgId, kind, PLATFORM_ORG_ID],
      );
      return r.rows.map(toGuarded);
    });
  }

  async listAll(orgId: OrgId): Promise<readonly GuardedCapability[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS} FROM capability_listings
          WHERE org_id = $1 OR org_id = $2
          ORDER BY kind, name`,
        [orgId, PLATFORM_ORG_ID],
      );
      return r.rows.map(toGuarded);
    });
  }

  async findById(orgId: OrgId, id: string): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS} FROM capability_listings
          WHERE (org_id = $1 OR org_id = $3) AND id = $2`,
        [orgId, id, PLATFORM_ORG_ID],
      );
      const row = r.rows[0];
      return row ? toGuarded(row) : null;
    });
  }

  async insert(orgId: OrgId, input: CapabilityInsert): Promise<GuardedCapability> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `INSERT INTO capability_listings
           (id, org_id, kind, name, scope, owner_team_id, endpoint, abbr, duty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          `cap-${randomUUID()}`, orgId, input.kind, input.name, input.scope,
          input.ownerTeamId, input.endpoint, input.abbr, input.duty,
        ],
      );
      const row = r.rows[0];
      // An INSERT ... RETURNING with no row means the write did not happen; handing back a
      // fabricated listing would tell the admin their configuration was saved.
      if (!row) throw new Error("capability insert returned no row");
      return toGuarded(row);
    });
  }

  async update(orgId: OrgId, id: string, patch: CapabilityPatch): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      // COALESCE on the parameter, so an absent field keeps its stored value. Building the
      // SET clause from whichever keys are present would put caller-supplied strings into
      // SQL text, which is the one thing this file must never do.
      //
      // ⚠ Consequence, stated rather than hidden: `ownerTeamId: null` cannot be told apart
      // from "not supplied" through this path, so a team-only capability cannot be widened to
      // org-wide by nulling the team alone -- it is done by setting `scope: "org-wide"`, and
      // the CHECK constraint then requires the team to go with it.
      const r = await s.query<Row>(
        `UPDATE capability_listings
            SET name          = COALESCE($3, name),
                scope         = COALESCE($4, scope),
                owner_team_id = CASE WHEN COALESCE($4, scope) = 'org-wide' THEN NULL
                                     ELSE COALESCE($5, owner_team_id) END,
                endpoint      = COALESCE($6, endpoint)
          WHERE org_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
        [orgId, id, patch.name ?? null, patch.scope ?? null, patch.ownerTeamId ?? null, patch.endpoint ?? null],
      );
      const row = r.rows[0];
      return row ? toGuarded(row) : null;
    });
  }

  async setEnabled(orgId: OrgId, id: string, enabled: boolean): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `UPDATE capability_listings SET enabled = $3
          WHERE org_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
        [orgId, id, enabled],
      );
      const row = r.rows[0];
      return row ? toGuarded(row) : null;
    });
  }
}
