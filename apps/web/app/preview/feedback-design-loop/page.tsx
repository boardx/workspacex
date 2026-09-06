"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { resolvePreviewState } from "@/lib/ui-state";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopDraftsScreen } from "@/components/design-loop/drafts-screen";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";

/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）签核第 ① 件（UI）取材页。
 *
 * ⚠ 渲染的是**真组件**（`FeedbackDialog` / 收件箱 / 草稿 / 工作台 / 详情），本页只负责
 *   按 `?scene=` 摆场景、按 `?state=` 传展示态——**不持有任何数据、不写 localStorage**
 *   （UC-17.8 B6.1 起原型 mock store 与本页的 seed 一并删除）。它不在导航里，是取材工具，
 *   不是产品的一块屏（同 `/preview/feedback-loop` 的既有处置）。
 * ⚠ 草稿场景（UC-17.8 B1 真栈化后）**不再 seed**：草稿屏自己打 `/feedback/drafts*`，数据由
 *   `scripts/shot-feedback-design-loop.mjs` 的 `page.route` 拦截提供（同 `shot-feedback-loop.mjs`）。
 * ⚠ 收件箱场景（UC-17.8 B3.4 真栈化后）**同样不再 seed**：收件箱屏自己打
 *   `/inbox`、`/inbox/counts`，数据由 `scripts/shot-feedback-design-loop.mjs` 的
 *   `page.route` 拦截提供。
 * ⚠ 工作台/详情场景（UC-17.8 B4.5 真栈化后）**也不再 seed**：两屏改打
 *   `designWorkbench` 契约的 `/pm-designs*`，数据由
 *   `scripts/shot-feedback-design-loop.mjs` 的 `page.route` 拦截提供（UC-17.8 B4.6 补齐，
 *   同草稿/收件箱两块在 B1/B3.4 走过的同一条路）。`workbench-empty` 场景的空态同样由
 *   `routeDesignWorkbench({ empty: true })` 让 `/pm-designs` 回空 `items` 得到——五屏的
 *   数据全部走同一条 `page.route` 范式，与 `feedback-loop` 束一致。
 * ⚠ 工作台首页的 `loading`/`denied`/`dep-failed` 三态由 `?state=` 直接驱动组件的展示分支
 *   （不发真实请求，见 `workbench-screen.tsx`）；详情页**没有** `state` prop，它的
 *   loading/dep-failed 由截图脚本让 `/pm-designs` 挂起/报错来产生真实的过渡（`?state=`
 *   在这两种场景下改用来挑选 `projectId`：`missing` → 一个不存在的 id）。
 *
 * scene 见下方 switch；state 走 `?state=`（七态，workbench 语义见上，detail 语义见
 * `DetailByFirstProject`）。
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

  // 空态场景的数据由截图脚本的 `page.route` 回空 `items` 得到（数据驱动）；这里只把展示态
  // 对齐成 `empty`，让依赖 `state` prop 的分支（工作台首页）与真实空数据一致。
  const emptyScene = scene === "inbox-empty" || scene === "workbench-empty";
  const shownState = emptyScene ? "empty" : state;

  return (
    <FeedbackProvider>
      <div data-testid="feedback-design-loop-preview" className="min-h-dvh bg-card">
        <Scene scene={scene} state={shownState} />
      </div>
    </FeedbackProvider>
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

  if (scene.startsWith("detail")) {
    // 详情用第一个项目做样本；本组件自带 dark 全屏。scene=detail-missing 时改用一个不存在的
    // id，用来拍「找不到这个设计项目」态（真实查找失败，不是摆一张静态图）——不能靠 `?state=`
    // 表达，`resolvePreviewState` 只认七态白名单，非法值静默落回 `default`（`ui-state.ts`）。
    // `detail-loading`/`detail-depfailed` 两个场景名同理不改 id，是让截图脚本挂起/拒绝
    // `/pm-designs` 来产生这两态。
    // B5.3：`detail-prototype` 用已生成原型的样本项目（夹具 `proj-chat-ui`）拍组件树画布。
    const id = scene === "detail-missing" ? "proj-does-not-exist" : scene === "detail-prototype" ? "proj-chat-ui" : "proj-empty-states";
    return <DetailByFirstProject projectId={id} />;
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

function DetailByFirstProject({ projectId }: { projectId: string }) {
  return <DesignDetailScreen projectId={projectId} onBack={() => undefined} onOpenInbox={() => undefined} onNextDesign={() => undefined} />;
}
