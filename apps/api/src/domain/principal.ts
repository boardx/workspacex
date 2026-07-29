/**
 * Principal -- "who made this request".
 *
 * The credential format (JWT / session / mTLS) is deliberately NOT decided here
 * (UC-0.6 A-3; it belongs to phase-01 `01-auth`). This layer fixes exactly one
 * structural invariant: the principal a handler receives is non-null and carries
 * an orgId. A null principal reaching a handler means the auth layer effectively
 * does not exist -- the most common silent defect there is.
 */
import type { OrgId } from "./org-id";

export interface Principal {
  readonly userId: string;
  readonly orgId: OrgId;
}

export function assertPrincipal(p: Principal | null | undefined): asserts p is Principal {
  if (!p || !p.userId || !p.orgId) {
    throw new Error("principal is empty -- this path bypassed the auth layer");
  }
}
