"use client";

import * as React from "react";
import { CopilotChatUserMessage } from "@copilotkit/react-core/v2";

/**
 * issue #2787（review #2787 结论，回指 issue #728 同类根因）—— `userMessage` slot
 * 此前完全没有本仓自己的替换实现：`copilotkit-v2-panel-body.tsx` 只给
 * `CopilotChatMessageView` 接了 `assistantMessage={V2AssistantMessage}`
 * （`copilotkit-v2-assistant-message.tsx`），`userMessage` 一直是
 * `@copilotkit/react-core/v2` 框架自带的默认实现。
 *
 * 框架默认 `CopilotChatUserMessage.MessageRenderer`（读编译产物
 * `dist/copilotkit-nRjRp2_5.mjs` 确认）正文容器的 className 是
 * `cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%]
 * cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3
 * cpk:inline-block cpk:whitespace-pre-wrap`——**没有任何字号工具类**，字号本应
 * 完全来自框架自带 Tailwind v4 编译产物 `@copilotkit/react-core/v2/index.css`
 * 里 `cpk:prose` 的基准字号。而这份 CSS 被 `next.config.mjs` 的
 * `NormalModuleReplacementPlugin` 整体替换成空文件（DA-19 决策：那时
 * `assistantMessage`/`reasoningMessage` 都还没有真实内容需要它，见
 * `app/chat/copilotkit-v2/layout.tsx:12-24`），`cpk:*` 类因此在浏览器里没有
 * 任何对应规则，正文回落到浏览器/`<body>` 默认字号——不在 `lib/font-scale.ts`
 * 的档位序列里，`lint-design.sh` §1.2 的 `text-<数字>` 扫描也扫不到第三方包
 * JSX 里的类名，两层门禁都盖不到这条路径。
 *
 * 气泡外壳（背景/圆角/内边距）本身不受影响——`app/chat/copilotkit-v2/
 * copilotkit-v2.css` 已经绕过失效的 `cpk:*` 类，直接锚定框架输出的稳定
 * `data-testid="copilot-user-message"` 补了一套气泡样式（`bg-secondary` +
 * 圆角 + `padding`）；本文件不重复这一层，只补正文本身缺失的字号/文字色。
 *
 * 修法与 `copilotkit-v2-assistant-message.tsx` 的 `V2AssistantMessage` 同一条
 * 思路——`assistantMessage` slot 早已经过 `V2AssistantMessage` 换成本仓
 * `MarkdownMessage`（`chat-markdown text-13 text-card-foreground` 容器），
 * 这里让 `userMessage` 也接一个本仓自己的 `messageRenderer`，取同一档
 * `text-13`（`lib/font-scale.ts` 唯一事实源），与 AI 侧正文同一字号，只是
 * 文字色换成气泡底色 `--secondary` 配对的 `--secondary-foreground`（与
 * `components/ui/button.tsx` 的 `secondary` 变体同一组语义 token 配对，不是
 * 新造一组）。
 *
 * 不重写整个 `CopilotChatUserMessage`：复制/编辑/分支切换等其余部分继续用
 * 框架自带实现，本组件只换 `messageRenderer` 这一个子 slot——与
 * `V2AssistantMessage` 只换 `markdownRenderer`/`copyButton`/`toolCallsView`
 * 等指定子 slot、不另起一套气泡外壳，是同一条纪律。
 */
function V2UserMessageRenderer({
  content,
}: React.ComponentProps<typeof CopilotChatUserMessage.MessageRenderer>): JSX.Element {
  return (
    <div data-testid="chat-user-message-text" className="whitespace-pre-wrap text-13 text-secondary-foreground">
      {content}
    </div>
  );
}

function V2UserMessageImpl(
  props: React.ComponentProps<typeof CopilotChatUserMessage>,
): JSX.Element {
  return <CopilotChatUserMessage {...props} messageRenderer={V2UserMessageRenderer} />;
}

/**
 * slot 的静态类型是 `SlotValue<typeof CopilotChatUserMessage>`——同
 * `V2AssistantMessage` 头注一致的理由：`Object.assign` 把框架那份命名空间
 * （`.Container`/`.MessageRenderer`/`.Toolbar`/…）原样搬到包装组件上，不用
 * `as` 断言糊过去，运行期真的去读 `.MessageRenderer` 等子组件的调用点才不会
 * 拿到 `undefined`。
 */
export const V2UserMessage = Object.assign(
  V2UserMessageImpl,
  CopilotChatUserMessage,
) as typeof CopilotChatUserMessage;
