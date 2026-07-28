/**
 * Principal resolver port -- "figure out who this request is".
 *
 * This kernel does NOT decide the credential format (JWT / session / mTLS belong to
 * phase-01 `01-auth`, see UC-0.6 A-3). It only fixes the shape of the port and two rules:
 *
 *   1. Cannot identify the caller => return `null` and let the Guard reject with 401.
 *      Never return an "anonymous principal" -- anonymous pass-through is the most
 *      common disguise for "the auth layer does not exist".
 *   2. Resolution dependency unavailable => throw, and let the Guard reject. Never
 *      degrade to allowing the request (same rule as identity's `AUTH_SERVICE_UNAVAILABLE`).
 */
import type { Principal } from "../../domain/principal";

export interface PrincipalResolverPort {
  resolve(headers: Readonly<Record<string, string | string[] | undefined>>): Promise<Principal | null>;
}

export const PRINCIPAL_RESOLVER_PORT = Symbol("PrincipalResolverPort");
