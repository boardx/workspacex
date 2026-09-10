"use client";
import { useRouter } from "next/navigation";
import type { UiState } from "@/lib/ui-state";
import { useFeedback } from "@/components/feedback/feedback-provider";
import { DesignLoopDraftsScreen } from "./drafts-screen";

/**
 * 反馈草稿——面向全体终端用户的顶层入口（issue #3339）。
 *
 * 背景：草稿的 API/契约本就是「owner 私有」（`packages/contracts/src/feedback-loop.ts`
 * 头注「反馈草稿（提交人私有）」），后端从未有 admin-only 门控——`ownerId` 恒取
 * `principal.userId`。此前唯一挡住普通用户的是**菜单归属**：入口只挂在
 * `/platform-admin/feedback-drafts`（`apps/web/lib/mock/admin.ts` 的 platform scope）。
 *
 * 做法照搬 `/studio/design-workbench` 的既有先例（2026-09-05 人类裁决，见
 * `studio-workbench-screen.tsx` 头注）：底层复用同一个真栈组件
 * `DesignLoopDraftsScreen`（与平台后台 `FeedbackDraftsScreen` 完全相同的组件），
 * 只是这里不套 `AdminNav`、跳转目标换成本路由前缀——两个入口独立，互不下线。
 * 提交后的收件箱跳转沿用平台后台收件箱（当前唯一的反馈收件箱落点）。
 */
export function StudioFeedbackDraftsScreen({ state }: { state: UiState }) {
  const router = useRouter();
  const feedback = useFeedback();
  return (
    <DesignLoopDraftsScreen
      state={state}
      onNewDraft={() => feedback.openFeedback({ target: { kind: "product" }, targetLabel: null })}
      onSubmitted={(feedbackId) => router.push(`/platform-admin/inbox?open=${encodeURIComponent(feedbackId)}`)}
    />
  );
}
