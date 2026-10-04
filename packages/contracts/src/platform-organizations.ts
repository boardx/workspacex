/** Platform operator catalog of SaaS organizations, including empty organizations.
 * personal-local privacy and platform containers remain outside this management surface.
 * Plan is independent of organization kind; missing plan is explicitly unconfigured.
 */
import { z } from "zod";
import * as A from "./ai-policy";
export const Plan = z.enum(["ordinary", "enterprise"]);
export const ErrorCode = z.enum(["NOT_PLATFORM_SUPERUSER", "ORGANIZATION_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLATFORM_CATALOG_UNAVAILABLE", "AI_POLICY_VERSION_CONFLICT", "AI_POLICY_MODEL_UNAVAILABLE", "AI_POLICY_WINDOW_LOCKED"]);
export const PlanState = z.object({
  plan: Plan.nullable(), version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
  /** Entitlement designation only: quota enforcement is inactive until admission is connected. */
  enforcement: z.literal("pending"),
}).strict();
export const OrganizationRow = z.object({
  orgId: z.string(), name: z.string(), kind: z.literal("organization"),
  memberCount: z.number().int().nonnegative(), plan: PlanState,
}).strict();
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
    in: z.object({ plan: Plan, expectedVersion: z.number().int().min(0).max(2147483646), reason: z.string().trim().min(1).max(500) }).strict(),
    out: PlanState, err: ErrorCode.options },
} as const;
