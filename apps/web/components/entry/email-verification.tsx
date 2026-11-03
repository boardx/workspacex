"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { auth as C } from "@repo/contracts";
import { useSession } from "@/components/session/session-provider";
import { apiRequest, ApiError, getStoredSessionToken } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/entry/auth-shell";

type VerificationState = "verifying" | "completed" | "invalid" | "unavailable" | "session-failed";

export function EmailVerification() {
  const { t } = useI18n();
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
    verifying: { testId: "email-verification-pending", icon: <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />, title: t("account.verify.pendingTitle"), body: t("account.verify.pendingBody") },
    completed: { testId: "email-verification-success", icon: <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />, title: t("account.verify.completedTitle"), body: t("account.verify.completedBody") },
    invalid: { testId: "email-verification-invalid", icon: <CircleAlert className="h-6 w-6 text-warning" aria-hidden />, title: t("account.verify.invalidTitle"), body: t("account.verify.invalidBody") },
    "session-failed": { testId: "email-verification-session-failed", icon: <CircleAlert className="h-6 w-6 text-warning" aria-hidden />, title: t("account.verify.sessionFailedTitle"), body: t("account.verify.sessionFailedBody") },
    unavailable: { testId: "email-verification-unavailable", icon: <CircleAlert className="h-6 w-6 text-destructive" aria-hidden />, title: t("account.verify.unavailableTitle"), body: t("account.verify.unavailableBody") },
  }[state];

  return (
    <AuthShell testId={content.testId} icon={content.icon} title={content.title}>
      <p className="text-13 text-muted-foreground" data-testid="email-verification-status">{content.body}</p>
      {(state === "completed" || state === "invalid" || state === "unavailable" || state === "session-failed") && (
        <Button asChild variant="primary" size="lg">
          <a href="/login">{state === "invalid" ? t("account.verify.resendLink") : t("account.goToLogin")}</a>
        </Button>
      )}
    </AuthShell>
  );
}
