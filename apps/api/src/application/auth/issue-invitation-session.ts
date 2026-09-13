import type { SessionRecord } from "../../domain/auth/session-lifetime";
import { AuthError } from "./errors";
import type { LoginOutput } from "./login";
import { SessionStoreUnavailableError, type SessionTokenStore } from "./ports";

/** Deliver the bearer from the activation's one issuance; a session ID is not a bearer. */
export async function issueInvitationSession(
  sessions: SessionTokenStore,
  record: SessionRecord,
): Promise<LoginOutput> {
  try {
    const sessionToken = await sessions.issue(record);
    return {
      sessionToken,
      userId: record.userId,
      orgs: record.currentOrgId === null ? [] : [record.currentOrgId],
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  } catch (error) {
    // The account/membership transaction already committed. Never consume the invite again
    // to recover a failed issuance; the user can recover through ordinary password login.
    if (error instanceof SessionStoreUnavailableError) throw new AuthError("AUTH_SERVICE_UNAVAILABLE");
    throw error;
  }
}
