"use client";

/**
 * 画布围栏**流式重放**（#3866 R4 的取证页）。
 *
 * 为什么要有这一页：「边生成边显示」是一个只在时间轴上才成立的断言。jsdom 测试能钉住
 * 「半截内容已经开始渲染」「未闭合不判错」这两条判据，但**看不见**它长出来好不好看、
 * 会不会闪、骨架先出现还是内容先出现。这一页按真实速率把一条围栏重放一遍，
 * 让人（和我）用眼睛核对。
 *
 * 纯前端，不接后端：文本是写死的，速率按本地版 4B 实测的约 30 tok/s。
 * `?speed=` 可以调快看整体，`?closed=1` 直接看终态。
 */

import * as React from "react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

const DIAGRAM = [
  "画一张流程给你：",
  "",
  "```mermaid",
  "graph TD",
  "  A[收到询价] --> B{有现成报价吗}",
  "  B -->|有| C[直接回复]",
  "  B -->|没有| D[向供应商询价]",
  "  D --> E[汇总比价]",
  "  E --> C",
  "```",
  "",
  "要我把比价那一步展开吗？",
].join("\n");

const FENCE = [
  "这就为你整理一张商业模式画布：",
  "",
  "```canvas",
  "模板: bmc",
  "## 客户细分",
  "- 中小制造企业的采购负责人",
  "- 需要多方比价的项目型客户",
  "## 价值主张",
  "- 把三天的比价压缩到一小时",
  "- 报价口径统一，便于横向对比",
  "## 渠道通路",
  "- 行业展会直销",
  "- 存量客户转介绍",
  "## 客户关系",
  "- 专属顾问跟进",
  "## 收入来源",
  "- 按成交额抽佣",
  "- 年费制会员",
  "## 核心资源",
  "- 供应商报价库",
  "## 关键业务",
  "- 询价撮合",
  "## 重要伙伴",
  "- 区域代理商",
  "## 成本结构",
  "- 供应商拓展与维护",
  "```",
  "",
  "需要我把其中某一格展开讲讲吗？",
].join("\n");

export default function CanvasStreamingPreviewPage() {
  const [kind, setKind] = React.useState<"canvas" | "mermaid">("canvas");
  const text = kind === "canvas" ? FENCE : DIAGRAM;
  const [n, setN] = React.useState(0);
  const [running, setRunning] = React.useState(true);
  const [elapsed, setElapsed] = React.useState(0);
  const startedAt = React.useRef<number | null>(null);
  const reset = React.useCallback(() => { setN(0); setElapsed(0); startedAt.current = null; setRunning(true); }, []);

  React.useEffect(() => {
    if (!running || n >= text.length) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const t = window.setTimeout(() => {
      setN((v) => Math.min(text.length, v + 1));
      setElapsed(Date.now() - (startedAt.current ?? Date.now()));
    }, 33);                                  // ≈30 tok/s，与本地版 4B 实测速率同量级

  return () => window.clearTimeout(t);
  }, [running, n, text]);


  return (
    <main className="min-h-screen bg-background p-6 text-background-foreground">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-11 font-medium text-muted-foreground">围栏流式重放（mock，不接后端）</span>
        {(["canvas", "mermaid"] as const).map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`canvas-streaming-kind-${k}`}
            data-active={kind === k}
            onClick={() => { setKind(k); reset(); }}
            className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-base ${
              kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            {k === "canvas" ? "画布" : "流程图"}
          </button>
        ))}
        <button
          type="button"
          data-testid="canvas-streaming-toggle"
          onClick={() => setRunning((v) => !v)}
          className="rounded-full border border-border px-2.5 py-1 text-11 transition-colors duration-base hover:bg-muted"
        >
          {running ? "暂停" : "继续"}
        </button>
        <button
          type="button"
          data-testid="canvas-streaming-reset"
          onClick={reset}
          className="rounded-full border border-border px-2.5 py-1 text-11 transition-colors duration-base hover:bg-muted"
        >
          重放
        </button>
        <button
          type="button"
          data-testid="canvas-streaming-finish"
          onClick={() => { setN(text.length); setRunning(false); }}
          className="rounded-full border border-border px-2.5 py-1 text-11 transition-colors duration-base hover:bg-muted"
        >
          直接到终态
        </button>
        <span data-testid="canvas-streaming-clock" className="text-11 tabular-nums text-muted-foreground">
          {(elapsed / 1000).toFixed(1)}s · {n}/{text.length} 字
        </span>
      </div>
      <div className="max-w-3xl rounded-lg border border-border bg-card p-4">
        <MarkdownMessage text={text.slice(0, n)} />
      </div>
    </main>
  );
}
