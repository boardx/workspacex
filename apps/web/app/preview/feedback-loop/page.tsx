"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { FeedbackScreen } from "@/components/admin/feedback-screen";

/**
 * `feedback-loop` 束的签核第 ① 件（UI）取材页。
 *
 * ## 它为什么存在
 *
 * ADR-023 的第 ① 件是**截图**，而 `scripts/shot-feedback-loop.mjs` 需要一个
 * 能稳定进入各个场景的地址。生产里这三块屏分别要求：登录态、一个有 AI 消息的线程、
 * 组织管理员身份——拿它们拍截图，等于把签核材料的可复现性绑在一套种子数据上。
 *
 * ## ⚠ 它渲染的是**真组件**，不是复刻
 *
 * `FeedbackDialog` / `FeedbackButton` / `FeedbackScreen` 都是生产同一份实现。
 * 本页只提供**场景**（哪个 tab、哪个目标），数据由 `page.route()` 在截图时
 * 拦截 feedback 路由提供——所以截出来的屏与生产的差别只有数据，没有代码。
 *
 * 复刻一遍界面来拍照是本仓最不该犯的错：签核签的是照片，上线的是另一份代码。
 *
 * ⚠ 本页**不在导航里**，也不该进。它是取材工具，不是产品的一块屏
 * （`lint-nav-reachability` 的反向判定会点名任何进了导航却不属于任何束的路由）。
 */
export default function FeedbackLoopPreviewPage() {
  return (
    <React.Suspense fallback={null}>
      <PreviewBody />
    </React.Suspense>
  );
}

function PreviewBody() {
  const scene = useSearchParams()?.get("scene") ?? "entries";

  if (scene === "dialog-product" || scene === "dialog-skill") {
    return (
      <FeedbackProvider>
        <div data-testid="feedback-loop-preview" className="min-h-dvh bg-background p-6">
          <FeedbackDialog
            target={scene === "dialog-skill" ? { kind: "skill", skillId: "skill-meeting-notes" } : { kind: "product" }}
            targetLabel={scene === "dialog-skill" ? "会议纪要" : null}
            onClose={() => undefined}
          />
        </div>
      </FeedbackProvider>
    );
  }

  if (scene === "admin") {
    return (
      <div data-testid="feedback-loop-preview" className="min-h-dvh bg-card">
        <FeedbackScreen state="default" />
      </div>
    );
  }

  // scene = entries：三个入口并排，说明「反馈按钮长在哪」。
  return (
    <FeedbackProvider>
      <div data-testid="feedback-loop-preview" className="flex min-h-dvh gap-6 bg-background p-6">
        {/* ① 图标栏最下方的常驻入口（D2） */}
        <div className="flex w-rail min-w-rail flex-col items-center rounded-md border border-border bg-rail py-3.5">
          <span className="mb-auto text-9 uppercase tracking-wide text-muted-foreground">图标栏</span>
          <FeedbackButton target={{ kind: "product" }} targetLabel={null} variant="rail" />
        </div>

        <div className="flex flex-1 flex-col gap-5">
          {/* ② chat 消息头上的 agent 反馈按钮 */}
          <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
            <h2 className="text-11 font-medium text-muted-foreground">chat · AI 消息身份行</h2>
            <div className="group flex items-start gap-2.5">
              <div aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                🤖
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                  <span className="font-medium text-card-foreground">调研助手</span>
                  <span>10:24</span>
                  <FeedbackButton
                    target={{ kind: "agent", agentId: "agent-research" }}
                    targetLabel="调研助手"
                    testid="preview-chat-agent-feedback"
                    className="visible"
                  />
                </div>
                <p className="text-12">我把三份访谈稿的共同主题整理成了下面五条……</p>
              </div>
            </div>
          </section>

          {/* ③ 会话内已挂载 skill 的 chip 上的反馈按钮 */}
          <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
            <h2 className="text-11 font-medium text-muted-foreground">chat · 本会话已挂载的 skill</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-11">skill-meeting-notes</span>
                <FeedbackButton
                  target={{ kind: "skill", skillId: "skill-meeting-notes" }}
                  targetLabel="会议纪要"
                  testid="preview-chat-skill-feedback"
                />
              </span>
            </div>
          </section>
        </div>
      </div>
    </FeedbackProvider>
  );
}
