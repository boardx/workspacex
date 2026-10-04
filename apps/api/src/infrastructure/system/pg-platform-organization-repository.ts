import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { PlatformOrganizationError, type PlatformOrganizationRepository, type OrganizationListInput, type OrganizationList,
  type OrganizationDetail, type PlanInput, type PlanState } from "../../application/system/platform-organization-ports";
import { PLATFORM_ORG_ID, toOrgId, type OrgId } from "../../domain/org-id";
import {Configuration} from "@repo/contracts/ai-policy";
import type {AiPolicyState,AiPolicyInput} from "../../application/system/platform-organization-ports";

type Metadata = { id: string; name: string; kind: "organization" };
type PlanRow = { plan: "ordinary" | "enterprise"; version: number; updated_at: Date; updated_by: string };
const state = (row?: PlanRow): PlanState => ({ plan: row?.plan ?? null, version: row?.version ?? 0,
  updatedAt: row?.updated_at.toISOString() ?? null, updatedBy: row?.updated_by ?? null, enforcement: "pending" });

/** Catalog credential can see only SaaS id/name/kind. All plan/member queries stay tenant-scoped. */
export class PgPlatformOrganizationRepository implements PlatformOrganizationRepository {
  constructor(private readonly db: DatabasePort, private readonly catalog: DatabasePort | null) {}

  async onModuleDestroy(): Promise<void> { await this.catalog?.close(); }

  async getAiPolicy(orgId:OrgId,actorId:string):Promise<AiPolicyState>{
    const result=await this.db.withTenant(orgId,async s=>{
      const formal=await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization'",[orgId]);
      if(!formal.rows.length)throw new PlatformOrganizationError("ORGANIZATION_NOT_FOUND");
      return this.readAiPolicy(s,orgId);
    });
    await this.auditAccess(actorId,"detail",orgId);
    return result;
  }

  async setAiPolicy(orgId:OrgId,input:AiPolicyInput,actorId:string):Promise<AiPolicyState>{
    const configuration=Configuration.parse(input.configuration);
    return this.db.withTenant(orgId,async s=>{
      // Same org lock as plan edits and admission: even first configuration is serialized.
      const formal=await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE",[orgId]);
      if(!formal.rows.length)throw new PlatformOrganizationError("ORGANIZATION_NOT_FOUND");
      const prior=await this.readAiPolicy(s,orgId);
      if(prior.version!==input.expectedVersion)throw new PlatformOrganizationError("AI_POLICY_VERSION_CONFLICT");
      // Existing immutable windows are never reset by editing a template or price version.
      const overlap=await s.query("SELECT 1 FROM ai_budget_windows WHERE org_id=$1 AND window_start<$3::timestamptz AND window_end>$2::timestamptz LIMIT 1",[orgId,configuration.window.start,configuration.window.end]);
      if(overlap.rows.length)throw new PlatformOrganizationError("AI_POLICY_WINDOW_LOCKED");
      const version=input.expectedVersion+1,priceVersion=`policy:${String(orgId)}:${version}`;
      const encoded=JSON.stringify(configuration);
      await s.query(`INSERT INTO organization_ai_policies(org_id,version,configuration,price_version,updated_by)
        VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(org_id) DO UPDATE SET version=EXCLUDED.version,
        configuration=EXCLUDED.configuration,price_version=EXCLUDED.price_version,updated_by=EXCLUDED.updated_by,updated_at=now()`,[orgId,version,encoded,priceVersion,actorId]);
      await s.query(`INSERT INTO organization_ai_policy_changes(id,org_id,version,configuration,price_version,actor_id,reason)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,[randomUUID(),orgId,version,encoded,priceVersion,actorId,input.reason]);
      return this.readAiPolicy(s,orgId);
    });
  }

  private async readAiPolicy(s:TenantSession,orgId:OrgId):Promise<AiPolicyState>{
    const row=(await s.query<{version:number;configuration:unknown;price_version:string;updated_by:string;updated_at:Date}>(
      "SELECT version,configuration,price_version,updated_by,updated_at FROM organization_ai_policies WHERE org_id=$1",[orgId])).rows[0];
    const changes=await s.query<{version:number;actor_id:string;changed_at:Date;reason:string}>(
      "SELECT version,actor_id,changed_at,reason FROM organization_ai_policy_changes WHERE org_id=$1 ORDER BY version DESC LIMIT 50",[orgId]);
    return {version:row?.version??0,configuration:row?Configuration.parse(row.configuration):null,priceVersion:row?.price_version??null,
      updatedAt:row?.updated_at.toISOString()??null,updatedBy:row?.updated_by??null,enforcement:"pending",
      changes:changes.rows.map(change=>({version:change.version,actorId:change.actor_id,changedAt:change.changed_at.toISOString(),reason:change.reason}))};
  }

  async list(input: OrganizationListInput, actorId: string): Promise<OrganizationList> {
    if (!this.catalog) throw new PlatformOrganizationError("PLATFORM_CATALOG_UNAVAILABLE");
    const rows = await this.catalog.withoutTenant(async s => {
      await this.assertCatalogRole(s);
      const search = `%${input.search.replace(/[!%_]/g, c => `!${c}`)}%`;
      return (await s.query<Metadata>(`SELECT id, name, kind FROM organizations
        WHERE kind = 'organization' AND name ILIKE $1 ESCAPE '!' AND ($2::text IS NULL OR id > $2)
        ORDER BY id ASC LIMIT $3`, [search, input.cursor ?? null, input.limit + 1])).rows;
    }).catch(() => { throw new PlatformOrganizationError("PLATFORM_CATALOG_UNAVAILABLE"); });
    // Catalog reads are audited before disclosure; an audit failure fails closed.
    await this.auditAccess(actorId, "list", null);
    const page = rows.slice(0, input.limit);
    const organizations: OrganizationList["organizations"] = [];
    for (const row of page) {
      const organization = await this.db.withTenant(toOrgId(row.id), async s => this.readOrganization(s, toOrgId(row.id)));
      if (organization) organizations.push(organization);
    }
    return { organizations, nextCursor: rows.length > input.limit ? page.at(-1)?.id ?? null : null };
  }

  async detail(orgId: OrgId, actorId: string): Promise<OrganizationDetail> {
    const result = await this.db.withTenant(orgId, async s => {
      const organization = await this.readOrganization(s, orgId);
      if (!organization) throw new PlatformOrganizationError("ORGANIZATION_NOT_FOUND");
      const changes = await s.query<{ version: number; previous_plan: "ordinary" | "enterprise" | null;
        plan: "ordinary" | "enterprise"; actor_id: string; changed_at: Date; reason: string }>(
        `SELECT version, previous_plan, plan, actor_id, changed_at, reason FROM organization_plan_changes
         WHERE org_id=$1 ORDER BY version DESC LIMIT 50`, [orgId]);
      return { organization, changes: changes.rows.map(r => ({ version: r.version, previousPlan: r.previous_plan,
        plan: r.plan, actorId: r.actor_id, changedAt: r.changed_at.toISOString(), reason: r.reason })) };
    });
    await this.auditAccess(actorId, "detail", orgId);
    return result;
  }

  async auditUsageAccess(orgId:OrgId,actorId:string):Promise<void>{
    const valid=await this.db.withTenant(orgId,async s=>(await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization'",[orgId])).rows[0]);
    if(!valid) throw new PlatformOrganizationError("ORGANIZATION_NOT_FOUND");
    await this.auditAccess(actorId,"usage",orgId);
  }

  async setPlan(orgId: OrgId, input: PlanInput, actorId: string): Promise<PlanState> {
    return this.db.withTenant(orgId, async s => {
      // Lock the existing org, including initially unconfigured plans: no missing-row race.
      const org = await s.query<Metadata>("SELECT id, name, kind FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE", [orgId]);
      if (!org.rows[0]) throw new PlatformOrganizationError("ORGANIZATION_NOT_FOUND");
      const previous = (await s.query<PlanRow>("SELECT plan, version, updated_at, updated_by FROM organization_plans WHERE org_id=$1", [orgId])).rows[0];
      if ((previous?.version ?? 0) !== input.expectedVersion) throw new PlatformOrganizationError("PLAN_VERSION_CONFLICT");
      const version = input.expectedVersion + 1;
      const updated = await s.query<PlanRow>(`INSERT INTO organization_plans (org_id, plan, version, updated_by)
        VALUES ($1,$2,$3,$4) ON CONFLICT (org_id) DO UPDATE SET plan=EXCLUDED.plan,
        version=EXCLUDED.version, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING plan, version, updated_at, updated_by`, [orgId, input.plan, version, actorId]);
      await s.query(`INSERT INTO organization_plan_changes (id,org_id,version,previous_plan,plan,actor_id,reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), orgId, version, previous?.plan ?? null, input.plan, actorId, input.reason]);
      return state(updated.rows[0]);
    });
  }

  private async readOrganization(s: TenantSession, orgId: OrgId): Promise<OrganizationDetail["organization"] | null> {
    const row = (await s.query<Metadata>("SELECT id, name, kind FROM organizations WHERE id=$1 AND kind='organization'", [orgId])).rows[0];
    if (!row) return null;
    const count = (await s.query<{ count: string }>("SELECT COUNT(*) AS count FROM org_memberships WHERE org_id=$1", [orgId])).rows[0];
    const plan = (await s.query<PlanRow>("SELECT plan, version, updated_at, updated_by FROM organization_plans WHERE org_id=$1", [orgId])).rows[0];
    return { orgId: row.id, name: row.name, kind: row.kind, memberCount: Number(count?.count ?? 0), plan: state(plan) };
  }

  private async assertCatalogRole(s: TenantSession): Promise<void> {
    const roles = await s.query<{ safe: boolean }>(`SELECT NOT r.rolsuper AND NOT r.rolbypassrls
      AND pg_has_role(current_user, 'app_platform_org_catalog_ro', 'member')
      AND NOT pg_has_role(current_user, 'app_rw', 'member')
      AND NOT has_table_privilege(current_user, 'credentials', 'SELECT')
      AND NOT has_table_privilege(current_user, 'org_memberships', 'SELECT')
      AND NOT has_table_privilege(current_user, 'organizations', 'UPDATE') AS safe
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (roles.rows[0]?.safe !== true) throw new PlatformOrganizationError("PLATFORM_CATALOG_UNAVAILABLE");
  }

  private async auditAccess(actorId: string, action: "list" | "detail" | "usage", orgId: OrgId | null): Promise<void> {
    await this.db.withTenant(toOrgId(PLATFORM_ORG_ID), s => s.query(`INSERT INTO platform_organization_access_events (id,org_id,actor_id,action,target_org_id)
      VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), PLATFORM_ORG_ID, actorId, action, orgId]));
  }
}
