"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { ChatCodeFence } from "./chat-code-fence";

/**
 * 「一段 markdown 文本 → HTML」这件事在本仓的**唯一**实现。
 *
 * ## 为什么它从 `markdown-message.tsx` 里抽了出来（issue #3387 ②）
 *
 * assistant 正文（`MarkdownMessage`）除了渲 markdown，还要把 ```mermaid / ```canvas /
 * ```persona 围栏抽出来交给 fabric 渲成图——那条链路拖着 `@repo/fabric-markdown`
 * （进而是 `fabric` + `mermaid`）。**执行过程里的「Thinking · 进展摘要」不需要那一层**：
 * 它是模型写的一段说明文字，不该在折叠区里挂起画布编辑器。
 *
 * 而且那条依赖链在 Next 的 bundler 之外根本走不通：`@repo/fabric-markdown` 的
 * `exports` 只声明了 `types` / `import` 两个条件，e2e 的几何夹具
 * （`e2e/fixtures/*.tsx`，`node --import tsx` 直跑 SSR）走的是 CJS require 解析，
 * 会当场 `ERR_PACKAGE_PATH_NOT_EXPORTED`。把 `MarkdownMessage` 整个拽进
 * `run-trace-panel.tsx` 实测就把 `chat-trace-*-geometry.spec.ts` 三条全打红了。
 *
 * 所以这里抽的是**共用的那一层**，不是复制第二份：`MarkdownMessage` 的 markdown 段
 * 与本组件用的是同一份 remark-gfm + rehype-sanitize + `ChatCodeFence`。围栏渲图那一层
 * 留在 `MarkdownMessage` 自己身上——它本来就只有 assistant 正文需要。
 *
 * 安全：markdown 来自 AI/人类输入，一律走 `rehype-sanitize` 清洗（raw HTML、script、
 * on* 属性、javascript: 链接一律剥除），与 assistant 正文同一道闸。
 */
const MARKDOWN_COMPONENTS = { pre: ChatCodeFence } as const;

export function MarkdownProse({ text }: { text: string }): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      // 普通围栏代码块默认折叠（见 chat-code-fence.tsx）；行内 code 不经过 pre。
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}

/** `MarkdownProse` + assistant 正文同款的排版容器。`testId` 由调用方给。 */
export function MarkdownProseBlock(
  { text, testId }: { text: string; testId: string },
): React.ReactElement {
  return (
    <div data-testid={testId} className="chat-markdown text-13 text-card-foreground">
      <MarkdownProse text={text} />
    </div>
  );
}
