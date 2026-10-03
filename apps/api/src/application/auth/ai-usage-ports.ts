import type { z } from "zod";
import type { aiUsage as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import type { IdentityRepository } from "../identity/ports";
export type AiUsageQuery=z.infer<typeof C.Query>;
export interface AiUsageRepository {
 summary(orgId:OrgId,input:AiUsageQuery):Promise<z.infer<typeof C.Summary>>;
 calls(orgId:OrgId,input:AiUsageQuery):Promise<z.infer<typeof C.Calls>>;
}
export const AI_USAGE_REPOSITORY=Symbol("AiUsageRepository");
export class AiUsageScopeError extends Error{constructor(readonly reasonCode:"NO_ORG_MEMBERSHIP"|"FORBIDDEN"){super(reasonCode);}}
/** Every self/org route uses this decision; client userId cannot broaden a member's scope. */
export async function scopeAiUsage(identity:Pick<IdentityRepository,"findOrgMembership">,principal:Principal,orgId:OrgId,input:AiUsageQuery):Promise<AiUsageQuery>{
 const membership=await identity.findOrgMembership(principal.userId,orgId);
 if(!membership) throw new AiUsageScopeError("NO_ORG_MEMBERSHIP");
 if(membership.orgRole==="admin") return input;
 if(input.userId!==undefined && input.userId!==principal.userId) throw new AiUsageScopeError("FORBIDDEN");
 return {...input,userId:principal.userId};
}
