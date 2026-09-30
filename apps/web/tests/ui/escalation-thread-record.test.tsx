/**
 * uiux-r3 #4（AG06 升级流，评审 reject 级）的反证套件：
 *  ① 待决卡片按消息流顺序画在触发它的那条用户消息之后（宿主挂在 TaskTimeline 之后，不钉在线程顶）；
 *  ② 「正在提交升级请求。」这类待决旁白不画（结果另有回答与记录承载）；
 *  ③ 刷新后作者身份取 run 上持久化的 agentId，而不是 composer 的临时选择（不塌成「AI 助手」）；
 *  ⑤ 裁决后留下「决定人 · 同意/驳回 · 说明 · 时间」的已裁决记录，原位替换卡片、刷新后仍在回合里；
 *  ⑥ 原因与事项同文时不重复。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));
const { listAgentDirectory, getAgentRun, decideEscalation } = vi.hoisted(() => ({
  listAgentDirectory: vi.fn(), getAgentRun: vi.fn(), decideEscalation: vi.fn(),
}));
vi.mock("@/lib/agent-directory", async (orig) => ({ ...(await orig<object>()), listAgentDirectory }));
vi.mock("@/lib/agent-run", async (orig) => ({ ...(await orig<object>()), getAgentRun }));
vi.mock("@/lib/agent-escalation", async (orig) => ({ ...(await orig<object>()), decideEscalation }));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage, isPendingToolStatement } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2MessageActionsProvider } from "@/components/chat/copilotkit-v2-message-actions";
import { AgentEscalationCard, AgentEscalationDecidedRecord } from "@/components/chat/agent-escalation-card";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";
import { ESCALATE_TOOL_NAME } from "@/lib/agent-escalation";
import { resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";
import { resetAgentRunViewCache } from "@/lib/use-agent-run-view";

afterEach(() => { cleanup(); vi.clearAllMocks(); resetAgentDirectoryMapCache(); resetAgentRunViewCache(); });

const DH = {
  agentId: "agent-pm", versionId: "v1", name: "Product Manager", initials: "P", roleLabel: "Product Manager",
  avatar: { kind: "illustration", key: "dh-03-product-manager", alt: "x" }, roleCategory: "product", tags: [],
  catalogSource: "official", workflows: [], readiness: "ready",
};
const IID = "11111111-1111-4111-8111-111111111111";
const payload = { matter: "合同变更", reason: "客户要改付款条款，超出我的职责。", target: "requester" as const, contextRefs: [] };
const decided = {
  permissionRequestId: IID, argsSummary: JSON.stringify(payload), decision: "resolve" as const,
  text: "同意，但你只整理需求。", decidedBy: { userId: "u1", displayName: "林澈" }, decidedAt: "2026-09-30T07:30:00.000Z",
};
function runView(over: Record<string, unknown> = {}) {
  return {
    runId: "run-1", threadId: "t1", inputMessageId: "m1", agentId: DH.agentId, agentVersionId: "v1", skillVersionIds: [],
    modelProvider: "deep-agent", modelId: "x", status: "succeeded", error: null, resultMessageId: null,
    steps: [], createdAt: "2026-09-30T00:00:00Z", pendingApproval: null, ...over,
  };
}

function renderAssistant(message: Record<string, unknown>, runId: string | null) {
  const identity = { resolve: () => null, resolvePersisted: () => null } as never;
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      {/* 刷新后：composer 选择回到默认（agentId=null），身份只能从 run 读 */}
      <CopilotKitV2MessageActionsProvider value={{ identity, agentId: null, agentLabel: null, landing: null }}>
        <MessageRunContext.Provider value={runId}>
          <V2AssistantMessage message={message as never} messages={[{ id: "u", role: "user", content: "q" }, message] as never} isRunning={false} />
        </MessageRunContext.Provider>
      </CopilotKitV2MessageActionsProvider>
    </CopilotKit>,
  );
}

describe("③ 身份取 run 的持久化 agentId", () => {
  it("刷新后 composer 未选人，回答仍画数字人头像 + 中文称呼，而不是「AI 助手」", async () => {
    listAgentDirectory.mockResolvedValue([DH]);
    getAgentRun.mockResolvedValue(runView());
    renderAssistant({ id: "a1", role: "assistant", content: "我会按这个裁决继续。" }, "run-1");
    await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity").textContent).toContain("产品经理"), { timeout: 5000 });
    expect(screen.getByTestId("chat-v2-agent-portrait").getAttribute("data-avatar-key")).toBe("dh-03-product-manager");
    expect(screen.getByTestId("chat-v2-agent-identity").textContent).not.toContain("AI 助手");
  });
});

describe("⑤ 已裁决记录", () => {
  it("回合里留下决定人 · 同意 · 时间 · 说明，刷新后照样从权威读画出来", async () => {
    listAgentDirectory.mockResolvedValue([DH]);
    getAgentRun.mockResolvedValue(runView({ resolvedEscalations: [decided] }));
    renderAssistant({ id: "a1", role: "assistant", content: "负责人已裁决同意。" }, "run-1");
    const record = await screen.findByTestId("agent-escalation-decided");
    expect(screen.getByTestId("agent-escalation-decided-by").textContent).toBe("林澈");
    expect(screen.getByTestId("agent-escalation-decided-verdict").textContent).toBe("同意");
    expect(screen.getByTestId("agent-escalation-decided-at").getAttribute("dateTime")).toBe(decided.decidedAt);
    expect(screen.getByTestId("agent-escalation-decided-text").textContent).toContain("同意，但你只整理需求。");
    expect(screen.getByTestId("agent-escalation-decided-matter").textContent).toBe("合同变更");
    // 记录在回答正文之前（同一回合里：身份 → 记录 → 回答）
    const body = screen.getByText("负责人已裁决同意。");
    expect(record.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("驳回：徽标读「驳回」，说明前缀是理由；缺显示名回退到升级对象称呼", () => {
    render(<AgentEscalationDecidedRecord record={{ ...decided, decision: "reject", text: "预算不够", decidedBy: null }} />);
    expect(screen.getByTestId("agent-escalation-decided-verdict").textContent).toBe("驳回");
    expect(screen.getByTestId("agent-escalation-decided-by").textContent).toBe("任务发起人");
    expect(screen.getByTestId("agent-escalation-decided-text").textContent).toBe("理由：预算不够");
  });

  it("宿主卡片裁决后原位换成已裁决记录，不是整张消失", async () => {
    listAgentDirectory.mockResolvedValue([DH]);
    const pending = { permissionRequestId: IID, toolName: ESCALATE_TOOL_NAME, argsSummary: JSON.stringify(payload) };
    getAgentRun
      .mockResolvedValueOnce(runView({ status: "awaiting_tool_permission", pendingApproval: pending }))
      .mockResolvedValue(runView({ status: "queued", resolvedEscalations: [decided] }));
    decideEscalation.mockResolvedValue({ interruptId: IID, status: "resolved" });
    render(<RestoredRunApproval runId="run-1" canWrite />);
    fireEvent.change(await screen.findByTestId("agent-escalation-text"), { target: { value: "同意，但你只整理需求。" } });
    fireEvent.click(screen.getByTestId("agent-escalation-resolve"));
    await waitFor(() => expect(screen.getByTestId("agent-escalation-decided")).toBeTruthy());
    expect(screen.queryByTestId("agent-escalation-card")).toBeNull();
  });
});

describe("② 待决旁白不画", () => {
  it("带升级调用的那条（「正在提交升级请求。」）整条不渲染", () => {
    const message = {
      id: "p1", role: "assistant", content: "正在提交升级请求。",
      toolCalls: [{ id: "c1", type: "function", function: { name: ESCALATE_TOOL_NAME, arguments: "{}" } }],
    };
    expect(isPendingToolStatement(message)).toBe(true);
    const { container } = renderAssistant(message, null);
    expect(container.textContent).not.toContain("正在提交升级请求");
  });
  it("普通回答不受影响", () => {
    expect(isPendingToolStatement({ toolCalls: [] })).toBe(false);
    expect(isPendingToolStatement({ toolCalls: [{ function: { name: "write_todos" } }] })).toBe(false);
  });
});

describe("① 卡片按消息流顺序出现", () => {
  it("宿主的待决卡挂在 TaskTimeline 之后（触发它的用户消息下面），不在消息流之前", () => {
    const src = readFileSync(resolve(__dirname, "../../components/chat/copilotkit-v2-panel-body.tsx"), "utf8");
    const timeline = src.indexOf("<TaskTimeline");
    const card = src.indexOf("<RestoredRunApproval canWrite={canDecide}");
    expect(timeline).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(timeline);
    expect(src.match(/<RestoredRunApproval canWrite=\{canDecide\}/g)).toHaveLength(1);
  });
});

describe("⑥ 卡片文案", () => {
  it("原因与事项同文时只印一次；占位不是销售示例", () => {
    render(<AgentEscalationCard interruptId={IID} payload={{ ...payload, reason: "合同变更" }} agentName="产品经理" />);
    expect(screen.queryByTestId("agent-escalation-reason")).toBeNull();
    expect(screen.getByTestId("agent-escalation-text").getAttribute("placeholder")).not.toContain("折");
  });
});

describe("UIUX r4：实时流里的升级前导语", () => {
  it("正文与升级调用分成两条消息时，调用一到（含裁决后）前导语就不再显示，不等刷新", async () => {
    const { LiveMessagesContext } = await import("@/lib/chat-workbench/tool-preamble");
    listAgentDirectory.mockResolvedValue([DH]);
    getAgentRun.mockResolvedValue(runView());
    const identity = { resolve: () => null, resolvePersisted: () => null } as never;
    const user = { id: "u", role: "user", content: "q" };
    const pendingText = { id: "p", role: "assistant", content: "这件事超出了我的职责，需要负责人拍板。" };
    const escalateCall = { id: "c", role: "assistant", content: "", toolCalls: [{ id: "esc-1", type: "function", function: { name: ESCALATE_TOOL_NAME, arguments: "{}" } }] };
    const view = (live: readonly unknown[]) => (
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2MessageActionsProvider value={{ identity, agentId: null, agentLabel: null, landing: null }}>
          <LiveMessagesContext.Provider value={live as never}>
            {/* 框架 memo 下 props.messages 是旧数组：只有前导语自己 */}
            <V2AssistantMessage message={pendingText as never} messages={[user, pendingText] as never} isRunning />
          </LiveMessagesContext.Provider>
        </CopilotKitV2MessageActionsProvider>
      </CopilotKit>
    );
    const { rerender } = render(view([user, pendingText]));
    expect(screen.queryByText("这件事超出了我的职责，需要负责人拍板。")).not.toBeNull();
    rerender(view([user, pendingText, escalateCall, { id: "r", role: "tool", toolCallId: "esc-1", content: "resolved" }, { id: "f", role: "assistant", content: "负责人已同意。" }]));
    await waitFor(() => expect(screen.queryByText("这件事超出了我的职责，需要负责人拍板。")).toBeNull());
  });
});
