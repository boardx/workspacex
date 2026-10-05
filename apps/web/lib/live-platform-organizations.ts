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
export type AiPolicyState=z.infer<typeof C.operations.getAiPolicy.out>;
export type AiPolicyInput=z.infer<typeof C.operations.setAiPolicy.in>;
export type AiCandidate=z.infer<typeof C.operations.getAiCandidates.out>[number];
export const getPlatformAiPolicy=(orgId:string)=>apiRequest<unknown>(C.operations.getAiPolicy.path.replace(":orgId",encodeURIComponent(orgId))).then(value=>C.operations.getAiPolicy.out.parse(value));
export const getPlatformAiCandidates=(orgId:string)=>apiRequest<unknown>(C.operations.getAiCandidates.path.replace(":orgId",encodeURIComponent(orgId))).then(value=>C.operations.getAiCandidates.out.parse(value));
export const setPlatformAiPolicy=(orgId:string,input:AiPolicyInput)=>apiRequest<unknown>(C.operations.setAiPolicy.path.replace(":orgId",encodeURIComponent(orgId)),{method:"PATCH",body:input}).then(value=>C.operations.setAiPolicy.out.parse(value));
