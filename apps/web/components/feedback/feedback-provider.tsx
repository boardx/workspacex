"use client";
import * as React from "react";
import type { FeedbackTarget } from "@/lib/live-feedback";
import { FeedbackDialog } from "./feedback-dialog";

/**
 * FB-2 —— 反馈弹层的**唯一实例**，挂在壳层（`app-shell.tsx`）。
 *
 * ## 为什么是一个 context 而不是「每个按钮自带一个弹层」
 *
 * 反馈入口有三处（导航图标栏 / <md 顶栏 / chat 里每个 agent·skill 一个按钮），
 * 而 chat 那一处的数量随线程内容变化——每个按钮自带弹层意味着一个线程里可能挂着
 * 十几个隐藏的 dialog 节点，且「同时打开两个」变成一个需要防的状态。
 * 一个实例 + 一个 `openFeedback(target, label)` 让入口数量与弹层数量脱钩。
 *
 * ## 为什么 `useFeedback()` 在没有 Provider 时**抛错**而不是返回 no-op
 *
 * 返回 no-op 会让「按钮在，点了什么都不发生」变成一个可能的产品状态——
 * 而本束第一条纪律就是不许留那种按钮。抛错让它在开发期第一次点击时就炸。
 * 需要「可能没有 Provider」的调用点用 `useOptionalFeedback()`，那是显式的选择。
 */

export interface FeedbackOpenRequest {
  readonly target: FeedbackTarget;
  /** 目标的显示名。产品级传 null；agent/skill 传当时看到的名字，弹层原样显示 */
  readonly targetLabel: string | null;
}

interface FeedbackContextValue {
  openFeedback(request: FeedbackOpenRequest): void;
}

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue {
  const ctx = React.useContext(FeedbackContext);
  if (ctx === null) {
    throw new Error("useFeedback 需要 FeedbackProvider —— 没有它的话反馈按钮点了不会有任何反应");
  }
  return ctx;
}

/** 给「壳层之外也可能被渲染」的组件用（如原型页里的独立面板）。 */
export function useOptionalFeedback(): FeedbackContextValue | null {
  return React.useContext(FeedbackContext);
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<FeedbackOpenRequest | null>(null);

  const value = React.useMemo<FeedbackContextValue>(
    () => ({ openFeedback: (request) => setOpen(request) }),
    [],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {open !== null && (
        <FeedbackDialog
          target={open.target}
          targetLabel={open.targetLabel}
          onClose={() => setOpen(null)}
        />
      )}
    </FeedbackContext.Provider>
  );
}
