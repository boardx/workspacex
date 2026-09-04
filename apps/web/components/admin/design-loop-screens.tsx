"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { UiState } from "@/lib/ui-state";
import { DesignLoopProvider } from "@/lib/design-loop-store";
import { FeedbackProvider, useFeedback } from "@/components/feedback/feedback-provider";
import { DesignLoopDraftsScreen } from "@/components/design-loop/drafts-screen";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";

/**
 * UC-17.8 研发闭环 —— 平台后台三个模块的生产落点包装。
 *
 * 三块屏共享一份客户端 mock store（`DesignLoopProvider`，localStorage 持久化），所以
 * 「存草稿→草稿列表」「提交→收件箱」「深化→工作台」「推送→收件箱」在**跨路由导航**后
 * 仍一致（每个路由各自挂 Provider，从 localStorage 读同一份）。⚠ 这是 UI 先行的原型
 * mock，不是权威数据源，真栈化见 store 头注。
 */

function DraftsInner({ state }: { state: UiState }) {
  const router = useRouter();
  const feedback = useFeedback();
  return (
    <DesignLoopDraftsScreen
      state={state}
      onNewDraft={() => feedback.openFeedback({ target: { kind: "product" }, targetLabel: null })}
      onSubmitted={() => router.push("/platform-admin/inbox")}
    />
  );
}

export function FeedbackDraftsScreen({ state }: { state: UiState }) {
  return (
    <DesignLoopProvider>
      <FeedbackProvider>
        <DraftsInner state={state} />
      </FeedbackProvider>
    </DesignLoopProvider>
  );
}

export function DesignLoopInboxAdminScreen({ state }: { state: UiState }) {
  const router = useRouter();
  return (
    <DesignLoopProvider>
      <FeedbackProvider>
        <DesignLoopInboxScreen
          state={state}
          onDeepen={(projectId) => router.push(`/platform-admin/design-workbench/${projectId}`)}
          onOpenWorkbench={() => router.push("/platform-admin/design-workbench")}
        />
      </FeedbackProvider>
    </DesignLoopProvider>
  );
}

export function DesignWorkbenchAdminScreen({ state }: { state: UiState }) {
  const router = useRouter();
  return (
    <DesignLoopProvider>
      <DesignWorkbenchHome state={state} onOpenProject={(id) => router.push(`/platform-admin/design-workbench/${id}`)} />
    </DesignLoopProvider>
  );
}
