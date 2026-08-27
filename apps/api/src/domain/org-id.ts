/**
 * Organization identifier -- a value object in the innermost layer.
 *
 * It is the input to the RLS policy (`SET LOCAL app.current_org`). Why a branded
 * type: if the tenant context is ever passed wrong, the symptom is NOT an error,
 * it is silently reading someone else's data. Making it non-interchangeable with
 * a plain string is the cheapest possible guard.
 */
declare const brand: unique symbol;
export type OrgId = string & { readonly [brand]: "OrgId" };

/** Allowed shape: lowercase alphanumerics and hyphens, 1-64 chars */
const ORG_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isOrgId(v: unknown): v is OrgId {
  return typeof v === "string" && ORG_ID_RE.test(v);
}

export function toOrgId(v: unknown): OrgId {
  if (!isOrgId(v)) {
    // Deliberately does not embed `v`: it may come from a request body and would end up in logs.
    throw new Error("malformed orgId");
  }
  return v;
}

/**
 * The platform's own service org — a real row in `organizations` (`kind = 'platform'`,
 * one non-loginable member `svc-platform-templates`), not a magic string.
 *
 * ⚠ Moved here (2026-08-27, design-delta `platform-owned-skills`) from
 * `domain/canvas/platform-org.ts`, where it was originally declared for canvas
 * templates. This value isn't a canvas concept — it's the platform org itself, which
 * `skills`/`skill_versions`/`skill_version_files`/`capability_listings` now ALSO read
 * (RLS `_platform_read` policies), same pattern as canvas templates. `domain/canvas/
 * platform-org.ts` re-exports it so it stays one declaration, not two (AGENTS.md:
 * "同一事实不得声明在两处") — `DEEP_AGENT_PROVIDER_NAME` moved the same way in
 * design-delta `skill-lazy-loading` for the identical layering reason.
 *
 * ⚠ This literal ALSO appears in migration SQL (`USING (org_id = 'org-platform')` in
 * every `_platform_read` policy) — SQL can't import a TS constant. The two must stay
 * equal; a test reads the policy text back out of the database and compares it against
 * this constant (see `tests/canvas/platform-org-single-source.test.ts` for the existing
 * canvas-side check; the skill-side policies get their own check in
 * `tests/skill/platform-skills-single-source.test.ts`).
 */
export const PLATFORM_ORG_ID = "org-platform";

/** Whether this row belongs to the platform master copy (read-only to every real org). */
export function isPlatformOwned(orgId: string): boolean {
  return orgId === PLATFORM_ORG_ID;
}
