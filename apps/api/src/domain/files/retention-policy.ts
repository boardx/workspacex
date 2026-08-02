/**
 * F46 -- O-01 留存五参数的解析规则（`getRetentionPolicy`/`setRetentionPolicy`, N-20).
 *
 * ## Why resolution lives here and not inline in the use case
 *
 * "项目级覆盖 -> 组织默认" (D-14) is exactly the kind of two-tier lookup this repo has
 * already written once for 05-rec (`domain/recording/retention.ts`'s doc comment: "两级都没
 * 配 ⇒ RETENTION_POLICY_MISSING，没有回落常量的分支"). That module resolves a DIFFERENT
 * domain fact (per-material retention with test-supplied parameters, no numeric literal
 * anywhere in the file); this one resolves the 22-files bundle's OWN five-field config,
 * whose org-wide default is `files.DEFAULT_RETENTION_PARAMS` (itself derived from
 * `auth.AUTH_POLICY.orgRetentionDays` / `org-admin.WITHDRAWAL_SLA_MS.physicalDelete`, not a
 * fresh literal -- see that const's header for why, closing `KNOWN_CONTRACT_GAPS.FS7`).
 *
 * ⚠ **No day-count literal appears anywhere in this file.** Every number a caller sees comes
 * from a parameter it was called with. `retention-param-single-source.test.ts` (F46's own
 * verification command) runs the SAME resolution logic against a table of arbitrary values
 * (1/7/45/180/365/1095/4000, none of them 180) precisely so that hardcoding any one of the
 * five real defaults back into this file would make every OTHER row in that table fail --
 * the same discipline F78's `retention-param-resolution-no-hardcode.test.ts` established.
 */
import type { z } from "zod";
import { files as C } from "@repo/contracts";

export type RetentionParams = z.infer<typeof C.RetentionParams>;
export type PartialRetentionParams = Partial<RetentionParams>;

export const RETENTION_PARAM_KEYS = [
  "materialDays",
  "derivedDays",
  "logDays",
  "trashGraceDays",
  "backupDays",
] as const;

export class RetentionParamInvalidError extends Error {
  constructor(readonly field: string, readonly value: unknown) {
    super(`retention param ${field} is invalid: ${String(value)}`);
  }
}

/**
 * Every field must be a positive integer (the contract's own `.int().positive()` on each of
 * the five) -- re-checked here defensively for the same reason `request-deletion.ts` re-
 * checks `confirmedImpact`/`reason`: a caller that bypasses the zod boundary must not reach
 * the database with a zero or negative day count.
 */
export function assertValidRetentionParams(params: RetentionParams): void {
  for (const key of RETENTION_PARAM_KEYS) {
    const value = params[key];
    if (!Number.isInteger(value) || value <= 0) throw new RetentionParamInvalidError(key, value);
  }
}

/**
 * D-14: project override wins field-by-field; anything the project has not overridden falls
 * back to the org default. `orgDefault` is passed in whole (never partial) -- there is
 * always a complete org-level answer (the injected default, or an org's own configured
 * whole record), so the resolved result is always a COMPLETE `RetentionParams`, never a
 * partial one silently missing a field.
 */
export function resolveRetentionParams(
  orgDefault: RetentionParams,
  projectOverride: PartialRetentionParams | null,
): RetentionParams {
  const resolved: RetentionParams = { ...orgDefault, ...(projectOverride ?? {}) };
  assertValidRetentionParams(resolved);
  return resolved;
}

/**
 * Merge a partial update into an existing project override, validating the RESULT (not just
 * the patch) -- `setRetentionPolicy.in.params` is `RetentionParams.partial()`, so a caller
 * may send one field; the other four must still be legitimate once merged with whatever the
 * project already had (or the org default, if the project had no override yet).
 */
export function mergeRetentionOverride(
  current: RetentionParams,
  patch: PartialRetentionParams,
): RetentionParams {
  const merged: RetentionParams = { ...current, ...patch };
  assertValidRetentionParams(merged);
  return merged;
}

/**
 * R3.d 点 14: has a material's age passed the resolved `materialDays`? Pure date arithmetic,
 * used by the retention-expiry scan to decide whether an artifact must enter the trash queue
 * on its own (not via a human's `requestDeletion`) -- same two-tier `resolveRetentionParams`
 * answer feeds both call sites, so a project override changes both the deadline used for a
 * MANUAL delete's grace period and the deadline used for AUTOMATIC expiry, from one place.
 */
export function isPastMaterialRetention(materializedAt: Date, now: Date, resolved: RetentionParams): boolean {
  const ms = resolved.materialDays * 24 * 60 * 60 * 1000;
  return now.getTime() - materializedAt.getTime() >= ms;
}

/**
 * "到期前给项目负责人可见提醒" (R3.d): a reminder window, not a hard gate -- true once the
 * material is within `reminderDays` of its resolved expiry but has not yet crossed it.
 * `reminderDays` is a caller-supplied parameter (not a sixth hardcoded constant here) since
 * O-01 does not name a specific lead time; the requirements doc only says "到期前".
 */
export function isNearMaterialRetention(
  materializedAt: Date,
  now: Date,
  resolved: RetentionParams,
  reminderDays: number,
): boolean {
  if (isPastMaterialRetention(materializedAt, now, resolved)) return false;
  const expiresAt = materializedAt.getTime() + resolved.materialDays * 24 * 60 * 60 * 1000;
  const reminderMs = reminderDays * 24 * 60 * 60 * 1000;
  return expiresAt - now.getTime() <= reminderMs;
}
