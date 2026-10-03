import { platformOrganizations as C } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";
export type OrganizationRow = z.infer<typeof C.OrganizationRow>;
export type OrganizationDetail = z.infer<typeof C.operations.getOrganization.out>;
export type PlanInput = z.infer<typeof C.operations.setPlan.in>;
export type OrganizationList = z.infer<typeof C.operations.listOrganizations.out>;
export function listPlatformOrganizations(search: string, cursor?: string): Promise<OrganizationList> {
  const query = new URLSearchParams({ search, limit: "25", ...(cursor ? { cursor } : {}) });
  return apiRequest(`${C.operations.listOrganizations.path}?${query}`);
}
export function getPlatformOrganization(orgId: string): Promise<OrganizationDetail> {
  return apiRequest(C.operations.getOrganization.path.replace(":orgId", encodeURIComponent(orgId)));
}
export function setPlatformOrganizationPlan(orgId: string, input: PlanInput): Promise<z.infer<typeof C.PlanState>> {
  return apiRequest(C.operations.setPlan.path.replace(":orgId", encodeURIComponent(orgId)), { method: "PATCH", body: input });
}
