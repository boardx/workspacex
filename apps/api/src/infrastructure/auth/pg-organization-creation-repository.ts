import { createHash } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { AuthError } from "../../application/auth/errors";
import { OrganizationCreationConflict, type CreateOrganizationInput, type CreateOrganizationOutput, type OrganizationCreationRepository } from "../../application/auth/create-organization";
import { toOrgId, type OrgId } from "../../domain/org-id";
import { BOOTSTRAP_WRITE_COLUMNS } from "../deploy/bootstrap-write-columns";
import { ensureSystemAgent } from "../agent/pg-system-agent-repository";
import { DEFAULT_AGENT_TEMPLATE } from "../agent/pg-default-agent-repository";
import { DEEP_RESEARCH_AGENT_TEMPLATE } from "../agent/pg-deep-research-agent-repository";
import { IMAGE_GEN_AGENT_TEMPLATE } from "../agent/pg-image-gen-agent-repository";

/** Scoped to the authenticated user and retry key; never a tenant supplied by HTTP. */
export function organizationCreationId(userId: string, requestId: string): OrgId {
  return toOrgId(`org-${createHash("sha256").update(JSON.stringify([userId, requestId])).digest("hex").slice(0, 48)}`);
}
/** Reuse standard initialization with the SAME transaction; reject tenant escapes. */
function transactionDatabase(orgId: OrgId, session: TenantSession): DatabasePort {
  return {
    withTenant: async (target, fn) => {
      if (target !== orgId) throw new Error("organization initialization changed tenant");
      return fn(session);
    },
    withoutTenant: async () => { throw new Error("organization initialization requires tenant"); },
    close: async () => {},
  };
}
export class PgOrganizationCreationRepository implements OrganizationCreationRepository {
  constructor(private readonly db: DatabasePort) {}
  async create(input: CreateOrganizationInput): Promise<CreateOrganizationOutput> {
    const orgId = organizationCreationId(input.userId, input.requestId);
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 5494))", [orgId]);
      const credentials = await s.query<{ email_verified_at: Date | null }>(
        "SELECT email_verified_at FROM credentials WHERE user_id=$1 FOR SHARE", [input.userId],
      );
      if (!credentials.rows[0]) throw new AuthError("SESSION_REVOKED");
      if (!credentials.rows[0].email_verified_at) throw new AuthError("EMAIL_NOT_VERIFIED");
      // Only the caller's request receipt; no tenant content disclosure.
      const receipt = await s.query<{ org_name: string }>(
        "SELECT org_name FROM organization_creation_requests WHERE org_id=$1 AND user_id=$2 AND request_id=$3",
        [orgId, input.userId, input.requestId],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].org_name !== input.orgName) throw new OrganizationCreationConflict();
        return { orgId, orgName: receipt.rows[0].org_name };
      }
      await s.query(
        `INSERT INTO organizations (${BOOTSTRAP_WRITE_COLUMNS.organization.join(", ")}) VALUES ($1,$2,'organization')`,
        [orgId, input.orgName],
      );
      await s.query(
        `INSERT INTO org_memberships (${BOOTSTRAP_WRITE_COLUMNS.membership.join(", ")}) VALUES ($1,$2,'admin',NULL)`,
        [input.userId, orgId],
      );
      // Preserve the plan contract: absent plan/budget remains unconfigured. No inherited
      // enterprise plan, private model credentials, budgets or quotas are granted.
      const db = transactionDatabase(orgId, s);
      for (const template of [DEFAULT_AGENT_TEMPLATE, DEEP_RESEARCH_AGENT_TEMPLATE, IMAGE_GEN_AGENT_TEMPLATE]) {
        await ensureSystemAgent(db, template, { orgId, actorId: input.userId, now: new Date() });
      }
      await s.query(
        "INSERT INTO organization_creation_requests (org_id,user_id,request_id,org_name) VALUES ($1,$2,$3,$4)",
        [orgId, input.userId, input.requestId, input.orgName],
      );
      return { orgId, orgName: input.orgName };
    });
  }
}
