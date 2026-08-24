/**
 * DA-19b 消息渲染迁移 —— 钉住 `copilotkit-v2-panel.tsx` 的
 * `assistantMessage.markdownRenderer` slot 接线：CopilotKit v2 官方消息列表组件
 * （`CopilotChatMessageView`/`CopilotChatAssistantMessage`，真实框架代码，未 mock）
 * 收到一条 assistant 消息时，正文真的经本仓生产 `MarkdownMessage`（markdown 解析 +
 * mermaid 围栏路由）渲染，而不是 CopilotKit 自带的纯 `Streamdown` markdown（不认
 * mermaid 围栏、不接本仓「落地为产物」体系）。
 *
 * ⚠ 为什么是组件测试，不是这个任务唯一的证据来源——真实浏览器 e2e
 * （`e2e/copilotkit-v2-runtime-adapter.spec.ts` 新增的 "DA-19b markdown/mermaid
 * 消息渲染" 场景）才是端到端证据；但截至本次改动，`apps/api` 在这台机器 / 这个
 * SHA 上因预先存在的依赖问题（issue #1979，`@langchain/langgraph-checkpoint` 撞
 * `./utils/uuid` exports 错误，与本次改动无关，`git log` 可查该 bug 早于 DA-19b）
 * 无法启动，`playwright.chat-read.config.ts` 的 webServer 起不来，那条 e2e 场景
 * 现在跑不了。这个组件测试是在 #1979 修复前唯一能真实验证「slot 接线对不对」的
 * 手段——`ChatDiagramFabric` 真实渲染依赖 fabric 建 canvas 的浏览器能力，jsdom 里
 * 连 `data-ready` 都产不出（`chat-diagram-save-gate.test.tsx` 头注已记录同一限制），
 * 这里同样把它 mock 成一个只回显收到的 `code` 的探针——够钉住「mermaid 围栏被正确
 * 抽出并路由到 fabric 分支」，不追真实 SVG/canvas 产出。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * `@copilotkit/react-core/dist/v2/index.mjs` 顶层无条件 `import "./index.css"`
 * （Tailwind v4 编译产物）——`next.config.mjs` 用 webpack 别名把它换成一份空文件
 * （DA-19 头注），但那份配置只在 webpack 构建里生效，vitest 走自己的 Vite/esbuild
 * 管线，两边配置不共用。这里直接把这个具体解析出的 CSS 模块 mock 成空 side-effect
 * 模块——`require.resolve(...)` 拿到与运行时完全一致的绝对路径（pnpm 虚拟 store
 * 里那个带 hash 的目录名，不写死猜测值），不影响 Next 的 webpack 管线本身，只解决
 * vitest 这一条路径里的 CSS 扩展名问题。
 *
 * `vi.mock`/`vi.hoisted` 调用被 vitest 的转换整体提到**所有** import 语句之前
 * （踩过一次：改成 `import { createRequire } from "node:module"` 再在
 * `vi.hoisted()` 里用它，报 `Cannot access '__vi_import_2__' before initialization`
 * ——import 绑定本身也在提升范围之外）。改用 vitest/CJS 测试环境里全局可用的
 * `require`，不经过任何 ESM import 绑定。
 */
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const chatDiagramFabricCalls: Array<{ code: string }> = [];
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => {
    chatDiagramFabricCalls.push({ code: props.code });
    return <div data-testid="chat-diagram-fabric-probe">{props.code}</div>;
  },
}));

import { CopilotChatMessageView, CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import type { Message } from "@copilotkit/react-core/v2";

// `copilotkit-v2-panel.tsx` 里的 `V2MarkdownRenderer` 不是导出的符号（模块私有，
// 见该文件"只用其中的 content"一段头注）——组件本身极薄（一行透传），这里按同一份
// 签名在测试里重建，与生产代码保持逐行一致而不是 import 私有实现，理由：
// `CopilotChatAssistantMessage.MarkdownRenderer` 的类型本身就是这条 slot 的唯一
// 契约，测试要钉的是"这个类型签名的组件、真的把 content 转给 MarkdownMessage"这件
// 事本身，不是钉哪个变量名导出与否。
function V2MarkdownRenderer({ content }: { content: string }): JSX.Element {
  return <MarkdownMessage text={content} />;
}

const MARKDOWN_AND_MERMAID = [
  "## 分析结果",
  "",
  "1. **第一点**：`pnpm harness verify`",
  "",
  "```mermaid",
  "flowchart TD",
  "  A --> B",
  "```",
  "",
  "> 引用块。",
].join("\n");

/**
 * `CopilotChatMessageView` 内部（`useRenderCustomMessages`）无条件调用
 * `useCopilotKit()`——文档说这个 hook"在没有 chat 配置 provider 时返回 null"，但
 * 那说的是 `CopilotChatConfigurationProvider`；`useCopilotKit()` 本身要求最外层
 * 真的有 `<CopilotKit>`（不是 headless 场景下可以跳过的可选项），本轮实测直接
 * 抛 `useCopilotKit must be used within CopilotKitProvider`，不包这层组件测试
 * 连挂载都做不到。`<CopilotKit>` 挂载会异步打一次 `GET {runtimeUrl}/info`
 * 探测 agent 目录（`AgentRegistry.performRuntimeConnection`）——jsdom 环境没有
 * 真实网络出口，这次探测必然失败，控制台会打印一条 `Failed to load runtime info`
 * 与 `Agent default not found`；这是真实框架代码的真实（且预期内、无害的）副作用，
 * 不是本测试引入的噪音，不影响下面这两个断言：本测试要证的是"消息列表里已经存在
 * 的这条 assistant 消息，正文怎么被渲染出来"，不依赖这次探测是否成功。
 */
function withCopilotKit(children: React.ReactNode): JSX.Element {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotChatConfigurationProvider agentId="default" threadId="t">
        {children}
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}

describe("CopilotKitV2Panel 的 markdownRenderer slot —— 走 MarkdownMessage，不是 CopilotKit 自带 Streamdown", () => {
  it("assistant 消息经 CopilotChatMessageView 渲染：markdown 结构 + mermaid 围栏路由到 ChatDiagramFabric", async () => {
    chatDiagramFabricCalls.length = 0;
    const messages: Message[] = [{ id: "m-ai", role: "assistant", content: MARKDOWN_AND_MERMAID }];
    render(
      withCopilotKit(
        <CopilotChatMessageView
          messages={messages}
          isRunning={false}
          assistantMessage={{ markdownRenderer: V2MarkdownRenderer }}
        />,
      ),
    );

    // ── 反证① 走的是 MarkdownMessage 的容器，不是 CopilotKit 默认 Streamdown 容器 ──
    const md = await screen.findByTestId("chat-ai-markdown");
    // ── 反证② markdown 结构真的被解析成真实 DOM 节点，不是原始语法字符串 ──
    expect(md.querySelector("h2")?.textContent).toContain("分析结果");
    expect(md.querySelector("code")?.textContent).toContain("pnpm harness verify");
    expect(md.querySelector("blockquote")?.textContent).toContain("引用块");

    // ── 反证③ ```mermaid 围栏被 MarkdownMessage 的 segment() 抽走，路由进
    // ChatDiagramFabric（探针收到解析出的纯图源码），不是原样留在 markdown 分支
    // 里当灰底代码块显示 ──
    expect(chatDiagramFabricCalls).toHaveLength(1);
    expect(chatDiagramFabricCalls[0]!.code.trim()).toBe("flowchart TD\n  A --> B");
    expect(await screen.findByTestId("chat-diagram-fabric-probe")).toBeInTheDocument();
    // 围栏源码不该再落进 markdown 分支自己的 `<pre>`（react-markdown 渲染围栏代码块
    // 的标准标签）——它只应该出现在上面已断言过的 fabric 探针里，那是"抽走喂给
    // ChatDiagramFabric"这件事本身的证据，不是"两处都有、其实没抽走"的假阳性。
    expect(md.querySelectorAll("pre")).toHaveLength(0);
  });

  it("user 消息不经这个 slot（slot 只挂在 assistantMessage 上）", async () => {
    chatDiagramFabricCalls.length = 0;
    const messages: Message[] = [{ id: "m-h", role: "user", content: "**这不该被加粗**" }];
    render(
      withCopilotKit(
        <CopilotChatMessageView
          messages={messages}
          isRunning={false}
          assistantMessage={{ markdownRenderer: V2MarkdownRenderer }}
        />,
      ),
    );
    expect(await screen.findByText("**这不该被加粗**")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-ai-markdown")).toBeNull();
    expect(chatDiagramFabricCalls).toHaveLength(0);
  });
});
