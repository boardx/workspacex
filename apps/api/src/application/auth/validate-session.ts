/**
 * `ValidateSession` -- the real implementation behind F18's `PrincipalResolverPort`.
 *
 * F18 shipped `HeaderPrincipalResolver`: read the principal out of a test-injection header,
 * unreachable in production, with the credential format deliberately left to this bundle
 * (UC-0.6 A-3). This is that credential format arriving: an opaque bearer token resolved
 * through the session store.
 *
 * ⚠ Returns null for every "not a valid session" case and lets the Guard turn that into a
 * 401. It does NOT throw a distinct error per reason at this layer, because the Guard's
 * rule is structural (principal non-null) and a resolver that threw three different things
 * would push authentication decisions into the Guard, which is the one place F18 kept them
 * out of.
 *
 * ⚠ A store failure must PROPAGATE, not become null. The Guard catches a thrown error and
 * answers 503 `auth_unavailable`; a null would answer 401. Those look similar and are not:
 * turning "Redis is down" into "you are not logged in" is a degradation, and the failure
 * row in usecases.md is explicit that Redis being unavailable means REFUSE.
 */
import { checkSession } from "../../domain/auth/session-lifetime";
import type { Clock, SessionTokenStore } from "./ports";

export interface ValidateSessionDeps {
  readonly sessions: SessionTokenStore;
  readonly clock: Clock;
}

export interface ValidatedSession {
  readonly userId: string;
  readonly currentOrgId: string | null;
}

export async function validateSession(
  deps: ValidateSessionDeps,
  sessionToken: string,
): Promise<ValidatedSession | null> {
  if (!sessionToken) return null;
  const record = await deps.sessions.findByToken(sessionToken);
  if (!record) return null;
  // Revoked BEFORE expired -- see `checkSession`. Both are null here; the distinction
  // matters to the user-facing reason code, which the session-list UI (phase-01 F03, not
  // migrated) will surface. Recorded so the domain distinction is not mistaken for dead code.
  if (checkSession(record, deps.clock.now().getTime()) !== null) return null;
  return { userId: record.userId, currentOrgId: record.currentOrgId };
}
