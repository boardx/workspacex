"use client";
/**
 * 深度 S6（#3988）—— 编辑器里直接看这份原型的 **React 代码**。
 *
 * 在这之前代码只有一条路：导出 → 下载一个 .tsx → 打开文件。想看一眼「这个按钮导出来长什么样」都要下一次，
 * 改一处再下一次。这里把同一份代码摆在右栏：随项目重算（画布上改了字，面板跟着变），一键复制。
 *
 * 代码只有一个来源：`exportPrototypeReactTsx`——「导出 → React 组件」下载的也是它，两处不会各算各的。
 */
import * as React from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import type { DesignProject } from "@/lib/live-design-workbench";
import { exportPrototypeReactTsx } from "@/lib/prototype-react-export-icons";
import { describeFailure } from "@/lib/design-failure";

type Status = { kind: "loading" } | { kind: "ready"; text: string } | { kind: "failed"; message: string };

export function PrototypeCodePanel({ project }: { readonly project: DesignProject }) {
  const [status, setStatus] = React.useState<Status>({ kind: "loading" });
  const [copied, setCopied] = React.useState<"ok" | "failed" | null>(null);

  React.useEffect(() => {
    let alive = true;
    setCopied(null); // 复制的是上一版：设计一变，「已复制」就不再真
    exportPrototypeReactTsx(project, new Date()).then(
      (text) => { if (alive) setStatus({ kind: "ready", text }); },
      (err: unknown) => { if (alive) setStatus({ kind: "failed", message: describeFailure(err) }); },
    );
    return () => { alive = false; };
  }, [project]);

  const copy = async () => {
    if (status.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(status.text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border" aria-label="React 代码">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-11 font-medium text-card-foreground">React 代码</span>
        <button
          type="button" onClick={() => void copy()} disabled={status.kind !== "ready"}
          data-testid="design-code-copy"
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:bg-disabled disabled:text-disabled-foreground"
        >
          {copied === "ok" ? <Check aria-hidden className="h-3 w-3" /> : <Copy aria-hidden className="h-3 w-3" />}
          {copied === "ok" ? "已复制" : "复制"}
        </button>
      </div>
      {copied === "failed" && (
        <p role="alert" className="px-3 pb-2 text-11 text-destructive">没能写进剪贴板（浏览器没给权限）。可以在下面选中代码手动复制。</p>
      )}
      {status.kind === "loading" && (
        <p className="flex items-center gap-1 px-3 pb-2 text-11 text-muted-foreground"><Loader2 aria-hidden className="h-3 w-3 animate-spin" /> 正在生成代码…</p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="px-3 pb-2 text-11 text-destructive">代码没能生成（{status.message}）</p>
      )}
      {status.kind === "ready" && (
        <pre
          data-testid="design-code-panel" tabIndex={0}
          className="min-h-0 flex-1 overflow-auto whitespace-pre bg-background/60 px-3 py-2 font-mono text-10 leading-snug text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {status.text}
        </pre>
      )}
    </section>
  );
}
