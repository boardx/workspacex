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
