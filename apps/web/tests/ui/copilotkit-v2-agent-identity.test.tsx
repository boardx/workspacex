/**
 * uiux-r1 #5 —— v2 聊天里助手消息的作者身份行：线程的 agent 是数字人（目录里有插画头像）⇒
 * 回答上方画「头像 + 中文称呼」；不是数字人 / 没选 agent ⇒ 不画，保持原气泡。
 * 走真实 `V2AssistantMessage` slot + `CopilotKitV2MessageActionsProvider`（生产渲染点同款）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));
const listAgentDirectory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-directory", async (orig) => ({ ...(await orig<object>()), listAgentDirectory }));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2MessageActionsProvider } from "@/components/chat/copilotkit-v2-message-actions";
import { resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";

const DH = {
  agentId: "agent-d5", versionId: "v1", name: "Sales Representative", initials: "S", roleLabel: "Sales Representative",
  avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "x" }, roleCategory: "sales", tags: [],
  catalogSource: "official", workflows: [], readiness: "ready",
};
const PLAIN = { ...DH, agentId: "agent-plain", name: "通用助手", avatar: null, catalogSource: "org" };

afterEach(() => { cleanup(); resetAgentDirectoryMapCache(); listAgentDirectory.mockReset(); });

function renderFor(agentId: string | null) {
  const message = { id: "view-1", role: "assistant" as const, content: "这是报价建议。" };
  const identity = { resolve: () => null, resolvePersisted: () => null } as never;
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2MessageActionsProvider value={{ identity, agentId, agentLabel: null, landing: null }}>
        <V2AssistantMessage message={message as never} messages={[message] as never} isRunning={false} />
      </CopilotKitV2MessageActionsProvider>
    </CopilotKit>,
  );
}

describe("v2 助手消息：数字人头像身份行", () => {
  it("线程 agent 是数字人 → 回答上方有头像 + 中文称呼", async () => {
    listAgentDirectory.mockResolvedValue([DH, PLAIN]);
    renderFor("agent-d5");
    await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity")).toBeInTheDocument());
    expect(screen.getByTestId("chat-v2-agent-portrait").getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
    expect(screen.getByTestId("chat-v2-agent-identity").textContent).toBe("销售代表");
    expect(screen.getByTestId("copilot-assistant-message")).toBeInTheDocument();
  });

  it("不是数字人（无头像）或没选 agent → 不画身份行", async () => {
    listAgentDirectory.mockResolvedValue([DH, PLAIN]);
    renderFor("agent-plain");
    await waitFor(() => expect(listAgentDirectory).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-v2-agent-identity")).toBeNull();
    cleanup();
    renderFor(null);
    expect(screen.queryByTestId("chat-v2-agent-identity")).toBeNull();
  });
});
