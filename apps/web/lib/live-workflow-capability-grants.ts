/**
 * 工作流权限授予（组织 admin）。类型从契约推导，调用一律走 `apiRequest`。
 */
import { workflowCapabilityGrants as C } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type WorkflowCapabilityGrantsOut = z.infer<typeof C.operations.listWorkflowCapabilityGrants.out>;
export type WorkflowCapabilityGrant = z.infer<typeof C.WorkflowCapabilityGrant>;
export type WorkflowCapabilityCatalogEntry = z.infer<typeof C.WorkflowCapabilityCatalogEntry>;
export type WorkflowCapabilityAuditEntry = z.infer<typeof C.WorkflowCapabilityAuditEntry>;
export type GrantableSideEffectCap = z.infer<typeof C.GrantableSideEffectCap>;
export type SideEffectCap = WorkflowCapabilityGrant["sideEffectCap"];

const itemPath = (template: string, capabilityCategory: string) =>
  template.replace(":capabilityCategory", encodeURIComponent(capabilityCategory));

export function listWorkflowCapabilityGrants(): Promise<WorkflowCapabilityGrantsOut> {
  return apiRequest(C.operations.listWorkflowCapabilityGrants.path, { method: "GET" });
}

export function setWorkflowCapabilityGrant(capabilityCategory: string, sideEffectCap: GrantableSideEffectCap): Promise<WorkflowCapabilityGrant> {
  return apiRequest(itemPath(C.operations.setWorkflowCapabilityGrant.path, capabilityCategory), {
    method: "PUT",
    body: { sideEffectCap },
  });
}

export function revokeWorkflowCapabilityGrant(capabilityCategory: string): Promise<WorkflowCapabilityGrant> {
  return apiRequest(itemPath(C.operations.revokeWorkflowCapabilityGrant.path, capabilityCategory), { method: "DELETE" });
}
