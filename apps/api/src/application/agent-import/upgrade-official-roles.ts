import type { z } from "zod";
import { agentRole } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { buildOfficialAgentRolePack } from "../../domain/agent/official-role-packs";
import type { OfficialAgentStarterPack } from "../../domain/agent/starter-pack";
import type { IdentityRepository } from "../identity/ports";

export type OfficialRoleUpgradeInput = z.infer<typeof agentRole.OfficialRoleUpgradeInput>;
export type OfficialRoleUpgradeResult = z.infer<typeof agentRole.OfficialRoleUpgradeResult>;
export interface OfficialRoleUpgradeOffer { readonly agentId: string; readonly expectedPublishedVersionId: string; readonly name: string; readonly currentVersion: string; readonly targetVersion: string; readonly readySkillCount: number; readonly pendingSkillCount: number; }
export interface OfficialRoleUpgradeRepository {
  offers(orgId: OrgId, pack: OfficialAgentStarterPack): Promise<readonly OfficialRoleUpgradeOffer[]>;
  upgrade(input: OfficialRoleUpgradeInput & { readonly orgId: OrgId; readonly actorId: string; readonly pack: OfficialAgentStarterPack }): Promise<OfficialRoleUpgradeResult>;
}
export const OFFICIAL_ROLE_UPGRADE_REPOSITORY = Symbol("OfficialRoleUpgradeRepository");
export class OfficialRoleUpgradeConflictError extends Error {}
export class OfficialRoleUpgradeAdminRequiredError extends Error {}

export async function upgradeOfficialRoles(
  deps: { readonly identities: IdentityRepository; readonly upgrades: OfficialRoleUpgradeRepository },
  input: OfficialRoleUpgradeInput & { readonly orgId: OrgId; readonly actorId: string },
): Promise<OfficialRoleUpgradeResult> {
  const member = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (member?.orgRole !== "admin" || input.expectedOrgId !== input.orgId) throw new OfficialRoleUpgradeAdminRequiredError();
  const pack = buildOfficialAgentRolePack();
  if (input.packVersion !== pack.packVersion) throw new OfficialRoleUpgradeConflictError();
  return deps.upgrades.upgrade({ ...input, pack });
}
