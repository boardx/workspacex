"use client";
import { useEffect } from "react";
import { useSession } from "@/components/session/session-provider";
import { parseLocalSessionHash } from "@/lib/local-session-handoff";
import { sanitizeReturnTo } from "@/lib/return-to";

/**
 * 桌面版免登录入口（见 `lib/local-session-handoff.ts` 头注）：登录页挂载时若 URL fragment 带着
 * 桌面主进程签发好的会话，就走与表单登录完全相同的 `startSession` → 文档级跳转。
 * 没有 fragment 时什么都不做，浏览器里打开登录页行为不变。
 */
export function LocalSessionHandoff({ next }: { next?: string }) {
  const session = useSession();
  useEffect(() => {
    const login = parseLocalSessionHash(window.location.hash);
    if (!login) return;
    // Drop the fragment first so a reload / back never replays the handoff.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void session.startSession(login).then(() => {
      window.location.assign(sanitizeReturnTo(next));
    }).catch(() => undefined); // failure = fall through to the normal login form
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);
  return null;
}
