"use client";
import * as React from "react";
import { resolveDiagramType } from "@/lib/mermaid-diagram-type";

/**
 * 单个 ```mermaid 围栏的内联渲染（VZ-01）。
 *
 * 三条出口，无静默丢弃、无崩溃：
 * · 图类型**在**白名单（`@repo/contracts` MermaidDiagramType）→ mermaid.render() 出内联 SVG。
 * · 图类型**不在**白名单 → 诚实错误态（不支持的图类型 + 原始围栏源）。
 * · 在白名单但 mermaid.render() 抛错（语法错误）→ 同一错误态（语法错误 + 原始围栏源）。
 *
 * mermaid 是重依赖、且只在客户端可用 —— 动态 import，SSR 不触碰。
 */
export function MermaidDiagram({ code }: { code: string }) {
  const { rawToken, inWhitelist } = React.useMemo(() => resolveDiagramType(code), [code]);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ reason: "whitelist" | "syntax"; detail: string } | null>(
    null,
  );
  const idRef = React.useRef(`mmd-${Math.random().toString(36).slice(2, 10)}`);

  React.useEffect(() => {
    let alive = true;
    if (!inWhitelist) {
      setSvg(null);
      setError({ reason: "whitelist", detail: rawToken || "（空）" });
      return;
    }
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        // parse 先行：语法错误在这里抛，避免 render 往 DOM 注错误块
        await mermaid.parse(code);
        const { svg: out } = await mermaid.render(idRef.current, code);
        if (!alive) return;
        setError(null);
        setSvg(out);
      } catch (e) {
        if (!alive) return;
        setSvg(null);
        setError({ reason: "syntax", detail: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, inWhitelist, rawToken]);

  if (error) {
    return (
      <div
        data-testid="chat-ai-mermaid-error"
        data-error-reason={error.reason}
        className="my-2 overflow-hidden rounded-md border border-destructive/40 bg-destructive/5"
      >
        <div className="flex items-center gap-1.5 border-b border-destructive/30 px-2.5 py-1.5 text-11 font-medium text-destructive">
          无法渲染此图（
          {error.reason === "whitelist" ? `不支持的图类型：${error.detail}` : "语法错误"}）
        </div>
        <pre className="overflow-x-auto px-2.5 py-2 font-mono text-11 leading-relaxed text-muted-foreground">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        data-testid="chat-ai-mermaid-loading"
        className="my-2 rounded-md border border-border-subtle bg-card px-2.5 py-3 text-11 text-muted-foreground"
      >
        渲染图中…
      </div>
    );
  }

  return (
    <div
      data-testid="chat-ai-mermaid"
      data-diagram-type={rawToken}
      className="my-2 overflow-x-auto rounded-md border border-border-subtle bg-card p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      // mermaid.render 已在 securityLevel:'strict' 下清洗输出，这里内联受信 SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
