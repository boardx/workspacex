"use client";

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

export const INVITATION_COMPLETION_MESSAGES: Record<InvitationCompletion, string> = {
  ready: "已加入组织，正在进入工作台。",
  "session-preserved": "已加入组织。当前登录账号已保留；如需使用新账号，请退出当前账号后登录。",
  "session-failed": "自动登录未完成，账号可能已创建。请尝试使用注册时的邮箱和密码登录；若仍无法登录，请联系管理员。",
};
