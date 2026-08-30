"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session/session-provider";
import { sanitizeReturnTo } from "@/lib/return-to";

export function LoginSessionGate({ children, next }: { children: React.ReactNode; next?: string }) {
  const router = useRouter();
  const { status } = useSession();
  // ⚠ 已带有效会话直接访问 `/login?next=…`（例如深链跳转过来又恰好还登录着）
  // 时也要回到 `next`，而不是一律落到 `/projects`——同一份净化规则见 `lib/return-to.ts`。
  const target = sanitizeReturnTo(next);

  React.useEffect(() => {
    if (status === "authenticated") router.replace(target);
  }, [router, status, target]);

  if (status === "authenticated") {
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
