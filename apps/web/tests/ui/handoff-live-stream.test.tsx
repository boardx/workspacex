/**
 * UIUX r4（实时流，不是刷新后的 /state）：自转交被拒时
 *  ① 「没有转交」提示条按工具调用 id 只画一次（执行轨迹里不再画第二份）；
 *  ② 工具结果一到，前导语「正在提交转交请求。」就从气泡里消失。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2MessageActionsProvider } from "@/components/chat/copilotkit-v2-message-actions";
import { HandoffRefusalNotice, useSingleNoticeOwner } from "@/components/chat/copilotkit-v2-tool-renderers";
import { renderExecutionTool } from "@/components/chat/workbench/task-timeline";
import { LiveMessagesContext } from "@/lib/chat-workbench/tool-preamble";
import { AssistantIdentityDrawnContext, shouldShowAssistantIdentity } from "@/components/chat/copilotkit-v2-agent-identity";
import { isHandoffCardNarration } from "@/lib/chat-workbench/handoff-narration";
import { agentRole } from "@repo/contracts";

afterEach(() => cleanup());

const PENDING = "正在提交转交请求。";
const user = { id: "u", role: "user", content: "UIUX 转给自己" };
const pendingText = { id: "p", role: "assistant", content: PENDING };
const handoffCall = { id: "c", role: "assistant", content: "", toolCalls: [{ id: "rh-1", type: "function", function: { name: agentRole.REQUEST_HANDOFF_TOOL_NAME, arguments: "{}" } }] };
const refused = { id: "r", role: "tool", toolCallId: "rh-1", content: "该角色不能转交给 研究与知识分析师，未发起转交。当前对话会继续。" };

function view(message: Record<string, unknown>, live: readonly unknown[], stale: readonly unknown[]) {
  const identity = { resolve: () => null, resolvePersisted: () => null } as never;
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2MessageActionsProvider value={{ identity, agentId: null, agentLabel: null, landing: null }}>
        <LiveMessagesContext.Provider value={live as never}>
          <V2AssistantMessage message={message as never} messages={stale as never} isRunning />
        </LiveMessagesContext.Provider>
      </CopilotKitV2MessageActionsProvider>
    </CopilotKit>
  );
}

describe("UIUX r4：自转交被拒的实时流", () => {
  it("前导语单独一条：工具结果到达（框架 memo 下 props.messages 仍是旧数组）即隐藏", async () => {
    const stale = [user, pendingText];
    const { rerender } = render(view(pendingText, stale, stale));
    expect(screen.queryByText(PENDING)).not.toBeNull();
    // 调用到了、结果还没到（待确认的 interrupt）：前导语同样隐藏，由确认卡表达状态
    rerender(view(pendingText, [user, pendingText, handoffCall], stale));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
    rerender(view(pendingText, [user, pendingText, handoffCall, refused], stale));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
  });

  it("前导语与调用同条：调用存在（待确认 / 已拒）正文即清空", async () => {
    const same = { ...handoffCall, content: PENDING };
    const { rerender } = render(view(same, [user, same], [user, same]));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
    rerender(view(same, [user, same, refused], [user, same, refused]));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
  });

  it("刷新后（持久化列表：前导语 + 调用 + 结果）不显示前导语", async () => {
    const persisted = [user, pendingText, handoffCall, refused];
    render(view(pendingText, persisted, persisted));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
  });

  it("没有 request_handoff 调用时前导语照常显示", () => {
    render(view(pendingText, [user, pendingText], [user, pendingText]));
    expect(screen.queryByText(PENDING)).not.toBeNull();
  });

  it("同一 toolCallId 的提示条只画一处；先画的卸载后由剩下的接手", async () => {
    function Notice({ id, label }: { id: string; label: string }) {
      return useSingleNoticeOwner(id) ? <p data-testid="notice">{label}</p> : null;
    }
    const { rerender } = render(<><Notice id="rh-1" label="a" /><Notice id="rh-1" label="b" /><Notice id="rh-2" label="c" /></>);
    await waitFor(() => expect(screen.getAllByTestId("notice").map((n) => n.textContent)).toEqual(["a", "c"]));
    rerender(<><Notice id="rh-1" label="b" /><Notice id="rh-2" label="c" /></>);
    await waitFor(() => expect(screen.getAllByTestId("notice").map((n) => n.textContent)).toEqual(["b", "c"]));
  });

  it("执行轨迹不再画 request_handoff 的提示条（消息里已有一份）", () => {
    expect(renderExecutionTool({ id: "rh-1", kind: "tool", text: agentRole.REQUEST_HANDOFF_TOOL_NAME, status: "succeeded" } as never)).toBeNull();
  });
});

describe("UIUX r6：刷新后的转交确认卡旁白", () => {
  const requested = { id: "t", role: "tool", toolCallId: "rh-1", content: "已提交转交给「产品经理」的请求，等待你在对话中确认；确认后会新开一个对话继续。" };
  const narration = { id: "n", role: "assistant", content: "已提交转交给「产品经理」的请求，等待你在对话中确认；确认后会新开一个对话继续。" };
  it("已登记的转交之后复述确认卡的纯文本回合不画", async () => {
    const list = [user, handoffCall, requested, narration];
    render(view(narration, list, list));
    await waitFor(() => expect(screen.queryByText(/已提交转交给/)).toBeNull());
  });
  it("被拒后的真实回答照常显示", () => {
    const answer = { id: "a", role: "assistant", content: "好的，我继续在当前对话里处理。" };
    const list = [user, handoffCall, refused, answer];
    render(view(answer, list, list));
    expect(screen.queryByText(/我继续在当前对话/)).not.toBeNull();
  });
});

describe("UIUX r6 屏 5：刷新后的身份行与拒绝提示", () => {
  const requested = { id: "t", role: "tool", toolCallId: "rh-1", content: "已提交转交给「产品经理」的请求，等待你在对话中确认；确认后会新开一个对话继续。" };
  const narration = { id: "n", role: "assistant", content: "已提交转交给「产品经理」的请求，等待你在对话中确认。" };
  const answer = { id: "a", role: "assistant", content: "确认后我会把资料一并带过去。" };
  const call = { ...handoffCall, content: "" };

  it("隐藏的转交旁白既不画身份行，也不算已画过身份头", () => {
    const list = [user, call, requested, narration, answer];
    const hidden = (m: { id?: string }) => isHandoffCardNarration(m as never, list as never);
    expect(shouldShowAssistantIdentity(narration, list, hidden)).toBe(false);
    // 不传判据时保持旧行为（旁白算已画过）。
    expect(shouldShowAssistantIdentity({ ...answer, id: "a2" }, [user, narration, { ...answer, id: "a2" }])).toBe(false);
    // 隐藏的旁白在前、后面跟着不被隐藏的可见回合：旁白不再吃掉它的身份头。
    const visible = { id: "v", role: "assistant", content: "另外补充一点。" };
    expect(shouldShowAssistantIdentity(visible, [user, narration, visible], (m) => m.id === "n")).toBe(true);
    expect(shouldShowAssistantIdentity(visible, [user, narration, visible])).toBe(false);
  });

  it("「没有转交」提示条：回合没画身份行时自带头像 + 名字", () => {
    render(
      <AssistantIdentityDrawnContext.Provider value={false}>
        <HandoffRefusalNotice toolCallId="rh-x1" result={refused.content} />
      </AssistantIdentityDrawnContext.Provider>,
    );
    expect(screen.getByTestId("handoff-refused-notice")).not.toBeNull();
    expect(screen.getByTestId("chat-v2-agent-portrait")).not.toBeNull();
    expect(screen.getByTestId("chat-v2-agent-identity").textContent).toContain("AI 助手");
  });

  it("回合已有身份行时提示条不重复画", () => {
    render(
      <AssistantIdentityDrawnContext.Provider value>
        <HandoffRefusalNotice toolCallId="rh-x2" result={refused.content} />
      </AssistantIdentityDrawnContext.Provider>,
    );
    expect(screen.getByTestId("handoff-refused-notice")).not.toBeNull();
    expect(screen.queryByTestId("chat-v2-agent-identity")).toBeNull();
  });
});
