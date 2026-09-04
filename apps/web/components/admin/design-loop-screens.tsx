"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UiState } from "@/lib/ui-state";
import { useFeedback } from "@/components/feedback/feedback-provider";
import { DesignLoopDraftsScreen } from "@/components/design-loop/drafts-screen";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";

/**
 * UC-17.8 研发闭环 —— 平台后台三个模块的生产落点包装。
 *
 * ⚠ 这里**不再**挂 `DesignLoopProvider` / `FeedbackProvider`（D5，2026-09-04）：两者都由
 *   `components/shell/app-shell.tsx` 挂一次，三块屏在 `AppShell` 里渲染，直接消费。
 *   收件箱与设计工作台仍读 mock store（B3/B4 下个 sprint 真栈化）；草稿屏已接真栈（B1）。
 */

export function FeedbackDraftsScreen({ state }: { state: UiState }) {
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

/** `useSearchParams` 在静态生成的路由段上要有 Suspense 边界（Next 14），否则整段退化成 CSR。 */
export function DesignLoopInboxAdminScreen({ state }: { state: UiState }) {
  return (
    <React.Suspense fallback={null}>
      <InboxInner state={state} />
    </React.Suspense>
  );
}

function InboxInner({ state }: { state: UiState }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <DesignLoopInboxScreen
      state={state}
      openId={sp?.get("open") ?? null}
      onDeepen={(projectId) => router.push(`/platform-admin/design-workbench/${projectId}`)}
      onOpenWorkbench={() => router.push("/platform-admin/design-workbench")}
    />
  );
}

export function DesignWorkbenchAdminScreen({ state }: { state: UiState }) {
  const router = useRouter();
  return <DesignWorkbenchHome state={state} onOpenProject={(id) => router.push(`/platform-admin/design-workbench/${id}`)} />;
}
