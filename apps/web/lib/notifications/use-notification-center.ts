"use client";
import * as React from "react";
import { operations, type Notification } from "@repo/contracts/notifications";
import { apiRequest } from "@/lib/api-client";
const EMPTY: Notification[] = [];
/**
 * 全局通知中心（contracts/notifications.ts）的前端读端。服务端是唯一事实源：任何模块
 * publish 进去的通知（任务完成/失败/暂停、邮件、系统消息）都从这一个接口读出来；
 * 前端只轮询 + 标已读，不再自己对比列表快照猜"有没有新事"。
 */
export function useNotificationCenter(sessionToken: string | null | undefined, options?: { pollMs?: number }) {
  const pollMs = options?.pollMs ?? 10000;
  const [state, setState] = React.useState<{ token: string; items: Notification[]; unreadCount: number; failed: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const generation = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (!sessionToken) return;
    const mine = ++generation.current;
    try {
      const result = operations.list.out.parse(await apiRequest<unknown>(operations.list.path, { sessionToken, signal: AbortSignal.timeout(10000) }));
      if (generation.current === mine) setState({ token: sessionToken, items: result.notifications, unreadCount: result.unreadCount, failed: false });
    } catch {
      if (generation.current === mine) setState((previous) => ({ token: sessionToken, items: previous?.token === sessionToken ? previous.items : EMPTY, unreadCount: previous?.token === sessionToken ? previous.unreadCount : 0, failed: true }));
    }
  }, [sessionToken]);
  React.useEffect(() => {
    if (!sessionToken) return;
    const counter = generation;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    // 卸载/换 token 时把代数推一格，让还在飞的旧请求落地时被忽略。
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); counter.current++; };
  }, [sessionToken, pollMs, refresh]);
  const markRead = React.useCallback(async (ids?: string[]) => {
    if (!sessionToken) return;
    setBusy(true);
    try {
      operations.markRead.out.parse(await apiRequest<unknown>(operations.markRead.path, { method: "POST", body: ids?.length ? { ids } : {}, sessionToken }));
      const readAt = new Date().toISOString();
      setState((previous) => previous?.token === sessionToken ? {
        ...previous,
        items: previous.items.map((item) => item.readAt === null && (!ids || ids.includes(item.id)) ? { ...item, readAt } : item),
        unreadCount: ids ? Math.max(0, previous.unreadCount - previous.items.filter((item) => item.readAt === null && ids.includes(item.id)).length) : 0,
        failed: false,
      } : previous);
    } catch {
      setState((previous) => previous?.token === sessionToken ? { ...previous, failed: true } : previous);
    } finally { setBusy(false); }
  }, [sessionToken]);
  const visible = state?.token === sessionToken && sessionToken ? state : null;
  return { items: visible?.items ?? EMPTY, unreadCount: visible?.unreadCount ?? 0, failed: visible?.failed ?? false, busy, refresh, markRead };
}
