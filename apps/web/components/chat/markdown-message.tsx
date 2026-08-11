"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { MermaidDiagram } from "./mermaid-diagram";

/**
 * AI 消息正文渲染（VZ-01）：把 `msg.text`（纯 markdown 源）渲成 HTML，
 * 并把 ```mermaid 围栏抽出、内联渲成图。
 *
 * 安全：markdown 来自 AI/人类输入，走 `rehype-sanitize` 清洗，杜绝注入型 XSS
 *   （raw HTML、script、on* 属性、javascript: 链接一律剥除）。mermaid 另走
 *   `MermaidDiagram` 的 securityLevel:'strict'。
 *
 * 切段：用 `@repo/fabric-markdown` 的 DOM-free 抽取器 `extractMermaidBlocks`
 *   （唯一围栏抽取实现，不另写一份）拿到每个 mermaid 围栏的 [start,end)，
 *   据此把整段 text 切成「markdown 文本段 / mermaid 图」交替序列。
 */

type Segment =
  | { kind: "md"; text: string; key: string }
  | { kind: "mermaid"; code: string; key: string };

function segment(text: string): Segment[] {
  const blocks = extractMermaidBlocks(text).filter((b) => b.lang === "mermaid");
  if (blocks.length === 0) return [{ kind: "md", text, key: "md-0" }];
  const out: Segment[] = [];
  let cursor = 0;
  blocks.forEach((b, i) => {
    if (b.start > cursor) {
      const chunk = text.slice(cursor, b.start);
      if (chunk.trim().length > 0) out.push({ kind: "md", text: chunk, key: `md-${i}` });
    }
    out.push({ kind: "mermaid", code: b.code, key: `mmd-${i}` });
    cursor = b.end;
  });
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail.trim().length > 0) out.push({ kind: "md", text: tail, key: "md-tail" });
  }
  return out;
}

export function MarkdownMessage({ text }: { text: string }) {
  const segments = React.useMemo(() => segment(text), [text]);
  return (
    <div
      data-testid="chat-ai-markdown"
      className="chat-markdown text-13 text-card-foreground"
    >
      {segments.map((s) =>
        s.kind === "mermaid" ? (
          <MermaidDiagram key={s.key} code={s.code} />
        ) : (
          <ReactMarkdown
            key={s.key}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
          >
            {s.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
