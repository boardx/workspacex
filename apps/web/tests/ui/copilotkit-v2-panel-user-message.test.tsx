/**
 * issue #2787 —— 钉住 `copilotkit-v2-panel-body.tsx` 的 `userMessage` slot 接线：
 * CopilotKit v2 官方消息列表组件（`CopilotChatMessageView`/`CopilotChatUserMessage`，
 * 真实框架代码，未 mock）收到一条 user 消息时，正文真的经本仓 `V2UserMessage`
 * （`copilotkit-v2-user-message.tsx`）渲染出 `lib/font-scale.ts` 的 `text-13` 档位，
 * 而不是框架自带默认实现——那份默认实现的字号完全依赖已被 `next.config.mjs` 替换成
 * 空文件的框架自带 CSS（`cpk:*` 类），回落到浏览器默认字号，不在 token 序列里，也不受
 * `lint-design.sh` 保护（见 `copilotkit-v2-user-message.tsx` 文件头注的完整取证）。
 *
 * 与 `copilotkit-v2-panel-markdown.test.tsx`（钉 `assistantMessage` slot）同一条模式：
 * 真实渲染框架组件，只把它引入的第三方 CSS mock 成空 side-effect 模块。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// 见 `copilotkit-v2-panel-markdown.test.tsx` 同一段头注——`@copilotkit/react-core/
// dist/v2/index.mjs` 顶层无条件 `import "./index.css"`，vitest 走 Vite/esbuild 管线，
// 与 `next.config.mjs` 的 webpack 别名替换互不生效，这里单独在 vitest 里 mock 掉。
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { CopilotChatMessageView, CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import { V2UserMessage } from "@/components/chat/copilotkit-v2-user-message";
import type { Message } from "@copilotkit/react-core/v2";

// 见 `copilotkit-v2-panel-markdown.test.tsx` 同一段头注——`<CopilotKit>` 挂载是
// `useCopilotKit()`（`CopilotChatMessageView` 内部无条件调用）的硬要求，不是本测试
// 引入的额外包装；异步的 `GET {runtimeUrl}/info` 探测在 jsdom 里必然失败，是真实框架
// 代码的既有、无害副作用，与本测试要证的"正文怎么被渲染出来"无关。
function withCopilotKit(children: React.ReactNode): JSX.Element {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotChatConfigurationProvider agentId="default" threadId="t">
        {children}
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}

describe("CopilotKitV2PanelBody 的 userMessage slot —— 走 V2UserMessage，不是框架默认 MessageRenderer", () => {
  it("user 消息经 CopilotChatMessageView 渲染：正文容器带 text-13（lib/font-scale.ts 唯一事实源）", async () => {
    const messages: Message[] = [{ id: "m-h", role: "user", content: "你好，这是一条测试消息" }];
    render(
      withCopilotKit(
        <CopilotChatMessageView messages={messages} isRunning={false} userMessage={V2UserMessage} />,
      ),
    );

    const bubbleText = await screen.findByTestId("chat-user-message-text");
    expect(bubbleText.textContent).toBe("你好，这是一条测试消息");
    // ── 反证：真的带上了本仓字号 token，不是框架默认那个没有任何字号工具类的容器 ──
    expect(bubbleText.className).toContain("text-13");
    // 气泡外壳（背景/圆角）由 `copilotkit-v2.css` 锚定这个稳定 testid 补样式，
    // 不受本次改动影响——这里只钉正文本身。
    expect(await screen.findByTestId("copilot-user-message")).toBeInTheDocument();
  });
});
