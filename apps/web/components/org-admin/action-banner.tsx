"use client";

import * as React from "react";

/**
 * 操作结果 banner 的**单一事实源**（PR #896 第二轮复核缺陷 A 的收敛产物）。
 *
 * 此前「成功/失败提示条」在团队标签页和邀请标签页各自维护一份 state + 自动收起
 * timer + 渲染 markup，而「提交前清掉上一次 banner」散落在各表单里——邀请表单修了、
 * 团队表单又犯（同屏假绿第二次复发）。按 AGENTS.md「同一事实不得声明在两处」收敛：
 *
 * - `useActionBanner`：banner state + 自动收起 + `reset`，一处声明。
 * - `ActionBanner`：成功绿 / 失败红的渲染 markup，一处声明。
 * - **纪律**：任何往这个 banner 写结果的表单，其 submit handler 必须在
 *   `e.preventDefault()` 之后、任何校验之前调用 `reset()`——否则「绿色成功条 +
 *   红色字段错误」会同屏（假绿）。这条纪律由机械测试钉住：
 *   `tests/ui/org-admin-banner-reset.test.tsx` 对**每一个**接入的表单都做
 *   「成功 → 立刻失败 → 绿条必须已消失」的反证。新表单接入时必须在那里加一条。
 */
export type ActionBannerState = { tone: "success" | "error"; text: string } | null;

export function useActionBanner(autoHideMs: number): {
  banner: ActionBannerState;
  showSuccess: (text: string) => void;
  showError: (text: string) => void;
  reset: () => void;
} {
  const [banner, setBanner] = React.useState<ActionBannerState>(null);

  React.useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), autoHideMs);
    return () => clearTimeout(t);
  }, [banner, autoHideMs]);

  return {
    banner,
    showSuccess: React.useCallback((text: string) => setBanner({ tone: "success", text }), []),
    showError: React.useCallback((text: string) => setBanner({ tone: "error", text }), []),
    reset: React.useCallback(() => setBanner(null), []),
  };
}

export function ActionBanner({ banner, testid }: { banner: ActionBannerState; testid: string }) {
  if (!banner) return null;
  return (
    <div
      role={banner.tone === "error" ? "alert" : "status"}
      data-testid={testid}
      className={
        banner.tone === "success"
          ? "rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success"
          : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-11 text-destructive"
      }
    >
      {banner.text}
    </div>
  );
}
