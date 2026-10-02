import { readFileSync } from "node:fs";
import { describe,expect,it,vi } from "vitest";
import { agentRole } from "@repo/contracts";
import { upgradeOfficialRoles,OfficialRoleUpgradeAdminRequiredError,OfficialRoleUpgradeConflictError } from "../../src/application/agent-import/upgrade-official-roles";
import { OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../src/domain/agent/official-role-packs";

const body = {packVersion:OFFICIAL_AGENT_ROLE_PACK_VERSION,expectedOrgId:"org-a",selections:[{agentId:"a",expectedPublishedVersionId:"v"}],idempotencyKey:"key"};
describe("official-role explicit upgrade boundary",()=>{
 it("requires admin and matching org before accessing upgrade repository",async()=>{
  const upgrade=vi.fn();const deps={identities:{findOrgMembership:vi.fn().mockResolvedValue({orgRole:"member"})},upgrades:{upgrade}};
  await expect(upgradeOfficialRoles(deps as never,{...body,actorId:"u",orgId:"org-a" as never})).rejects.toBeInstanceOf(OfficialRoleUpgradeAdminRequiredError);
  deps.identities.findOrgMembership.mockResolvedValue({orgRole:"admin"});
  await expect(upgradeOfficialRoles(deps as never,{...body,expectedOrgId:"org-b",actorId:"u",orgId:"org-a" as never})).rejects.toBeInstanceOf(OfficialRoleUpgradeAdminRequiredError);
  expect(upgrade).not.toHaveBeenCalled();
 });
 it("rejects stale target pack and duplicate role selection",async()=>{
  const upgrade=vi.fn();const deps={identities:{findOrgMembership:vi.fn().mockResolvedValue({orgRole:"admin"})},upgrades:{upgrade}};
  await expect(upgradeOfficialRoles(deps as never,{...body,packVersion:"0.0.0",actorId:"u",orgId:"org-a" as never})).rejects.toBeInstanceOf(OfficialRoleUpgradeConflictError);
  expect(upgrade).not.toHaveBeenCalled();
  expect(agentRole.OfficialRoleUpgradeInput.safeParse({...body,selections:[body.selections[0],body.selections[0]]}).success).toBe(false);
 });
 it("keeps a tenant-only provenance boundary and never changes old published versions or role status",()=>{
  const source=readFileSync(new URL("../../src/infrastructure/agent/pg-official-role-upgrade-repository.ts",import.meta.url),"utf8");
  expect(source).toContain("withTenant");expect(source).not.toContain("withoutTenant");
  expect(source).toContain("historicalOfficialRoleInstructionDigests");expect(source).toContain("payloadDigest");
  expect(source).toContain("expectedPublishedVersionId");expect(source).toContain("FOR UPDATE");
  expect(source).not.toMatch(/UPDATE\s+agent_versions/i);expect(source).not.toMatch(/UPDATE\s+agents\s+SET\s+status/i);
  const controller=readFileSync(new URL("../../src/interface/controllers/official-role-upgrade.controller.ts",import.meta.url),"utf8");expect(controller).toContain("assertPrincipal");
 });
});
