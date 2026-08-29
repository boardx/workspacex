import * as React from "react";
import Link from "next/link";
import { AgentToolChain } from "@/components/chat/agent-tool-chain";
import {
  SUMMARY_SCENES, SUMMARY_SCENE_LABEL, resolveSummaryScene,
  summarySteps, summaryResultSummaries,
} from "@/lib/mock/tool-result-summary";

/**
 * Phase 14 · 需求 2（工具执行结果结构化摘要 / 量化信息）UI 先行原型入口 —— ADR-023 签核
 * 第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**。走真实的 `AgentToolChain` 组件，吃 mock 的 `steps` +
 *   可选 `resultSummaries`。默认展开，让人类不用点就看到 per-step 卡片下的量化 chip。
 *
 * query（预览手段）：?scene= with-summary | mixed | fallback
 *   with-summary —— 读取类工具都带量化（命中 12 · 41,208 行 8.4 MB · 3 行）
 *   mixed        —— 部分带、部分回退（核对不串味）
 *   fallback     —— 完全不传摘要（现状逐字回退，证明字段缺失不报错不留白）
 */
export default function ToolSummaryPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string };
}) {
  const scene = resolveSummaryScene(searchParams.scene);
  const steps = summarySteps();
  const resultSummaries = summaryResultSummaries(scene);

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <nav
        className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
        data-testid="tool-summary-scene-nav"
      >
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {SUMMARY_SCENES.map((s) => {
          const active = s === scene;
          return (
            <Link
              key={s}
              href={`/preview/tool-summary?scene=${s}`}
              data-testid={`tool-summary-scene-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-base ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {SUMMARY_SCENE_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      <div
        className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6"
        data-testid="tool-summary-preview"
      >
        <p className="text-11 text-muted-foreground">
          需求 2 原型 · 纯前端 mock（不接后端）· 折叠面板 per-step 卡片在有
          <code>summary</code>（<code>{"{ rows?, bytes?, hits? }"}</code>）时补一行量化 chip，
          缺失时回退纯文字
        </p>

        <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card/50 p-3">
          <header className="flex items-center gap-2">
            <span className="text-11 font-medium text-primary">执行完成，回复已写入对话</span>
            <span className="text-10 text-muted-foreground">（mock 活体 run · 读取密集型任务）</span>
          </header>
          <AgentToolChain steps={steps} defaultOpen resultSummaries={resultSummaries} />
        </section>

        <p className="text-10 text-muted-foreground">
          提示：量化 chip 出现在每个 tool step 的结果文字下方（如「读日志」卡片下的
          <b> 41,208 行 · 8.4 MB</b>）。<code>fallback</code> 屏不传任何摘要——卡片与现状逐字一致，
          不报错、不留白。
        </p>
      </div>
    </main>
  );
}
