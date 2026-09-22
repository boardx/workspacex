"use client";

/**
 * 组织切换的三段体感：**走之前知道代价 → 走的路上有反应 → 落地知道到了哪。**
 *
 * 现状（本文件出现之前）：点一下组织名，菜单关上，整个界面的唯一变化是
 * 角落里那个 32px 组织头像变成 `opacity-60` + `cursor-wait`——而此刻用户的视线
 * 在页面上，页面内容还是旧组织的，没有一个字说「正在切换」。切完被
 * `router.replace("/projects")` 扔到项目页，同样没有一个字说「已经切过来了」。
 *
 * ## 为什么在途任务是「告知」而不是「拦截」
 * run 由服务端队列驱动（`AgentRunExecutor.kick` + stale 回收），换页**不会**打断它们。
 * 所以这里说的是「会跑完、回到哪能看到」，不是「可能丢失」。把真话说清楚，
 * 用户自己决定走不走；弹一个吓人的「确定要离开吗」是拿不准确的措辞换一次点击。
 */

import * as React from "react";

import { describeRunsLeftBehind } from "@/lib/org-switch";

export interface PendingOrgSwitch {
  readonly orgId: string;
  readonly toLabel: string;
  readonly fromLabel: string;
  readonly runsInFlight: number;
}

/** 走之前：有在途任务时先说清去向，没有就不打断（`shouldConfirm` 为 false）。 */
export function shouldConfirmOrgSwitch(runsInFlight: number): boolean {
  return runsInFlight > 0;
}

export function OrgSwitchConfirm({
  pending, onConfirm, onCancel,
}: {
  pending: PendingOrgSwitch;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const note = describeRunsLeftBehind(pending.runsInFlight, pending.fromLabel);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-switch-confirm-title"
      data-testid="org-switch-confirm"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg">
        <h2 id="org-switch-confirm-title" className="text-16 font-semibold">
          切换到「{pending.toLabel}」
        </h2>
        {note !== null && (
          <p data-testid="org-switch-runs-note" className="mt-2 text-13 leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="org-switch-cancel"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-13 hover:bg-muted"
          >
            留在这里
          </button>
          <button
            type="button"
            data-testid="org-switch-confirm-go"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-13 font-medium text-primary-foreground hover:bg-primary/90"
          >
            切换
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 走的路上：`switchCurrentOrganization` 是一次真实的网络往返，本地版在忙的时候
 * 能到好几百毫秒。这一层把那段空窗填成「正在切换到 X」，盖住的是**旧组织的页面内容**
 * ——切换途中让上一个组织的数据继续大大方方显示，本身就是误导。
 * 它不带关闭按钮：此刻没有「取消」可言，给一个假的退出口比没有更糟。
 */
export function OrgSwitchProgress({ toLabel }: { toLabel: string }) {
  return (
    <div
      data-testid="org-switch-progress"
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm"
    >
      <div
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary"
      />
      <p className="text-14 text-foreground">正在切换到「{toLabel}」…</p>
    </div>
  );
}

/**
 * 落地：一条会自己消失的确认。**不是 toast 系统**——本仓没有 toast，
 * 为一句确认引入一套全局通知栈是把范围放大到不需要的地方。
 */
export function OrgSwitchLanded({
  toLabel, runsLeftBehind, fromLabel, onDismiss,
}: {
  toLabel: string;
  runsLeftBehind: number;
  fromLabel: string;
  onDismiss: () => void;
}) {
  React.useEffect(() => {
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);
  const note = describeRunsLeftBehind(runsLeftBehind, fromLabel);
  return (
    <div
      data-testid="org-switch-landed"
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed bottom-4 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg"
    >
      <p className="text-13 font-medium">已切换到「{toLabel}」</p>
      {note !== null && (
        <p data-testid="org-switch-landed-note" className="mt-1 text-12 leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
      <button
        type="button"
        aria-label="关闭切换提示"
        data-testid="org-switch-landed-dismiss"
        onClick={onDismiss}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}
