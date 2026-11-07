"use client";

import type { MessageKey } from "@/lib/i18n/messages";
import { useSession } from "@/components/session/session-provider";
import { SessionReplacementSupersededError } from "@/lib/session-storage-lock";
import { getStoredSessionToken } from "@/lib/api-client";
import type { auth } from "@repo/contracts";

export type InvitationCompletion = "ready" | "session-preserved" | "session-failed";
type AuthenticatedSession = typeof auth.AuthenticatedSession._output;

/** A late activation response must not replace an existing or newly changed account. */
export function useInvitationSession() {
  const current = useSession();
  return async (
    next: AuthenticatedSession,
    initialToken: string | null,
    existingAccount = false,
  ): Promise<InvitationCompletion> => {
    if (!next) return "session-failed";
    if (getStoredSessionToken() !== initialToken ||
      (!existingAccount && initialToken !== null) ||
      (existingAccount && (!initialToken || current.session?.userId !== next.userId))) {
      return "session-preserved";
    }
    try {
      await current.startSession({
        ...next,
        // Enter the invited organization while retaining the already authenticated account's
        // other organizations. All actual access still goes through identity authorization.
        orgs: [...new Set([...next.orgs, ...(existingAccount ? current.session?.orgIds ?? [] : [])])],
      }, { expectedToken: initialToken });
      if (getStoredSessionToken() !== next.sessionToken) return "session-preserved";
      window.location.assign("/projects");
      return "ready";
    } catch (error) {
      return error instanceof SessionReplacementSupersededError ? "session-preserved" : "session-failed";
    }
  };
}

export const INVITATION_COMPLETION_KEYS: Record<InvitationCompletion, MessageKey> = {
  ready: "invitation.ready",
  "session-preserved": "invitation.sessionPreserved",
  "session-failed": "invitation.sessionFailed",
};
