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
import { fireEvent, render, screen } from "@testing-library/react";

// 见 `copilotkit-v2-panel-markdown.test.tsx` 同一段头注——`@copilotkit/react-core/
// dist/v2/index.mjs` 顶层无条件 `import "./index.css"`，vitest 走 Vite/esbuild 管线，
// 与 `next.config.mjs` 的 webpack 别名替换互不生效，这里单独在 vitest 里 mock 掉。
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { CopilotChatMessageView, CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import { V2UserMessage } from "@/components/chat/copilotkit-v2-user-message";
import { onRememberStatement } from "@/lib/knowledge-graph-events";
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

/**
 * issue #4179（F17 手动入口 ①）—— 消息旁「记住这句」只挂在 `userMessage` slot（`V2UserMessage`），
 * `assistantMessage` slot 是完全不同的组件（`V2AssistantMessage`），从不引用这个按钮——AI 回答旁
 * 天然不出现它，不是靠运行期身份判断做到的。见 `copilotkit-v2-message-actions.tsx`
 * `CopilotKitV2RememberMessageButton` 的文件头注。
 */
describe("issue #4179 —— 消息旁「记住这句」：只在用户自己发的消息上出现，点击不直接写入", () => {
  it("用户消息上有「记住这句」；AI 消息（框架默认 assistantMessage）上没有", async () => {
    const messages: Message[] = [
      { id: "m-user", role: "user", content: "下周一（9/29）上线 v2" },
      { id: "m-ai", role: "assistant", content: "好的，我记下了。" },
    ];
    render(
      withCopilotKit(
        <CopilotChatMessageView messages={messages} isRunning={false} userMessage={V2UserMessage} />,
      ),
    );

    await screen.findByTestId("chat-user-message-text");
    const rememberButtons = screen.getAllByTestId("chat-message-remember");
    // 只有一条用户消息 ⇒ 只有一个入口；AI 那条完全没有对应按钮。
    expect(rememberButtons).toHaveLength(1);
  });

  it("点击「记住这句」⇒ 只发出请求（`requestRememberStatement`），不直接写入任何东西", async () => {
    const messages: Message[] = [{ id: "m-user", role: "user", content: "客户A的对接人是王经理" }];
    render(
      withCopilotKit(
        <CopilotChatMessageView messages={messages} isRunning={false} userMessage={V2UserMessage} />,
      ),
    );

    const received: string[] = [];
    const unsubscribe = onRememberStatement((statement) => received.push(statement));
    try {
      fireEvent.click(await screen.findByTestId("chat-message-remember"));
      expect(received).toEqual(["客户A的对接人是王经理"]);
    } finally {
      unsubscribe();
    }
    // 这里只断言「请求被发出」，不断言任何 claim 被确认——真正执行（送进 `send()`、
    // 出确认卡）由 `copilotkit-v2-panel-body.tsx` 订阅完成，是另一层集成，不在这个
    // 组件测试的范围内（同文件头注：本测试只钉 slot 接线）。
  });

  it("消息正文为空白 ⇒ 不渲染「记住这句」（没有内容可记）", async () => {
    const messages: Message[] = [{ id: "m-empty", role: "user", content: "   " }];
    render(
      withCopilotKit(
        <CopilotChatMessageView messages={messages} isRunning={false} userMessage={V2UserMessage} />,
      ),
    );
    await screen.findByTestId("chat-user-message-text");
    expect(screen.queryByTestId("chat-message-remember")).not.toBeInTheDocument();
  });
});
