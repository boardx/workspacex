/**
 * issue #2408 —— 「工具调用记录收进一个可折叠容器」的组件级回归。
 *
 * 人类实测反馈：通用助手一轮回答常伴随多次探测性工具调用（`list_org_skills`/`ls`/
 * `glob`×N/`write_file`……），此前每次调用各自渲染成一张独立 Card，纵向堆叠，把
 * 真正的回复挤到几屏之下。`copilotkit-v2-assistant-message.tsx` 的 `V2ToolCallsView`
 * 用框架 `CopilotChatAssistantMessage` 自带、此前未用过的 `toolCallsView` slot，把
 * 多次调用收进一个统一、可折叠的容器（见该文件该组件的头注）。
 *
 * ⚠ 用**真实**框架组件（`CopilotChatAssistantMessage`/`CopilotChatToolCallsView`/
 *   `useRenderTool`），未 mock——同 `copilotkit-v2-message-landing-toolbar-race.test.tsx`
 *   与 `copilotkit-v2-panel-markdown.test.tsx` 的既有纪律：钉住的是"接上框架真实
 *   slot 之后的不变量"，不是"我们自己写的一段假 UI 逻辑"。
 * ⚠ 每个工具卡片本身用**生产的** `CopilotKitV2ToolRenderers`（`write_todos` 专属卡 +
 *   wildcard 通用卡），不是测试自造的假渲染器——覆盖"已注册的 per-tool 渲染器在
 *   折叠容器内依然正确渲染"这条要求时，用的就是用户实际会看到的那份实现。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// `@copilotkit/react-core/dist/v2/index.mjs` 顶层无条件 `import "./index.css"`——
// vitest 的 Vite/esbuild 管线不认识这份 Tailwind v4 编译产物。`vi.mock`/`vi.hoisted`
// 调用被整体提到**所有** import 语句之前（同 `copilotkit-v2-panel-markdown.test.tsx`
// 头注那段教训：改成先 import 再在 `vi.hoisted()` 里用绑定会在提升范围之外报错），
// 这里同样先用 `vi.hoisted()` 拿到路径，再把其余 import 放在它之后。
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";

function toolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}

function renderMessage(toolCalls: ReturnType<typeof toolCall>[]) {
  const message = {
    id: "view-1",
    role: "assistant" as const,
    content: "已经处理完这一轮。",
    toolCalls,
  };
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      {/* 挂载点——只负责把生产环境实际使用的 per-tool 渲染器登记进框架的全局表，
          不渲染任何 DOM（见该组件自己的文档）。放在这里而不是外层 provider 之外，
          理由与生产环境（`copilotkit-v2-panel.tsx`）一致：登记时机不敏感，只要
          与消息树共享同一个 `CopilotKit` provider。 */}
      <CopilotKitV2ToolRenderers />
      <V2AssistantMessage message={message as any} messages={[message] as any} isRunning={false} />
    </CopilotKit>,
  );
}

describe("copilotkit-v2 工具调用记录收进一个可折叠容器（issue #2408）", () => {
  it("0 次工具调用：不渲染任何分组容器，也不崩溃", () => {
    renderMessage([]);
    expect(screen.queryByTestId("copilotkit-v2-tool-calls-group")).not.toBeInTheDocument();
  });

  it("1 次工具调用：不加折叠外壳，直接展示这张卡片", () => {
    renderMessage([toolCall("call-1", "list_org_skills")]);
    expect(screen.queryByTestId("copilotkit-v2-tool-calls-group")).not.toBeInTheDocument();
    expect(screen.getByTestId("copilotkit-v2-tool-generic")).toBeInTheDocument();
  });

  it("多次工具调用：收进一个分组容器，默认展开，两张卡片都可见（沿用既有 e2e 的可见性断言）", () => {
    renderMessage([
      toolCall("call-1", "list_org_skills"),
      toolCall("call-2", "write_todos", { todos: [{ content: "找字体", status: "completed" }] }),
    ]);
    const group = screen.getByTestId("copilotkit-v2-tool-calls-group");
    expect(group).toHaveAttribute("data-tool-calls-count", "2");

    const toggle = screen.getByTestId("copilotkit-v2-tool-calls-group-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const body = screen.getByTestId("copilotkit-v2-tool-calls-group-body");
    expect(body).not.toHaveAttribute("hidden");
    // `aria-controls` 必须指向真实存在于 DOM 里的那个 id——不是随手拼一个字符串。
    expect(toggle).toHaveAttribute("aria-controls", body.id);

    expect(within(body).getByTestId("copilotkit-v2-tool-generic")).toBeInTheDocument();
    expect(within(body).getByTestId("copilotkit-v2-tool-write-todos")).toBeInTheDocument();
  });

  it("点击折叠按钮（鼠标）：内容区加 hidden，但节点仍在 DOM 里，aria-expanded 翻假", () => {
    renderMessage([
      toolCall("call-1", "list_org_skills"),
      toolCall("call-2", "ls", { path: "/usr/share/fonts" }),
    ]);
    const toggle = screen.getByTestId("copilotkit-v2-tool-calls-group-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = screen.getByTestId("copilotkit-v2-tool-calls-group-body");
    // `hidden` 属性隐藏，不是整段不渲染——`aria-controls` 引用的元素必须一直存在
    // 且就是同一个节点（按 id 查找，不是按 testid——`aria-controls` 引用的是
    // DOM `id`，不是 `data-testid`）。
    expect(body).toHaveAttribute("hidden");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(body);
  });

  it("再次点击（键盘可达的原生 <button>）：折叠后可以再展开回去", () => {
    // 折叠开关是一个未做任何 role 覆盖的原生 <button type=\"button\">——浏览器原生
    // 把 Enter/Space 翻译成同一个 click 事件，键盘可达性因此不需要额外代码，
    // 这正是选原生 <button> 而不是自造一个 <div onClick> 的理由。jsdom 没有内建
    // "keydown → 合成 click" 的翻译层（那是真实浏览器 UA 行为，不是 DOM 规范本身
    // 要求 jsdom 实现的部分），所以这里用 click 事件验证"键盘激活最终触发的同一条
    // 逻辑"，而不是断言一个测试环境本来就无法真实复现的浏览器行为。
    renderMessage([
      toolCall("call-1", "list_org_skills"),
      toolCall("call-2", "ls", { path: "/usr/share/fonts" }),
    ]);
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle").tagName).toBe("BUTTON");

    const toggle = screen.getByTestId("copilotkit-v2-tool-calls-group-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group-body")).not.toHaveAttribute("hidden");
  });

  it("流式过程中工具调用数量增加：分组容器的计数与内容跟着更新，用户手动收起的状态不会被这次更新重置", () => {
    const message = {
      id: "view-1", role: "assistant" as const, content: "",
      toolCalls: [toolCall("call-1", "list_org_skills"), toolCall("call-2", "ls", { path: "/usr/share/fonts" })],
    };
    const { rerender } = render(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2ToolRenderers />
        <V2AssistantMessage message={message as any} messages={[message] as any} isRunning />
      </CopilotKit>,
    );
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group")).toHaveAttribute("data-tool-calls-count", "2");

    // 用户在这一轮还在跑的时候先手动收起。
    fireEvent.click(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle"));
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle")).toHaveAttribute("aria-expanded", "false");

    // 同一条消息又流进来一次新的工具调用（`glob`）——`V2AssistantMessage` 原地
    // 重渲染（`message.id` 不变），不是卸载重建，`V2ToolCallsView` 的
    // `useState` 因此应该保留，而不是随这次更新重新初始化为默认展开。
    const streamed = { ...message, toolCalls: [...message.toolCalls, toolCall("call-3", "glob", { pattern: "**/*.ttf" })] };
    rerender(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2ToolRenderers />
        <V2AssistantMessage message={streamed as any} messages={[streamed] as any} isRunning />
      </CopilotKit>,
    );

    const group = screen.getByTestId("copilotkit-v2-tool-calls-group");
    expect(group).toHaveAttribute("data-tool-calls-count", "3");
    // 收起状态原样保留，不因为新调用到达而被重新展开。
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group-body")).toHaveAttribute("hidden");

    // 重新展开后，新到达的第 3 次调用（`glob`）确实渲染进了同一个容器，不是被丢弃。
    fireEvent.click(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle"));
    expect(within(screen.getByTestId("copilotkit-v2-tool-calls-group-body")).getAllByTestId("copilotkit-v2-tool-generic")).toHaveLength(3);
  });

  // issue #2451 —— 真实截图抓到：模型一轮里调用了两次 write_todos（改主意/纠正
  // 上一版计划），此前每次调用各自独立渲染成一张卡片，摞在一起看不出哪张是最新的。
  it("一轮消息里 write_todos 被调用两次：更早那张淡化+贴「计划已更新」，最新那张正常展示", () => {
    renderMessage([
      toolCall("call-1", "write_todos", { todos: [{ content: "旧版第一步", status: "pending" }] }),
      toolCall("call-2", "list_org_skills"),
      toolCall("call-3", "write_todos", { todos: [{ content: "新版第一步", status: "in_progress" }] }),
    ]);

    const cards = screen.getAllByTestId("copilotkit-v2-tool-write-todos");
    expect(cards).toHaveLength(2);

    // 更早那张（call-1）被包在"已被取代"外壳里、视觉淡化，但仍然渲染在 DOM 里——
    // 不是被静默删除（同一条"不悄悄清除状态痕迹"纪律）。
    const superseded = screen.getAllByTestId("copilotkit-v2-tool-write-todos-superseded");
    expect(superseded).toHaveLength(1);
    expect(within(superseded[0]!).getByText("计划已更新")).toBeInTheDocument();
    expect(within(superseded[0]!).getByText("旧版第一步")).toBeInTheDocument();

    // 最新那张（call-3）不在任何"已被取代"外壳里。
    expect(screen.getByText("新版第一步").closest('[data-testid="copilotkit-v2-tool-write-todos-superseded"]')).toBeNull();

    // 中间那次非 write_todos 调用完全不受影响。
    expect(screen.getByTestId("copilotkit-v2-tool-generic")).toBeInTheDocument();
  });

  it("一轮消息里只调用一次 write_todos：不出现「已被取代」外壳（沿用改动前的行为）", () => {
    renderMessage([toolCall("call-1", "write_todos", { todos: [{ content: "唯一一步", status: "pending" }] })]);
    expect(screen.getByTestId("copilotkit-v2-tool-write-todos")).toBeInTheDocument();
    expect(screen.queryByTestId("copilotkit-v2-tool-write-todos-superseded")).not.toBeInTheDocument();
  });

  // 2026-09-04 人类直接反馈（真栈截图：两张内容不同的"制定执行计划"卡片同屏并存，
  // 都是完整展开态，看不出哪张是最新）—— 真实场景往往是**两条独立消息**各自只调用
  // 一次 `write_todos`（先给一版计划、下一轮收到反馈后整体重发一版），不是同一条
  // 消息里连续调用两次。上面 issue #2451 那版去重只看"当前消息自己的 toolCalls"，
  // 每条消息各自 `toolCalls.length === 1`，直接绕开了去重、两张都原样全展开——
  // 这正是这张截图里的真实缺陷。这里验证跨消息也能被同一份"全局最新" id 认出来。
  it("write_todos 分别出现在两条独立消息里：更早那条消息的卡片淡化+贴「计划已更新」，后一条正常展示", () => {
    const messageA = {
      id: "msg-a",
      role: "assistant" as const,
      content: "第一版计划如下。",
      toolCalls: [toolCall("call-1", "write_todos", { todos: [{ content: "旧版第一步", status: "pending" }] })],
    };
    const messageB = {
      id: "msg-b",
      role: "assistant" as const,
      content: "根据反馈调整后的计划如下。",
      toolCalls: [toolCall("call-2", "write_todos", { todos: [{ content: "新版第一步", status: "in_progress" }] })],
    };
    const allMessages = [messageA, messageB];
    render(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2ToolRenderers />
        <V2AssistantMessage message={messageA as any} messages={allMessages as any} isRunning={false} />
        <V2AssistantMessage message={messageB as any} messages={allMessages as any} isRunning={false} />
      </CopilotKit>,
    );

    const cards = screen.getAllByTestId("copilotkit-v2-tool-write-todos");
    expect(cards).toHaveLength(2);

    const superseded = screen.getAllByTestId("copilotkit-v2-tool-write-todos-superseded");
    expect(superseded).toHaveLength(1);
    expect(within(superseded[0]!).getByText("计划已更新")).toBeInTheDocument();
    expect(within(superseded[0]!).getByText("旧版第一步")).toBeInTheDocument();

    expect(screen.getByText("新版第一步").closest('[data-testid="copilotkit-v2-tool-write-todos-superseded"]')).toBeNull();
  });
});
