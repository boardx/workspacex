"use client";
import * as React from "react";

/**
 * 「每 10 秒 + 窗口重新获得焦点时各刷一次，失败静默、下一轮再试、不并发」——
 * 这条节奏原先长在 `TaskNotifications` 里（对话列表保鲜与通知轮询同一节奏）。
 *
 * issue #3246 把铃铛搬去了左侧图标栏，而对话列表保鲜属于聊天外壳，两者不再同居
 * 一个组件。抽成这一个 hook，而不是在两处各写一份同样的 effect——同一事实不得
 * 声明在两处（AGENTS.md 硬约束）。
 */
export function useIntervalFocusRefresh(onRefresh: (() => void | Promise<void>) | undefined, intervalMs = 10_000): void {
  const ref = React.useRef(onRefresh);
  ref.current = onRefresh;
  React.useEffect(() => {
    let busy = false;
    const poll = async () => {
      if (busy || !ref.current) return;
      busy = true;
      try { await ref.current(); } catch { /* 下一轮再试 */ } finally { busy = false; }
    };
    const timer = setInterval(() => void poll(), intervalMs);
    const focus = () => void poll();
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [intervalMs]);
}
