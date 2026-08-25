"use client";

import * as React from "react";

/**
 * issue #2075（TW-A11Y-4）—— `/chat` 工作台的**唯一**一块 live region。
 *
 * ## 它修的是什么真实缺陷
 *
 * 2026-08-26 真栈实测：整个 `/chat` 工作台在静止状态下
 * `[aria-live], [role=status], [role=alert], [role=log]` **零命中**。
 * 也就是说 agent 开始跑、工具跑完、以及"需要你批准"这个必须由人做决定的时刻，
 * 对屏幕阅读器用户**完全静默**——他们只能反复 Tab 去探测发生了什么。
 * 「等待批准」尤其致命：不播报就等于卡死，用户不知道系统在等他。
 *
 * ## 为什么是一个模块级的小 store，而不是 React context
 *
 * 播报的**生产者**不全在同一棵 React 子树里：审批弹窗是
 * `useHumanInTheLoop({ render })` 的回调产物，由 CopilotKit 框架决定挂在哪，
 * 面板够不着它的 props（同 `copilotkit-v2-panel.tsx` 里 CK-P3 那段的处境）。
 * 用 context 就得假设那棵子树一定在 Provider 底下——一个今天成立、框架一升版
 * 就可能悄悄不成立的假设，且失效时是**静默**的（播报没了，没有任何报错）。
 * 模块级 store 对挂载位置零假设。
 *
 * ⚠ 一块 region，不是每个生产者各挂一块：多块 `aria-live` 同时更新会被读屏软件
 * 交错念，反而更听不懂；而且那就是"同一件事（当前状态）声明在多处"。
 */

let currentMessage = "";
const subscribers = new Set<() => void>();

/** 播报一句话。同一句重复播报会被忽略（读屏软件不会重复念，避免噪声）。 */
export function announceToChat(message: string): void {
  if (message === currentMessage) return;
  currentMessage = message;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/**
 * SSR 快照恒为空串：服务端没有"当前 agent 状态"这回事，
 * 拿客户端的 store 值去渲服务端会 hydration mismatch。
 */
function getServerSnapshot(): string {
  return "";
}

export function ChatLiveAnnouncer(): JSX.Element {
  const message = React.useSyncExternalStore(subscribe, () => currentMessage, getServerSnapshot);
  return (
    <p
      data-testid="chat-task-workbench-live-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      /* `sr-only` 而不是可见文本：这些话对视觉用户已经在界面上以更好的形式存在了
         （运行状态条、工具卡、审批弹窗），再印一遍是重复噪声。 */
      className="sr-only"
    >
      {message}
    </p>
  );
}
