"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { ChatDiagramFabric } from "./chat-diagram-fabric";

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

export function MarkdownMessage({
  text, threadId, messageId, bearer, projectId,
}: {
  text: string;
  /**
   * VZ-fabric 真实保存接线：图「最大化→编辑→保存」时要挂一个真实 canvas artifact 需要
   * `threadId`/`messageId`/`bearer` 三者俱全。**调用方按消息来源自行决定传不传**——
   * 已落库的最终消息（有稳定 `message.id`）该传；流式草稿（还没有稳定 id）不该传，
   * 传了也没有真实消息可挂，`ChatDiagramCanvasModal` 会在缺失时退回本地演示，不会崩，
   * 但不传更诚实（不会先短暂出现「可保存」态又在草稿定型后行为跳变）。
   */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  /** G1 读回（design-delta chat-persona-roundtrip）判权用；个人线程缺省即不读回。 */
  projectId?: string;
}) {
  const segments = React.useMemo(() => segment(text), [text]);
  return (
    <div
      data-testid="chat-ai-markdown"
      className="chat-markdown text-13 text-card-foreground"
    >
      {segments.map((s) =>
        s.kind === "mermaid" ? (
          <ChatDiagramFabric
            key={s.key}
            code={s.code}
            threadId={threadId}
            messageId={messageId}
            bearer={bearer}
            projectId={projectId}
          />
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
