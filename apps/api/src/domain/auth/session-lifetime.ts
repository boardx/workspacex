/**
 * Session lifetime and validity -- domain invariants I-6 and I-7 (uc-1-1 R3 step 2 / AC2).
 *
 * ⚠ The 30 days is a `Backlog Use Case.html` number, not something measured from the
 * prototype -- uc-1-1 says so in as many words. It lives in `AUTH_POLICY.sessionDays`
 * (the single source) so that when a human revises it, one edit moves every consumer.
 */
import { auth as C } from "@repo/contracts";

export const SESSION_TTL_MS = C.AUTH_POLICY.sessionDays * 24 * 60 * 60 * 1000;

/** The stored form of a session. Epoch ms rather than ISO strings -- comparable, no parsing. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly currentOrgId: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /**
   * null = live.
   *
   * ⚠ I-7: revocation WRITES A MARK, it does not delete the row. Deleting makes "who was
   * kicked, and when" unanswerable -- and that is one of the four events uc-1-1 R6 requires
   * to be auditable. It also collapses two different answers into one: a deleted record and
   * a never-existed record are indistinguishable, so `SESSION_REVOKED` ("this device was
   * removed") degrades into `SESSION_EXPIRED` ("you have been away too long"), and
   * usecases.md keeps those separate precisely because the user needs to tell them apart.
   */
  readonly revokedAt: number | null;
}

/** Why a session is not usable. null = usable. */
export type SessionInvalidity = "SESSION_EXPIRED" | "SESSION_REVOKED";

/**
 * Revocation is checked BEFORE expiry.
 *
 * An expired-and-revoked session should report `SESSION_REVOKED`: the user was kicked, and
 * later it also happened to expire. Reporting expiry would tell them "you have been away a
 * while" when what actually happened is that somebody removed their device -- which is the
 * one case where they need to go change their password.
 */
export function checkSession(s: SessionRecord, now: number): SessionInvalidity | null {
  if (s.revokedAt !== null) return "SESSION_REVOKED";
  if (now >= s.expiresAt) return "SESSION_EXPIRED";
  return null;
}
