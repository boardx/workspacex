"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { resolvePreviewState } from "@/lib/ui-state";
import { DesignLoopProvider } from "@/lib/design-loop-store";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopDraftsScreen } from "@/components/design-loop/drafts-screen";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";

/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）签核第 ① 件（UI）取材页。
 *
 * ⚠ 渲染的是**真组件**（`FeedbackDialog` / 收件箱 / 草稿 / 工作台 / 详情），本页只提供
 *   场景与一份**固定 seed**（不写 localStorage，保证每台机器截出同一张图）。它不在导航里，
 *   是取材工具，不是产品的一块屏（同 `/preview/feedback-loop` 的既有处置）。
 * ⚠ 草稿场景（UC-17.8 B1 真栈化后）**不再 seed**：草稿屏自己打 `/feedback/drafts*`，数据由
 *   `scripts/shot-feedback-design-loop.mjs` 的 `page.route` 拦截提供（同 `shot-feedback-loop.mjs`）。
 * ⚠ 收件箱场景（UC-17.8 B3.4 真栈化后）**同样不再 seed**：收件箱屏自己打
 *   `/inbox`、`/inbox/counts`，数据由 `scripts/shot-feedback-design-loop.mjs` 的
 *   `page.route` 拦截提供。
 * ⚠ 工作台/详情场景（UC-17.8 B4.5 真栈化后）**也不再 seed**：两屏改打
 *   `designWorkbench` 契约的 `/pm-designs*`，取材页这块的 `page.route` 拦截尚未补
 *   （backlog B4.6，独立后续），本页暂时仍挂 `DesignLoopProvider` 只是因为收件箱场景
 *   还读它的 `deepenFeedback` mock（`inbox-screen.tsx`，B4.4 才切真栈，不在本次范围）。
 *   `seed.projects` 从 B4.5 起对工作台/详情两屏不再有任何效果。
 *
 * scene 见下方 switch；state 走 `?state=`（七态）。
 */
export default function FeedbackDesignLoopPreview() {
  return (
    <React.Suspense fallback={null}>
      <PreviewBody />
    </React.Suspense>
  );
}

function PreviewBody() {
  const sp = useSearchParams();
  const scene = sp?.get("scene") ?? "inbox-board";
  const state = resolvePreviewState(sp?.get("state") ?? undefined);

  // 固定 seed（seed 存在即不持久化），空态场景注入空集合。收件箱不再是这份 seed 的一部分
  // （B3.4 真栈化）——`inbox-empty` 场景改由 `page.route` 拦 `/inbox` 回空 `items`。
  const emptyInbox = scene === "inbox-empty";
  const emptyProjects = scene === "workbench-empty";
  const seed = emptyProjects ? { projects: [] } : {};

  const shownState = emptyInbox || emptyProjects ? "empty" : state;

  return (
    <DesignLoopProvider seed={seed}>
      <FeedbackProvider>
        <div data-testid="feedback-design-loop-preview" className="min-h-dvh bg-card">
          <Scene scene={scene} state={shownState} />
        </div>
      </FeedbackProvider>
    </DesignLoopProvider>
  );
}

function Scene({ scene, state }: { scene: string; state: ReturnType<typeof resolvePreviewState> }) {
  const [detailId, setDetailId] = React.useState<string | null>(null);

  if (scene === "dialog") {
    return (
      <div className="min-h-dvh bg-background p-6">
        {/* 取材：存草稿成功后不导航，留在弹层上把「已存草稿」回执拍下来。 */}
        <FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} onDraftSaved={() => undefined} />
      </div>
    );
  }

  if (scene === "drafts" || scene === "drafts-empty") {
    // 空态由路由拦截回空 `items` 得到（数据驱动），不靠 state。
    return (
      <div className="h-dvh">
        <DesignLoopDraftsScreen state={state} onNewDraft={() => undefined} onSubmitted={() => undefined} />
      </div>
    );
  }

  if (scene.startsWith("inbox")) {
    return (
      <div className="h-dvh pt-14">
        <DesignLoopInboxScreen state={state} onDeepen={() => undefined} onOpenWorkbench={() => undefined} />
      </div>
    );
  }

  if (scene === "detail" || scene === "detail-spec") {
    // 详情用第一个项目做样本；本组件自带 dark 全屏。
    return <DetailByFirstProject preselectSpec={scene === "detail-spec"} />;
  }

  if (scene.startsWith("workbench")) {
    return (
      <div className="h-dvh">
        {detailId ? (
          <DesignDetailScreen projectId={detailId} onBack={() => setDetailId(null)} onOpenInbox={() => undefined} onNextDesign={() => setDetailId(null)} />
        ) : (
          <DesignWorkbenchHome state={state} onOpenProject={(id) => setDetailId(id)} />
        )}
      </div>
    );
  }

  return <p className="p-6 text-13 text-muted-foreground">未知场景：{scene}</p>;
}

function DetailByFirstProject({ preselectSpec }: { preselectSpec: boolean }) {
  const [ready, setReady] = React.useState<string | null>(null);
  // store 通过 context 已经有种子，取第一个项目 id。用 DOM 无法拿，改用一个已知种子 id。
  React.useEffect(() => {
    setReady("proj-empty-states");
  }, []);
  void preselectSpec;
  if (ready === null) return null;
  return <DesignDetailScreen projectId={ready} onBack={() => undefined} onOpenInbox={() => undefined} onNextDesign={() => undefined} />;
}
