import * as React from "react";
import Link from "next/link";
import { AiMessage } from "@/components/chat/ai-message";
import { VIZ_SCENES, resolveVizScene, vizMessages } from "@/lib/mock/chat-viz";

/**
 * chat-viz（VZ-01：AI 气泡内 markdown + ```mermaid 渲染）UI 先行原型入口 ——
 * ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**（纯客户端渲染 `msg.text`）。这里做的是**签核材料**，
 *   显式标注 mock，走真实的 `AiMessage` 组件（正文已换成 `MarkdownMessage`）。
 *
 * query 参数（预览手段）：?scene= markdown | mermaid | error
 *   顶部一排场景切换链接，让人类 sign-off 时逐态点选核对。
 */
export default function ChatVizPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string };
}) {
  const scene = resolveVizScene(searchParams.scene);
  const messages = vizMessages(scene);
  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <nav
        className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
        data-testid="chat-viz-scene-nav"
      >
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {VIZ_SCENES.map((s) => {
          const active = s === scene;
          return (
            <Link
              key={s}
              href={`/preview/chat-viz?scene=${s}`}
              data-testid={`chat-viz-scene-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-200 ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {s}
            </Link>
          );
        })}
      </nav>

      <div
        className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6"
        data-testid="chat-viz-preview"
      >
        <p className="text-11 text-muted-foreground">
          VZ-01 原型 · 纯前端 mock（不接后端）· 渲染的是 AI 消息的 <code>msg.text</code>（markdown 源）
        </p>
        {messages.map((m) => (
          <AiMessage key={m.id} msg={m} />
        ))}
      </div>
    </main>
  );
}
