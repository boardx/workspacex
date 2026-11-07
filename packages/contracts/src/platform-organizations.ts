/** Platform operator catalog of SaaS organizations, including empty organizations.
 * personal-local privacy and platform containers remain outside this management surface.
 * Plan is independent of organization kind; missing plan is explicitly unconfigured.
 */
import { z } from "zod";
import * as A from "./ai-policy";
import {Plan,PlanState,PlanWrite,OrganizationPlanErrorCode} from "./organization-plan";
import {TeamEntitlement} from "./billing-team";
export {Plan,PlanState} from "./organization-plan";
export const ErrorCode=z.enum([...OrganizationPlanErrorCode.options,"AI_POLICY_VERSION_CONFLICT","AI_POLICY_MODEL_UNAVAILABLE","AI_POLICY_WINDOW_LOCKED"]);
export const OrganizationRow = z.object({
  orgId: z.string(), name: z.string(), kind: z.literal("organization"),
  memberCount: z.number().int().nonnegative(), plan: PlanState,
  billingSummary:TeamEntitlement.optional(),
}).strict().superRefine((value,ctx)=>{
 const summary=value.billingSummary;
 if(!summary){
  if(value.plan.enforcement==="active")ctx.addIssue({code:"custom",path:["billingSummary"],message:"active billing enforcement requires actual billing facts"});
  return;
 }
 if(summary.orgId!==value.orgId||summary.memberCount!==value.memberCount||summary.planVersion!==value.plan.version||value.plan.enforcement!=="active")ctx.addIssue({code:"custom",path:["billingSummary"],message:"organization and billing facts must share one coherent snapshot"});
 const current=value.plan.billingGeneration===summary.generation;
 if(summary.licenseStatus!=="none"&&!current)ctx.addIssue({code:"custom",path:["plan","billingGeneration"],message:"legacy Plan metadata cannot restore current billing rights"});
 if(summary.licenseStatus==="enterprise"&&value.plan.plan!=="enterprise"||["active","expired"].includes(summary.licenseStatus)&&value.plan.plan!=="ordinary"||current&&value.plan.plan==="enterprise"&&summary.licenseStatus!=="enterprise")ctx.addIssue({code:"custom",path:["billingSummary","licenseStatus"],message:"billing tier must derive from the same current Plan"});
});
const Query = z.object({
  search: z.string().trim().max(200).default(""), cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
export const operations = {
  getAiPolicy:{method:"GET",path:"/platform/organizations/:orgId/ai-policy",in:z.object({orgId:z.string()}).strict(),out:A.State,err:ErrorCode.options},
  setAiPolicy:{method:"PATCH",path:"/platform/organizations/:orgId/ai-policy",in:A.SetInput,out:A.State,err:ErrorCode.options},
  getAiCandidates:{method:"GET",path:"/platform/organizations/:orgId/ai-policy/candidates",in:z.object({orgId:z.string()}).strict(),out:z.array(A.Candidate),err:ErrorCode.options},
  listOrganizations: { method: "GET", path: "/platform/organizations", in: Query,
    out: z.object({ organizations: z.array(OrganizationRow), nextCursor: z.string().nullable() }).strict(),
    err: ErrorCode.options },
  getOrganization: { method: "GET", path: "/platform/organizations/:orgId", in: z.object({ orgId: z.string() }).strict(),
    out: z.object({ organization: OrganizationRow, changes: z.array(z.object({
      version: z.number().int().positive(), previousPlan: Plan.nullable(), plan: Plan,
      actorId: z.string(), changedAt: z.string(), reason: z.string(),
    }).strict()) }).strict(), err: ErrorCode.options },
  setPlan: { method: "PATCH", path: "/platform/organizations/:orgId/plan",
    in: PlanWrite,
    out: PlanState, err: ErrorCode.options },
} as const;
