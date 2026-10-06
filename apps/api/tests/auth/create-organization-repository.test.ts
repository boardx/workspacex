import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { auth } from "@repo/contracts";
import { createOrganization, OrganizationCreationConflict } from "../../src/application/auth/create-organization";
import { PgOrganizationCreationRepository, organizationCreationId } from "../../src/infrastructure/auth/pg-organization-creation-repository";
import type { CredentialRepository } from "../../src/application/auth/ports";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
const input = { userId: "creator", orgName: "新组织", requestId: "b9895d9f-e385-46c8-aa29-484dfda7cb02" };
function database({ receipt, failAt }: { receipt?: string; failAt?: string } = {}) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, _params?: readonly unknown[]) => {
    statements.push(sql);
    if (failAt && sql.includes(failAt)) throw new Error("injected failure");
    if (sql.includes("SELECT email_verified_at")) return { rows: [{ email_verified_at: new Date() }] };
    if (sql.includes("INSERT INTO agent_versions")) return { rows: [{ id: "version" }] };
    if (sql.includes("SELECT org_name")) return { rows: receipt ? [{ org_name: receipt }] : [] };
    return { rows: [] };
  });
  const tenant = vi.fn(async (_org: unknown, fn: (s: TenantSession) => Promise<unknown>) => fn({ query } as TenantSession));
  const db = { withTenant: tenant, withoutTenant: vi.fn(), close: vi.fn() } as unknown as DatabasePort;
  return { db, query, statements, tenant };
}
describe("existing account organization creation", () => {
  it("withholds a receipt bound to another creator or retry request", async () => {
    const { db } = database();
    const receipt = await new PgOrganizationCreationRepository(db).create(input);
    const credentials = { findByUserId: async () => ({ emailVerifiedAt: new Date() }) } as unknown as CredentialRepository;
    for (const mismatch of [{ creatorId: "other-user" }, { requestId: "other-request" }]) {
      await expect(createOrganization({ credentials, repo: { create: async () => ({ ...receipt, ...mismatch }) } }, input)).rejects.toThrow("SESSION_REVOKED");
    }
    expect("orgName" in receipt.result).toBe(false);
  });
  it("validates name and forbids body nominated identities/tenants", () => {
    const schema = auth.operations.createOrganization.in;
    expect(schema.parse({ orgName: " 名称 ", requestId: input.requestId }).orgName).toBe("名称");
    for (const body of [{ ...input }, { orgName: "   ", requestId: input.requestId }, { orgName: "a".repeat(101), requestId: input.requestId }, { orgName: "名称", requestId: "not-uuid" }]) expect(schema.safeParse(body).success).toBe(false);
  });
  it("binds retry identity to user and request, independent of other tenants", () => {
    expect(organizationCreationId(input.userId, input.requestId)).toBe(organizationCreationId(input.userId, input.requestId));
    expect(organizationCreationId("other", input.requestId)).not.toBe(organizationCreationId(input.userId, input.requestId));
  });
  it("rejects absent/unverified credentials before writes", async () => {
    const repo = { create: vi.fn() };
    for (const credential of [null, { emailVerifiedAt: null }]) {
      const credentials = { findByUserId: vi.fn().mockResolvedValue(credential) } as unknown as CredentialRepository;
      await expect(createOrganization({ credentials, repo }, input)).rejects.toThrow();
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("uses one transaction for membership, standard agents and receipt without copying a tenant", async () => {
    const { db, tenant, statements, query } = database();
    const result = await createOrganization({ credentials: { findByUserId: async () => ({ emailVerifiedAt: new Date() }) } as unknown as CredentialRepository, repo: new PgOrganizationCreationRepository(db) }, input);
    expect(result.orgName).toBe(input.orgName); expect(tenant).toHaveBeenCalledTimes(1);
    expect(tenant.mock.calls[0]![0]).toBe(result.orgId);
    expect(query.mock.calls.find(c => c[0].includes("SELECT org_name"))?.[1]).toEqual([result.orgId, input.userId, input.requestId]);
    expect(statements.filter(s => s.includes("INSERT INTO agents"))).toHaveLength(3);
    expect(statements.some(s => s.includes("INSERT INTO credentials"))).toBe(false);
    expect(statements.some(s => /(?:FROM|JOIN) (?:organizations|org_memberships)/i.test(s))).toBe(false);
    expect(statements.some(s => /INSERT INTO (?:organization_plans|org_token_budget|organization_core_models)/.test(s))).toBe(false);
    expect(statements.at(-1)).toContain("INSERT INTO organization_creation_requests");
  });
  it("replays receipts without writes and rejects reuse for a different name", async () => {
    const { db, statements } = database({ receipt: input.orgName });
    await new PgOrganizationCreationRepository(db).create(input);
    expect(statements.every(s => !s.includes("INSERT"))).toBe(true);
    const other = database({ receipt: "other name" });
    await expect(new PgOrganizationCreationRepository(other.db).create(input)).rejects.toBeInstanceOf(OrganizationCreationConflict);
  });
  it("propagates initialization failure out of the transaction rather than committing a partial result", async () => {
    const { db, statements } = database({ failAt: "INSERT INTO agent_versions" });
    await expect(new PgOrganizationCreationRepository(db).create(input)).rejects.toThrow("injected failure");
    expect(statements.some(s => s.includes("INSERT INTO organization_creation_requests"))).toBe(false);
  });
  it("receipt migration enforces RLS and no mutation privilege", () => {
    const sql = readFileSync(new URL("../../migrations/20261006001000_organization_creation_requests.sql", import.meta.url), "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY"); expect(sql).toContain("UNIQUE(user_id,request_id)");
    expect(sql).toContain("GRANT SELECT,INSERT"); expect(sql).not.toContain("SECURITY DEFINER");
  });
});
