/**
 * 2026-09-27 人类反馈「用户提了问题以后，下方有一个空白的 gap」。
 *
 * 实测（本地真栈 + 真实模型，DOM 量出来的，不是推的）：用户气泡与执行轨迹之间，每一步
 * "只调工具、不说话"的 assistant 消息都留下一个空壳——正文是空的 markdown 容器，工具调用
 * 又已由执行轨迹承载（`V2ToolCallsView` 在 `RunTraceCoveredContext` 为真时返回 null），
 * 可消息外壳照样占一格。一轮 20 次工具调用就叠出一屏空白。
 *
 * 钉住：这种消息整条不进 DOM。配对的正面用例钉住"不许滑向什么都藏"——有正文、有待决策的
 * 工具卡、没被轨迹承载的工具分组，都照常显示。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage, isInvisibleToolOnlyMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { RunTraceCoveredContext } from "@/lib/chat-workbench/trace-context";

function toolCall(id: string, name: string) {
  return { id, type: "function" as const, function: { name, arguments: "{}" } };
}

function renderMessage(content: string, toolCalls: ReturnType<typeof toolCall>[], covered: boolean) {
  const message = { id: "view-1", role: "assistant" as const, content, toolCalls };
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <RunTraceCoveredContext.Provider value={covered}>
        <div data-testid="host">
          <V2AssistantMessage message={message as any} messages={[message] as any} isRunning={false} />
        </div>
      </RunTraceCoveredContext.Provider>
    </CopilotKit>,
  );
}

describe("只调工具、不说话的消息不留空壳", () => {
  it("正文为空 + 工具已由执行轨迹承载：整条消息不进 DOM", () => {
    renderMessage("", [toolCall("c1", "web_search"), toolCall("c2", "read_file")], true);
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("只有空白字符的正文也算空", () => {
    renderMessage("  \n", [toolCall("c1", "web_search")], true);
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("计划写入（由计划账本承载）即使没有执行轨迹也不留空壳", () => {
    renderMessage("", [toolCall("c1", "write_todos")], false);
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("过程旁白（边说边调工具、已由执行轨迹承载）不进正文——人类：「不要把细节给用户看」", () => {
    renderMessage("PPT文件已生成，现在进行渲染验证。", [toolCall("c1", "execute")], true);
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("配对：回答本身（没有工具调用）照常渲染", () => {
    renderMessage("已生成《设计思维的历史》PPT，共 13 页。", [], true);
    expect(screen.getByTestId("copilot-assistant-message")).toBeInTheDocument();
  });

  it("配对：回答与计划更新同条出现时照常渲染", () => {
    renderMessage("已生成 PPT。", [toolCall("c1", "write_todos")], true);
    expect(screen.getByTestId("copilot-assistant-message")).toBeInTheDocument();
  });

  it("配对：没有执行轨迹时，旁白照常显示（否则过程就无处可看）", () => {
    renderMessage("正在检索资料。", [toolCall("c1", "web_search")], false);
    expect(screen.getByTestId("copilot-assistant-message")).toBeInTheDocument();
  });

  it("配对：没有执行轨迹承载时，工具分组照常可见", () => {
    renderMessage("", [toolCall("c1", "web_search")], false);
    expect(screen.getByTestId("copilotkit-v2-tool-calls-group")).toBeInTheDocument();
  });

  it("配对：待决策的工具（会画确认卡）不算不可见", () => {
    expect(isInvisibleToolOnlyMessage({ toolCalls: [toolCall("c1", "confirm_task_intent")] }, "", true)).toBe(false);
    expect(isInvisibleToolOnlyMessage({ toolCalls: [toolCall("c1", "call_skill")] }, "", true)).toBe(false);
  });

  it("配对：既无正文也无工具调用（流式刚开始）不在这条规则里", () => {
    expect(isInvisibleToolOnlyMessage({ toolCalls: [] }, "", true)).toBe(false);
  });
});
