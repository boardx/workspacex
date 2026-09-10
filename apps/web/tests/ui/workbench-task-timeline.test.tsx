import * as React from "react";
import { z } from "zod";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const cssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(cssPath, () => ({}));
import { CopilotKit, useRenderTool } from "@copilotkit/react-core/v2";
import { TaskTimeline, resolveTraceAnchors } from "@/components/chat/workbench/task-timeline";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
const base = { runId: "run-a", emittedAt: "2026-09-07T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 0, kind: "text_delta", messageId: "progress", delta: "先列出资料" },
  { ...base, seq: 1, kind: "tool_start", toolCallId: "call-1", toolName: "list_org_skills", args: {} },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "call-1", toolName: "list_org_skills", result: "已列出", ok: true },
  { ...base, seq: 3, kind: "text_delta", messageId: "answer", delta: "最终结论" },
  { ...base, seq: 4, kind: "final_message", messageId: "answer" },
];
function DecisionRenderer() {
  useRenderTool({ name: "confirm_task_intent", parameters: z.object({}), render: () => <button type="button">确认任务</button> });
  return null;
}
describe("framework task timeline", () => {
  it("groups multiple assistant messages once, hides progress from answer and reuses registered tool cards", () => {
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[
        { id: "user", role: "user", content: "开始" },
        { id: "progress", role: "assistant", content: "先列出资料" },
        { id: "answer", role: "assistant", content: "最终结论" },
      ]} messageRuns={{ progress: "run-a", answer: "run-a" }} events={{ "run-a": events }} isRunning={false} />
    </CopilotKit>);
    expect(screen.getAllByTestId("run-trace-panel")).toHaveLength(1);
    expect(screen.getByText("最终结论")).toBeVisible();
    expect(screen.getByText("先列出资料", { exact: false })).not.toBeVisible();
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByText("先列出资料", { exact: false })).toBeVisible();
    const toolRow = screen.getByTestId("chat-task-workbench-event-row");
    // issue #3316 ②：折叠行必须说出工具真名。原断言写的是它的反面。
    expect(toolRow).toHaveTextContent("已执行 · list_org_skills");
    fireEvent.click(toolRow);
    expect(screen.getByTestId("copilotkit-v2-tool-generic")).toBeVisible();
  });
  it("keeps a registered decision renderer visible outside a collapsed trace", () => {
    const decisionEvents: ExecutionEvent[] = [{ ...base, seq: 0, kind: "tool_start", toolCallId: "decision", toolName: "confirm_task_intent", args: {} }];
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <DecisionRenderer />
      <TaskTimeline messages={[{ id: "decision-message", role: "assistant", content: "", toolCalls: [{ id: "decision", type: "function", function: { name: "confirm_task_intent", arguments: "{}" } }] }]}
        messageRuns={{ "decision-message": "run-a" }} events={{ "run-a": decisionEvents }} isRunning />
    </CopilotKit>);
    expect(screen.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "确认任务" })).toBeVisible();
  });

  it("keeps write_todos audit rows but never projects journal snapshots as duplicate plan cards", () => {
    const planEvents: ExecutionEvent[] = [
      { ...base, seq: 0, kind: "tool_start", toolCallId: "plan-1", toolName: "write_todos", args: { todos: [{ content: "旧计划", status: "pending" }] } },
      { ...base, seq: 1, kind: "tool_end", toolCallId: "plan-1", toolName: "write_todos", result: "ok", ok: true },
      { ...base, seq: 2, kind: "tool_start", toolCallId: "plan-2", toolName: "write_todos", args: { todos: [{ content: "新计划", status: "in_progress" }] } },
      { ...base, seq: 3, kind: "tool_end", toolCallId: "plan-2", toolName: "write_todos", result: "ok", ok: true },
      { ...base, seq: 4, kind: "tool_start", toolCallId: "search-1", toolName: "search_documents", args: { query: "资料" } },
      { ...base, seq: 5, kind: "tool_end", toolCallId: "search-1", toolName: "search_documents", result: "找到资料", ok: true },
    ];
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[{ id: "answer", role: "assistant", content: "处理中" }]}
        messageRuns={{ answer: "run-a" }} events={{ "run-a": planEvents }} isRunning />
    </CopilotKit>);

    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    const planRows = screen.getAllByTestId("chat-task-workbench-event-row");
    expect(planRows.filter((row) => row.textContent === "已执行 · 制定执行计划")).toHaveLength(2);
    expect(planRows.some((row) => row.textContent?.includes("write_todos"))).toBe(false);
    expect(screen.queryByTestId("copilotkit-v2-tool-write-todos")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("已执行 · 检索文档"));
    expect(screen.getByTestId("copilotkit-v2-tool-search-documents")).toBeVisible();
  });

  /**
   * 矩阵 D1（DA-19c）在 CI 上稳定红的那一幕，在组件层原样复现。
   *
   * 真实 wire 上 `TOOL_CALL_START` 不带 `parentMessageId`，`@ag-ui/client` 0.0.57 因此
   * **新造**一条 assistant 消息、把 `toolCallId` 当成它的 id（`{ id: toolCallId,
   * role: "assistant", toolCalls: [] }`）。上面三条既有用例都手写 `messages`，从来没有
   * 出现过这条合成消息——这就是「单测全绿、浏览器里锚点不出现」的那道层间缝。
   *
   * 两个方向各断一次，缺陷与修复因此都在这一层可见：
   * · 没绑到 run（改动前 `use-run-trace` 的真实状态）⇒ 卡片落在 legacy
   *   `copilotkit-v2-tool-calls-group` 里、**祖先没有 `run-trace-panel`**——
   *   与 CI 首错逐字同形。
   * · 绑到了 run（改动后）⇒ legacy 分组消失，卡片落在 `run-trace-panel` 里面。
   */
  it("renders the client-minted tool-call message inside the run trace once it is bound to the run", () => {
    const toolCallId = "tool-call-42";
    const searchEvents: ExecutionEvent[] = [
      { ...base, seq: 0, kind: "tool_start", toolCallId: "search-1", toolName: "search_documents", args: { query: "取证：请展示多步执行" } },
      { ...base, seq: 1, kind: "tool_end", toolCallId: "search-1", toolName: "search_documents", result: "找到资料", ok: true },
    ];
    // `@ag-ui/client` 造出来的那条消息：id 就是 toolCallId，content 为空，只挂着 toolCalls。
    const minted = {
      id: toolCallId, role: "assistant" as const, content: "",
      toolCalls: [{ id: toolCallId, type: "function" as const, function: { name: "search_documents", arguments: JSON.stringify({ query: "取证：请展示多步执行" }) } }],
    };

    const unbound = render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[minted]} messageRuns={{}} events={{ "run-a": searchEvents }} isRunning />
    </CopilotKit>);
    const legacyCard = unbound.container.querySelector('[data-testid="copilotkit-v2-tool-search-documents"]');
    expect(legacyCard, "未绑定 run 时定制卡片仍然渲染——CI 上它确实挂上了").not.toBeNull();
    expect(unbound.container.querySelector('[data-testid="copilotkit-v2-tool-calls-group"]')).not.toBeNull();
    expect(legacyCard!.closest('[data-testid="run-trace-panel"]'), "这正是 CI 首错：卡片不在任何 run-trace-panel 里").toBeNull();
    unbound.unmount();

    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[minted]} messageRuns={{ [toolCallId]: "run-a" }} events={{ "run-a": searchEvents }} isRunning />
    </CopilotKit>);
    expect(screen.queryByTestId("copilotkit-v2-tool-calls-group"), "绑上 run 之后不许再出现第二份 legacy 分组").not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    fireEvent.click(screen.getByText("已执行 · 检索文档"));
    const card = screen.getByTestId("copilotkit-v2-tool-search-documents");
    expect(card.closest('[data-testid="run-trace-panel"]')).not.toBeNull();
  });


  /**
   * D2 回归（#3168 引入，本次修复）——**执行轨迹面板的锚点跑到了线程顶部**。
   *
   * 真实 wire 上这一轮结束时会发生两件事，缺一不可：
   * ① `TOOL_CALL_START` 不带 `parentMessageId`，`@ag-ui/client` 为每次工具调用**新造**
   *    一条 assistant 气泡（id 就是 `toolCallId`）；#3168 之后这些气泡也进 `messageRuns`。
   * ② `execution-journal-relay.ts` 的 `finish()` 走「撤回 + 重发」兜底：已流出的回答正文
   *    气泡被 `assistant_message_replaced` 撤掉，再用同一个 id **追加到队尾**。
   *
   * 于是 `agent.messages` 的次序变成 [用户, 合成气泡×N, 工具结果×N, 回答正文]，
   * 而面板锚点取的是「第一条绑到本 run 的 assistant 消息」——从队尾的回答正文
   * 变成了队首的合成气泡。面板于是从回答上方跳到用户提问正下方。
   *
   * 下面用 `finish()` 之后的真实次序，两个方向各断一次：
   * · 不排除合成气泡（= #3168 的行为）⇒ 锚点是 `tool-wt`，面板排在三条工具气泡**之前**；
   * · 排除合成气泡（= 本次修法）⇒ 锚点回到 `answer`，面板紧挨回答正文之前。
   */
  it("anchors the run trace above the answer bubble, never on a client-minted tool-call bubble", () => {
    const toolIds = ["tool-wt", "tool-sd", "tool-rd"];
    const traceEvents: ExecutionEvent[] = [
      { ...base, seq: 0, kind: "status", status: "running" },
      { ...base, seq: 1, kind: "tool_start", toolCallId: "tool-sd", toolName: "search_documents", args: { query: "取证" } },
      { ...base, seq: 2, kind: "tool_end", toolCallId: "tool-sd", toolName: "search_documents", result: "找到资料", ok: true },
    ];
    // `finish()` 之后的真实次序：合成气泡在前，回答正文被撤回后追加到队尾。
    const messages = [
      { id: "user", role: "user" as const, content: "取证：请展示多步执行" },
      ...toolIds.map((id) => ({ id, role: "assistant" as const, content: "",
        toolCalls: [{ id, type: "function" as const, function: { name: "search_documents", arguments: "{}" } }] })),
      { id: "answer", role: "assistant" as const, content: "最终结论" },
    ];
    const messageRuns = Object.fromEntries([...toolIds, "answer"].map((id) => [id, "run-a"]));

    const indexOfPanel = (toolCallMessageIds: ReadonlySet<string>) => {
      const view = render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2ToolRenderers />
        <TaskTimeline messages={messages} messageRuns={messageRuns} toolCallMessageIds={toolCallMessageIds}
          events={{ "run-a": traceEvents }} isRunning />
      </CopilotKit>);
      const list = view.container.querySelector('[data-testid="copilot-message-list"]')!;
      const children = [...list.children];
      const panels = children.filter((child) => child.getAttribute("data-testid") === "run-trace-panel");
      const panelIndex = children.findIndex((c) => c.getAttribute("data-testid") === "run-trace-panel");
      const result = { panelIndex, panelCount: panels.length,
        // 面板之后是否还剩下承载回答正文的那个块——面板必须在回答**之前**、工具气泡**之后**。
        answerIndex: children.findIndex((c) => (c.textContent ?? "").includes("最终结论")) };
      view.unmount();
      return result;
    };

    // 反证方向①：撤掉修法（合成气泡照旧参与锚点竞争）——面板被拽到用户提问正下方。
    const regressed = indexOfPanel(new Set());
    expect(regressed.panelCount, "两个方向都必须恰好一个面板，才谈得上位置").toBe(1);
    expect(regressed.panelIndex, "#3168 的行为：锚点落在第一条合成工具气泡上，面板紧跟用户消息").toBe(1);

    // 正向：排除合成气泡后，锚点回到回答正文，面板重新落在回答之前、工具气泡之后。
    const fixed = indexOfPanel(new Set(toolIds));
    expect(fixed.panelCount).toBe(1);
    expect(fixed.answerIndex, "回答正文必须真的渲染出来了，否则下面的位置断言是空转").toBeGreaterThan(0);
    expect(fixed.panelIndex, "修法后：面板排在三条合成工具气泡之后").toBe(3 + 1);
    expect(fixed.panelIndex, "且仍在回答正文之前 —— 这就是 #3168 之前的位置").toBeLessThanOrEqual(fixed.answerIndex);
    expect(fixed.panelIndex).toBeGreaterThan(regressed.panelIndex);
  });

  /**
   * 「面板挂在哪条消息下」这条事实以前被声明了两次（`TraceAssistant` 里的 `first`
   * 与 `TaskTimeline` 底部的 `displayed`），两处一分叉就是最坏情况：inline 不画、
   * fallback 又被抑制，用户一个面板都看不到。现在收敛成 `resolveTraceAnchors` 一处，
   * 这条测试锁住「抑制集合 === 锚点集合」这个不变量。
   */
  it("keeps suppression and anchoring the same single fact", () => {
    const messages = [
      { id: "user", role: "user" as const, content: "问" },
      { id: "tool-1", role: "assistant" as const, content: "" },
      { id: "answer", role: "assistant" as const, content: "答" },
      { id: "orphan", role: "assistant" as const, content: "无 run" },
    ];
    const anchors = resolveTraceAnchors(messages, { "tool-1": "run-a", answer: "run-a" }, new Set(["tool-1"]));
    expect(anchors).toEqual({ "run-a": "answer" });
    // 合成气泡是这个 run 唯一绑定时：没有锚点 ⇒ 该 run 必须由 fallback 槽兜底，不能两边都不画。
    expect(resolveTraceAnchors(messages, { "tool-1": "run-a" }, new Set(["tool-1"]))).toEqual({});
  });

});
