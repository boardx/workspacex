/**
 * PostgreSQL implementation of `IdentityRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and these WHERE clauses
 * are the second. The org_id predicates below are NOT redundant belt-and-braces -- they are
 * what makes the query readable to the next person. But if one were ever dropped, RLS still
 * holds; that asymmetry is the whole point of F18's design.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  BindingRow,
  IdentityRepository,
  AclObjectRef,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../application/identity/ports";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { isLocalOrg, LOCAL_ORG_KIND } from "../../domain/identity/local-org";
import { avatarUrlFor } from "../auth/pg-org-profile-repository";
import { strictestScope } from "../../domain/identity/permission-decision";

export class PgIdentityRepository implements IdentityRepository {
  constructor(private readonly db: DatabasePort) {}

  async findOrganization(orgId: OrgId): Promise<OrganizationRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        name: string;
        kind: string;
        model_policy: string;
        avatar_artifact_id: string | null;
      }>(
        "SELECT id, name, kind, model_policy, avatar_artifact_id FROM organizations WHERE id = $1",
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
        // invite-link-and-reads delta ④: the byte route itself already admits every org
        // member (see the controller's `avatarFile` long note); what was missing is a
        // member-readable place that SAYS the URL. This is that place. URL shape comes from
        // the single `avatarUrlFor` -- not a second hand-written copy.
        avatarUrl: avatarUrlFor(orgId, row.avatar_artifact_id),
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
   *
   * ⚠ FIXED 2026-08-01 (#75). A single object can carry MULTIPLE binding rows --
   * `acl_bindings_uniq`'s unique key includes `subject`, so "artifact X is team-only for
   * team A" and "artifact X is ALSO team-only for team B" are two legal rows on one object.
   * The previous body kept only the last row read per object key (`out.set` overwrote), and
   * the query had no `ORDER BY`, so "last" was whichever row Postgres happened to return
   * last -- undefined, not merely unfortunate.
   *
   * Invariant I-7 (permission-decision.ts) already has the right math for "one object
   * reachable through several sources": `strictestScope`. It was only being called from
   * `authorizeDerived`, for a DIFFERENT kind of multi-source case (several distinct
   * objects feeding one derived artifact). A first-class object carrying several binding
   * rows on ITSELF is the same shape of problem and gets the same fold. Confirmed by the
   * F31 counter-test: `f31rls-multi` has two team-only rows (energy, platform) and must be
   * `UNSATISFIABLE_TEAM` -- visible to neither team, not to whichever team's row won the
   * race.
   */
  async findBindings(orgId: OrgId, objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
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
            )
          ORDER BY object_kind, object_id`,
        [orgId, kinds, idsList],
      );
      const byObject = new Map<string, BindingRow[]>();
      for (const row of r.rows) {
        const key = `${row.object_kind}:${row.object_id}`;
        const rows = byObject.get(key) ?? [];
        rows.push({ scope: row.scope as BindingRow["scope"], ownerTeamId: row.owner_team_id });
        byObject.set(key, rows);
      }
      const out = new Map<string, BindingRow>();
      for (const [key, rows] of byObject) out.set(key, strictestScope(rows));
      return out;
    });
  }

  /**
   * Cross-organization read, so it cannot go through `withTenant` -- listing "which orgs am
   * I in" is by definition not scoped to one of them (O-12: one account, many orgs).
   *
   * ⚠ FIXED 2026-07-29 (F20). The previous body was a plain
   * `SELECT ... FROM org_memberships WHERE user_id = $1` inside `withoutTenant`, under a
   * comment saying "RLS therefore does not help here". RLS does not merely fail to help --
   * it BLOCKS it: the policy is `org_id = current_setting('app.current_org', true)`, which
   * with the setting unset compares against NULL and matches nothing. Under the runtime role
   * this method returned `[]` unconditionally.
   *
   * Nothing caught it because nothing called it. F20's login is the first caller that ever
   * needed the answer, and it got an empty list back for an account with a membership.
   * Measured: app_rw sees 0 rows without tenant context, the owner sees 1.
   *
   * The read now goes through `kernel_user_org_ids()`, a SECURITY DEFINER function declared
   * in migration 0010 -- one user, ids and roles only, nothing about the organizations
   * themselves. Those still come from `findOrganization` afterwards, under tenant scope, one
   * at a time. See the migration for why that shape rather than loosening the policy.
   */
  async listMemberships(userId: string): Promise<readonly { orgId: string; orgRole: OrgRole }[]> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ org_id: string; org_role: string }>(
        "SELECT org_id, org_role FROM kernel_user_org_ids($1)",
        [userId],
      );
      return r.rows.map((row) => ({ orgId: row.org_id, orgRole: row.org_role as OrgRole }));
    });
  }

  /* ───────────────────────── F16: the personal-local organization ───────────────────────── */

  /**
   * Idempotent creation (I-2).
   *
   * The read-then-insert below is NOT what makes it idempotent -- the partial unique index
   * `organizations_one_personal_local_per_user` is. The read is an optimisation for the
   * common case; the `catch` is the correctness. Two concurrent registrations of one user
   * both see "none", both insert, and one gets a unique violation instead of a second local
   * organization existing quietly.
   */
  async ensurePersonalLocalOrg(userId: string, displayName: string): Promise<OrganizationRow> {
    const existing = await this.findPersonalLocalOrg(userId);
    if (existing) return existing;

    const orgId = newLocalOrgId();
    try {
      await this.db.withTenant(orgId as OrgId, (s) =>
        insertPersonalLocalOrg(s, { orgId, userId, displayName }),
      );
    } catch (e) {
      // 23505 = unique_violation: somebody else won the race, which is the correct outcome.
      if ((e as { code?: string }).code !== "23505") throw e;
    }

    const org = await this.findPersonalLocalOrg(userId);
    if (org === null) throw new Error("personal-local org missing right after ensure (I-2)");
    return org;
  }

  /**
   * This user's local organization, found through their memberships.
   *
   * ⚠ Deliberately NOT a `SELECT ... FROM organizations WHERE owner_user_id = $1` under
   * `withoutTenant`. That query would be blocked by RLS anyway (the policy compares against
   * an unset setting and matches nothing -- the trap `listMemberships` already fell into
   * once), and the version that "fixed" it would be another SECURITY DEFINER function able to
   * find a local organization by owner. Such a function is precisely the tool a future
   * admin-console feature would reach for, and the promise is that no such lookup exists.
   *
   * So: memberships first (the same SECURITY DEFINER path every organization uses, scoped to
   * ONE user), then each organization read under its own tenant context.
   */
  async findPersonalLocalOrg(userId: string): Promise<OrganizationRow | null> {
    const memberships = await this.listMemberships(userId);
    for (const m of memberships) {
      const org = await this.findOrganization(m.orgId as OrgId);
      if (org && isLocalOrg(org.kind)) return org;
    }
    return null;
  }

  async countOrgMembers(orgId: OrgId): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1",
        [orgId],
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }
}

/** `org-local-<uuid>`. Prefixed for the same reason capability ids are: ids get read by people. */
export function newLocalOrgId(): string {
  return `org-local-${randomUUID()}`;
}

/**
 * The INSERT pair, shared by `ensurePersonalLocalOrg` and by REGISTRATION.
 *
 * ## Why it is exported rather than duplicated in the registration repository
 *
 * F16 requires the local organization to exist from the first moment an account does, and
 * "the same transaction" is the only version of that claim which survives a crash. So
 * `PgRegistrationRepository` calls this INSIDE its transaction rather than calling the
 * repository afterwards. Two copies of these two INSERTs would be two places for the
 * `owner_user_id` / membership pairing to drift -- and a local organization with no
 * membership row is invisible to its own owner (`findPersonalLocalOrg` goes through
 * memberships), which reads as "the feature did not run".
 *
 * ⚠ It re-points `app.current_org` at the new organization. That is safe and required: the
 * setting is transaction-local (`set_config(..., true)`), and the caller's own tenant context
 * has to be restored afterwards -- which the caller does, because only it knows what that was.
 */
export async function insertPersonalLocalOrg(
  s: TenantSession,
  input: { readonly orgId: string; readonly userId: string; readonly displayName: string },
): Promise<void> {
  await s.query(
    // The kind and the owner column travel together -- migration 0012's CHECK refuses either
    // without the other, so there is no half-formed local org for anything to find.
    //
    // ⚠ The kind is BOUND from `LOCAL_ORG_KIND` rather than written into the SQL text. A
    // string literal here would be a second declaration of the value the whole feature turns
    // on, in the one place a reader is least likely to look for it -- and it would be invisible
    // to the frontend's and backend's type systems alike.
    `INSERT INTO organizations (id, name, kind, owner_user_id) VALUES ($1, $2, $3, $4)`,
    [input.orgId, `${input.displayName} 的本地`, LOCAL_ORG_KIND, input.userId],
  );
  // 'admin' because there is nobody above them: the org has exactly one member, forever
  // (I-3). `team_id` is NULL -- a single-member organization has no teams to belong to.
  await s.query(
    `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)`,
    [input.userId, input.orgId],
  );
}
