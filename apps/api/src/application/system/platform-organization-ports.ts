import type { z } from "zod";
import { platformOrganizations as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
export type OrganizationListInput = z.infer<typeof C.operations.listOrganizations.in>;
export type OrganizationList = z.infer<typeof C.operations.listOrganizations.out>;
export type OrganizationDetail = z.infer<typeof C.operations.getOrganization.out>;
export type PlanInput = z.infer<typeof C.operations.setPlan.in>;
export type PlanState = z.infer<typeof C.PlanState>;
export class PlatformOrganizationError extends Error {
  constructor(readonly reasonCode: z.infer<typeof C.ErrorCode>) { super(reasonCode); }
}
/** Only called after PlatformOperatorGuard; catalog DB is separate from app_rw. */
export interface PlatformOrganizationRepository {
  auditUsageAccess(orgId:OrgId,actorId:string):Promise<void>;
  list(input: OrganizationListInput, actorId: string): Promise<OrganizationList>;
  detail(orgId: OrgId, actorId: string): Promise<OrganizationDetail>;
  setPlan(orgId: OrgId, input: PlanInput, actorId: string): Promise<PlanState>;
}
export const PLATFORM_ORGANIZATION_REPOSITORY = Symbol("PlatformOrganizationRepository");
