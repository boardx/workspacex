"use client";
import * as React from "react";

/**
 * AI 消息里的围栏代码块（```lang … ```）——**默认折叠**，用户点「显示代码」再展开。
 *
 * 动机（人类 2026-09-02 反馈）：跑 pdf / pptx / docx / xlsx 这类 skill 时，模型把生成
 * 文件用的整段脚本原样贴在回复里，几十行 `require('pdf-lib')` 把真正要看的那一句
 * 「PDF 这就生成」挤到看不见。代码是产出过程的副产品，不是给用户读的内容——默认
 * 收起，只留一行摘要（语言 + 行数）和展开/复制入口。
 *
 * 为什么做在 `pre` 这一层而不是按「是否 skill 消息」判断：
 *   围栏源码只在最终 markdown 文本里，消息上没有「这段来自哪个 skill」的稳定标记；
 *   而不管来自哪里，一段多行代码在聊天气泡里的默认形态都该是「可展开的摘要」。
 *   行内 `code`（如 `pnpm harness verify`）不经过 `pre`，不受影响。
 *
 * mermaid / canvas / persona 围栏在 `MarkdownMessage.segment` 里已经先于 markdown
 * 分支被抽走，永远到不了这里；这里只接普通语言的围栏。
 */

/** 从 react-markdown 交给 `pre` 的 children 里取出 `<code className="language-xxx">`。 */
function readCodeChild(children: React.ReactNode): { lang: string | null; text: string } {
  const child = React.Children.toArray(children)[0];
  if (!React.isValidElement(child)) return { lang: null, text: flattenText(children) };
  const props = child.props as { className?: string; children?: React.ReactNode };
  const match = /language-([\w-]+)/.exec(props.className ?? "");
  return { lang: match?.[1] ?? null, text: flattenText(props.children) };
}

function flattenText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (React.isValidElement(node)) {
    return flattenText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function countLines(text: string): number {
  const trimmed = text.replace(/\n$/, "");
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

export function ChatCodeFence({ children }: React.ComponentPropsWithoutRef<"pre">) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { lang, text } = React.useMemo(() => readCodeChild(children), [children]);
  const lines = countLines(text);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文 / 权限拒绝）：静默，按钮态不变，不弹错。
    }
  }, [text]);

  return (
    <div
      data-testid="chat-code-fence"
      data-lang={lang ?? undefined}
      data-open={open ? "true" : "false"}
      className="overflow-hidden rounded-md border border-border-subtle bg-card"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-11 text-muted-foreground">
        <span className="font-mono">{lang ?? "code"}</span>
        <span>· {lines} 行</span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="chat-code-fence-copy"
          onClick={copy}
          className="rounded-sm px-1.5 py-0.5 hover:bg-muted hover:text-card-foreground"
        >
          {copied ? "已复制" : "复制"}
        </button>
        <button
          type="button"
          data-testid="chat-code-fence-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-sm px-1.5 py-0.5 hover:bg-muted hover:text-card-foreground"
        >
          {open ? "隐藏代码" : "显示代码"}
        </button>
      </div>
      {open ? (
        <pre className="!mt-0 !rounded-none !border-0 !border-t !border-border-subtle">{children}</pre>
      ) : null}
    </div>
  );
}
