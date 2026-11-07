import type { EnterpriseCreditGrantRequest, EnterpriseCreditGrantResult, EnterpriseUpgradeRequest, EnterpriseUpgradeOperation } from "@repo/contracts/billing-team";
import type { OrgId } from "../../domain/org-id";
export class EnterpriseError extends Error {
  constructor(readonly code: "enterprise_required" | "dependency_unavailable" | "idempotency_conflict" | "credit_balance_unrepresentable" | "ORGANIZATION_NOT_FOUND" | "PLAN_VERSION_CONFLICT" | "order_not_found") { super(code); }
}
export interface EnterpriseManagement {
  grant(orgId: OrgId, actorId: string, input: EnterpriseCreditGrantRequest): Promise<EnterpriseCreditGrantResult>;
  upgrade(orgId: OrgId, actorId: string, input: EnterpriseUpgradeRequest): Promise<EnterpriseUpgradeOperation>;
  operation(orgId: OrgId, operationRef: string): Promise<EnterpriseUpgradeOperation>;
}
export const ENTERPRISE_MANAGEMENT = Symbol("EnterpriseManagement");

export type RetainedTeamPayment = NonNullable<Extract<EnterpriseUpgradeOperation,{status:"succeeded"}>["receipt"]["retainedTeamPayment"]>;
/** Adapter must establish absence from authoritative payment storage; unavailable is not null. */
export interface EnterprisePaidTeamPort {
  readPaidTeamTerm(orgId:OrgId):Promise<RetainedTeamPayment|null>;
  stopFutureRenewal(orgId:OrgId,operationRef:string,payment:RetainedTeamPayment):Promise<RetainedTeamPayment>;
}
export interface EnterpriseUpgradeStore {
  begin(orgId:OrgId,actorId:string,input:EnterpriseUpgradeRequest):Promise<EnterpriseUpgradeOperation>;
  read(orgId:OrgId,operationRef:string):Promise<EnterpriseUpgradeOperation>;
  pending(orgId:OrgId,operationRef:string,code:"dependency_unavailable"|"PLAN_VERSION_CONFLICT"):Promise<EnterpriseUpgradeOperation>;
  activate(orgId:OrgId,operationRef:string,payment:RetainedTeamPayment|null):Promise<EnterpriseUpgradeOperation>;
}
