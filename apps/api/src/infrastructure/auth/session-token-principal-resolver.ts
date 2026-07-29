/**
 * The REAL principal resolver: an opaque bearer token, resolved through the session store.
 *
 * This is what UC-0.6 A-3 deferred. F18 shipped `HeaderPrincipalResolver` -- read the
 * principal out of `x-kernel-test-principal`, unreachable in production -- explicitly as a
 * placeholder "so the Guard's structural constraints can be asserted now rather than after
 * auth is built". Auth is now built.
 *
 * ## The test-injection header is not removed, and that is deliberate
 *
 * Sixteen existing kernel test files authenticate through it, and every one of them is
 * about something other than authentication (RLS isolation, the role matrix, artifact
 * binding modes...). Rewriting all of them to perform a real login would couple those
 * assertions to this bundle, so that a bug in login would fail thirty tests about other
 * things -- which is how a suite stops telling you where the problem is.
 *
 * So: the real path is tried FIRST, and the injection path remains, still gated on
 * `KERNEL_ALLOW_TEST_PRINCIPAL=1 AND NODE_ENV !== production`. `verify-runtime-gates.sh`
 * already carries the counter-proof that the gate holds; that counter-proof now also
 * protects this composite.
 *
 * ⚠ ORDER MATTERS AND IS ASSERTED. Real token first means a request bearing a valid session
 * can never be overridden by an injected header. The reverse order would let anyone who can
 * set a header impersonate anyone else in any environment where the flag was ever left on.
 *
 * ## Store failure propagates
 *
 * A thrown error becomes 503 `auth_unavailable` in the Guard. Catching it and returning
 * null would answer 401 instead, which reads as "your session ended" and sends the user to
 * log in -- which also fails. Same rule as identity's `AUTH_SERVICE_UNAVAILABLE`: refuse,
 * never degrade.
 */
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import { validateSession, type ValidateSessionDeps } from "../../application/auth/validate-session";
import type { Principal } from "../../domain/principal";
import { isOrgId } from "../../domain/org-id";

export class SessionTokenPrincipalResolver implements PrincipalResolverPort {
  private readonly testInjectionEnabled: boolean;

  constructor(private readonly deps: ValidateSessionDeps) {
    this.testInjectionEnabled =
      process.env.KERNEL_ALLOW_TEST_PRINCIPAL === "1" && process.env.NODE_ENV !== "production";
  }

  async resolve(
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<Principal | null> {
    const token = bearerToken(headers);
    if (token) {
      const session = await validateSession(this.deps, token);
      if (!session) return null;
      // ⚠ A session with no current organization resolves to null, i.e. 401 -- NOT to an
      // "org-less principal". `Principal.orgId` is what `SET LOCAL app.current_org` is fed;
      // an empty one makes every RLS policy match nothing, so the request would return
      // empty lists everywhere and look like "you have no data" rather than like an error.
      //
      // uc-1-5 A3 (an account with no organization yet) is a real state and it needs the
      // "create an organization" flow, not a half-authenticated session. That flow is F19's.
      if (!isOrgId(session.currentOrgId)) return null;
      return { userId: session.userId, orgId: session.currentOrgId };
    }

    if (!this.testInjectionEnabled) return null;
    const raw = headers["x-kernel-test-principal"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;
    const [userId, orgId] = value.split(":");
    if (!userId || !isOrgId(orgId)) return null;
    return { userId, orgId };
  }
}

/**
 * `Authorization: Bearer <token>`.
 *
 * Not a cookie. A cookie is attached by the browser to every request to the origin, which
 * is what makes CSRF possible at all; an explicit header has to be set by the code making
 * the call. The frontend consequence -- the token must be held somewhere JavaScript can
 * reach -- is a real trade-off and belongs to the web bundle, not here.
 */
function bearerToken(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value.trim());
  return m?.[1] ?? null;
}
