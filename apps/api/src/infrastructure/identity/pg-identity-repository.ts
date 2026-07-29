/**
 * PostgreSQL implementation of `IdentityRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and these WHERE clauses
 * are the second. The org_id predicates below are NOT redundant belt-and-braces -- they are
 * what makes the query readable to the next person. But if one were ever dropped, RLS still
 * holds; that asymmetry is the whole point of F18's design.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  BindingRow,
  IdentityRepository,
  ObjectRef,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../application/identity/ports";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";

export class PgIdentityRepository implements IdentityRepository {
  constructor(private readonly db: DatabasePort) {}

  async findOrganization(orgId: OrgId): Promise<OrganizationRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; name: string; kind: string; model_policy: string }>(
        "SELECT id, name, kind, model_policy FROM organizations WHERE id = $1",
        [orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind as OrganizationRow["kind"],
        // The contract's Organization carries `team`. It is a property of the CALLER's
        // membership, not of the organization, so it is filled in by resolveIdentity where
        // the membership is known -- null here rather than silently omitted, because an
        // omitted field is how a response quietly stops matching its contract.
        team: null,
        modelPolicy: row.model_policy as OrganizationRow["modelPolicy"],
      };
    });
  }

  async findOrgMembership(userId: string, orgId: OrgId): Promise<OrgMembershipRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ org_role: string; team_id: string | null }>(
        "SELECT org_role, team_id FROM org_memberships WHERE user_id = $1 AND org_id = $2",
        [userId, orgId],
      );
      const row = r.rows[0];
      return row ? { orgRole: row.org_role as OrgRole, teamId: row.team_id } : null;
    });
  }

  async findProjectMembership(
    userId: string,
    projectId: string,
    orgId: OrgId,
  ): Promise<ProjectMembershipRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_role: string; group_id: string | null; is_host: boolean }>(
        `SELECT pm.project_role, pm.group_id, pm.is_host
           FROM project_memberships pm
           JOIN projects p ON p.id = pm.project_id
          WHERE pm.user_id = $1 AND pm.project_id = $2 AND pm.org_id = $3`,
        [userId, projectId, orgId],
      );
      const row = r.rows[0];
      return row
        ? {
            projectRole: row.project_role as ProjectMembershipRow["projectRole"],
            groupId: row.group_id,
            isHost: row.is_host,
          }
        : null;
    });
  }

  /**
   * One round trip for the whole batch. This is the reason `authorizeBatch` exists at all
   * (coherence review B-2): per-object queries would make correct authorization the slow
   * path, and a slow correct path is one people route around.
   */
  async findBindings(orgId: OrgId, objects: readonly ObjectRef[]): Promise<Map<string, BindingRow>> {
    if (objects.length === 0) return new Map();
    return this.db.withTenant(orgId, async (s) => {
      const kinds = objects.map((o) => o.kind);
      const idsList = objects.map((o) => o.id);
      const r = await s.query<{
        object_kind: string;
        object_id: string;
        scope: string;
        owner_team_id: string | null;
      }>(
        `SELECT object_kind, object_id, scope, owner_team_id
           FROM acl_bindings
          WHERE org_id = $1
            AND (object_kind, object_id) IN (
              SELECT * FROM unnest($2::text[], $3::text[])
            )`,
        [orgId, kinds, idsList],
      );
      const out = new Map<string, BindingRow>();
      for (const row of r.rows) {
        out.set(`${row.object_kind}:${row.object_id}`, {
          scope: row.scope as BindingRow["scope"],
          ownerTeamId: row.owner_team_id,
        });
      }
      return out;
    });
  }

  /**
   * Cross-organization read, so it cannot go through `withTenant` -- listing "which orgs am
   * I in" is by definition not scoped to one of them.
   *
   * RLS therefore does not help here, which is why the query is restricted to the caller's
   * own user_id and returns ONLY org ids and roles. No names, no counts, nothing about the
   * organizations themselves: those come from `findOrganization` afterwards, under tenant
   * scope, one at a time.
   */
  async listMemberships(userId: string): Promise<readonly { orgId: string; orgRole: OrgRole }[]> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ org_id: string; org_role: string }>(
        "SELECT org_id, org_role FROM org_memberships WHERE user_id = $1",
        [userId],
      );
      return r.rows.map((row) => ({ orgId: row.org_id, orgRole: row.org_role as OrgRole }));
    });
  }
}
