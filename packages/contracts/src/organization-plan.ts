/** Shared organization Plan facts; billing does not own a second Enterprise flag/version. */
import {z} from "zod";
export const Plan=z.enum(["ordinary","enterprise"]);
export const PlanEnforcement=z.enum(["pending","active"]);
export const OrganizationPlanErrorCode=z.enum(["NOT_PLATFORM_SUPERUSER","ORGANIZATION_NOT_FOUND","PLAN_VERSION_CONFLICT","PLATFORM_CATALOG_UNAVAILABLE"]);
export const PlanState=z.object({
 plan:Plan.nullable(),version:z.number().int().nonnegative(),updatedAt:z.string().nullable(),updatedBy:z.string().nullable(),
 enforcement:PlanEnforcement,billingGeneration:z.string().min(1).max(128).nullable().optional(),
}).strict();
export const PlanWrite=z.object({
 plan:Plan,expectedVersion:z.number().int().min(0).max(2147483646),reason:z.string().trim().min(1).max(500),
}).strict();
