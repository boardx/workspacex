"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { auth as C } from "@repo/contracts";
import { useSession } from "@/components/session/session-provider";
import { apiRequest, ApiError, getStoredSessionToken } from "@/lib/api-client";

type VerificationState = "verifying" | "completed" | "invalid" | "unavailable" | "session-failed";

export function EmailVerification() {
  const session = useSession();
  const started = React.useRef(false);
  const [state, setState] = React.useState<VerificationState>("verifying");

  React.useEffect(() => {
    if (session.status === "loading" || started.current) return;
    started.current = true;
    const current = new URL(window.location.href);
    const token = current.searchParams.get("token");
    current.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);

    if (!token) {
      setState("invalid");
      return;
    }
    void apiRequest<typeof C.operations.confirmEmailVerification.out._output>("/auth/email-verifications/confirm", {
      method: "POST",
      sessionToken: null,
      body: { token, autoStartSession: session.status === "anonymous" },
    }).then(
      async (result) => {
        if (result.session && !getStoredSessionToken()) {
          try {
            await session.startSession(result.session);
            window.location.assign("/projects");
          } catch {
            setState("session-failed");
          }
          return;
        }
        setState("completed");
      },
      (error: unknown) => setState(
        error instanceof ApiError && error.reasonCode === "VERIFICATION_LINK_INVALID"
          ? "invalid"
          : error instanceof ApiError && error.reasonCode === "AUTH_SERVICE_UNAVAILABLE"
            ? "session-failed" : "unavailable",
      ),
    );
  }, [session]);

  const content = {
    verifying: { testId: "email-verification-pending", icon: <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />, title: "正在验证邮箱", body: "请稍候，不要关闭这个页面。" },
    completed: { testId: "email-verification-success", icon: <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />, title: "邮箱已验证", body: "现在可以返回 WorkspaceX 登录。" },
    invalid: { testId: "email-verification-invalid", icon: <CircleAlert className="h-6 w-6 text-warning" aria-hidden />, title: "验证链接不可用", body: "链接可能已过期。请重新申请验证邮件。" },
    "session-failed": { testId: "email-verification-session-failed", icon: <CircleAlert className="h-6 w-6 text-warning" aria-hidden />, title: "邮箱已验证，登录未完成", body: "请前往登录页，使用注册时的邮箱和密码登录。" },
    unavailable: { testId: "email-verification-unavailable", icon: <CircleAlert className="h-6 w-6 text-danger" aria-hidden />, title: "暂时无法验证", body: "暂时无法完成。邮箱可能已验证，请尝试登录，或从邮件重新打开验证链接。" },
  }[state];

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-6">
      <section className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-6 shadow-sm" data-testid={content.testId}>
        <div className="flex items-center gap-2">{content.icon}<h1 className="text-20 font-semibold">{content.title}</h1></div>
        <p className="text-13 text-muted-foreground" data-testid="email-verification-status">{content.body}</p>
        {(state === "completed" || state === "unavailable" || state === "session-failed") && <a className="text-primary underline" href="/login">前往登录</a>}
      </section>
    </main>
  );
}
