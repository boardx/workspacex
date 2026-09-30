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
import { useSingleNoticeOwner } from "@/components/chat/copilotkit-v2-tool-renderers";
import { renderExecutionTool } from "@/components/chat/workbench/task-timeline";
import { LiveMessagesContext } from "@/lib/chat-workbench/tool-preamble";
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
    // 调用到了、结果还没到：仍在进行中，前导语保留
    rerender(view(pendingText, [user, pendingText, handoffCall], stale));
    expect(screen.queryByText(PENDING)).not.toBeNull();
    rerender(view(pendingText, [user, pendingText, handoffCall, refused], stale));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
  });

  it("前导语与调用同条：结果到达后正文清空", async () => {
    const same = { ...handoffCall, content: PENDING };
    const { rerender } = render(view(same, [user, same], [user, same]));
    expect(screen.queryByText(PENDING)).not.toBeNull();
    rerender(view(same, [user, same, refused], [user, same, refused]));
    await waitFor(() => expect(screen.queryByText(PENDING)).toBeNull());
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
