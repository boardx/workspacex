"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session/session-provider";

export function LoginSessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useSession();

  React.useEffect(() => {
    if (status === "authenticated") router.replace("/projects");
  }, [router, status]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div
        aria-live="polite"
        className="flex min-h-screen items-center justify-center text-13 text-muted-foreground"
        data-testid="login-session-loading"
      >
        正在检查登录状态…
      </div>
    );
  }

  return children;
}
