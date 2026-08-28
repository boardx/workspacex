/**
 * issue #2307（#2300 引入的回归，`copilotkit-v2-roster-landing.spec.ts:94` 3/3 稳定复现）——
 * 「落地为产物」入口挂进 `additionalToolbarItems` 后，从消息动作条的 DOM 里整个消失。
 *
 * ## 根因（读框架编译产物 `copilotkit-nRjRp2_5.mjs` 确认，不是猜测）
 *
 * `CopilotChatAssistantMessage` 内部：
 * `shouldShowToolbar = toolbarVisible && hasContent && !(isRunning && isLatestAssistantMessage)`
 * ——这是**整个 toolbar 容器**（含 `additionalToolbarItems`）的 mount/unmount 开关，
 * 不是 CSS 可见性。#2300 之前，落地入口是气泡下方一个独立兄弟节点，不经过这条门；
 * #2300 把它挪进了 `additionalToolbarItems`（人类反馈：应与复制/反馈/评分同一排），
 * 这条耦合第一次生效——而它与后端协议时序对不上：`chat_message_id` 映射事件
 * （`lib/copilotkit-v2-message-identity.ts`）在 run **succeeded 之后、`RUN_FINISHED`
 * 之前**发出，也就是说"消息已真实落库、可以落地"这件事可能发生在客户端
 * `agent.isRunning` 还没翻回 `false` 的窗口内——恰好是 `isRunning &&
 * isLatestAssistantMessage` 为真、框架判定"整条 toolbar 都不该出现"的那一刻。
 *
 * 修法（`copilotkit-v2-panel.tsx` 的 `V2AssistantMessageImpl`）：只对这一条消息把
 * 传给框架的 `isRunning` 改写为 `props.isRunning && persistedMessageId === null`——
 * `resolvePersisted` 是本文件既有的"这条消息是否已经是一行真实 `chat_messages`
 * 记录"判据，一旦解析出真实落库 id，就不该再被"协议层 `RUN_FINISHED` 还没到"卡住。
 *
 * ## 为什么这里直接挂真实框架组件，而不是挂 `V2AssistantMessageImpl`
 *
 * 后者未导出（`copilotkit-v2-panel.tsx` 只导出整个 `CopilotKitV2Panel`），完整走一遍
 * 真实的流式 run 需要真栈 SSE，属于 e2e（`copilotkit-v2-roster-landing.spec.ts:94`）
 * 的职责。这里钉住的是修法本身的核心不变量——用真实的 `CopilotChatAssistantMessage`
 * + 真实的 `CopilotKitV2MessageLandingTrigger`，只把 `isRunning` 换成修法算出的
 * `effectiveIsRunning`，直接验证"消息已持久化时，即使 isRunning 仍为 true，落地
 * 入口也必须在 DOM 里"这条断言——这正是 e2e 那条红线在组件层的对应不变量，跑得快、
 * 不需要真栈，能在每次 PR 里挡住同一类回归。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotChatAssistantMessage, CopilotKit } from "@copilotkit/react-core/v2";
import {
  CopilotKitV2MessageActionsProvider,
  CopilotKitV2MessageLandingTrigger,
} from "@/components/chat/copilotkit-v2-message-actions";

/** 复刻 `V2AssistantMessageImpl` 里 `effectiveIsRunning` 那一行计算，不是重新发明一份。 */
function Wrapper({ isRunning, persisted }: { isRunning: boolean; persisted: boolean }) {
  const message = { id: "view-1", role: "assistant" as const, content: "hello world" };
  const persistedMessageId = persisted ? "cm-1" : null;
  const effectiveIsRunning = isRunning && persistedMessageId === null;
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2MessageActionsProvider
        value={{
          identity: {
            resolve: () => (persisted ? "cm-1" : null),
            resolvePersisted: () => persistedMessageId,
          } as any,
          agentId: "agent-1",
          agentLabel: "Agent",
          landing: {
            stateFor: () => undefined,
            open: () => {},
            updateTitle: () => {},
            cancel: () => {},
            submit: () => {},
          },
        }}
      >
        <CopilotChatAssistantMessage
          message={message as any}
          messages={[message] as any}
          isRunning={effectiveIsRunning}
          additionalToolbarItems={
            <CopilotKitV2MessageLandingTrigger messageId={message.id} text={message.content} />
          }
        />
      </CopilotKitV2MessageActionsProvider>
    </CopilotKit>
  );
}

describe("copilotkit-v2 落地入口不再被框架的 isRunning 门永久卡住（issue #2307）", () => {
  it("仍在流式、尚未落库：入口如实不在 DOM 里（不是这条修法要改的行为）", () => {
    render(<Wrapper isRunning={true} persisted={false} />);
    expect(screen.queryByTestId("chat-land-artifact-open-cm-1")).not.toBeInTheDocument();
  });

  it("RUN_FINISHED 还没到，但消息已经落库（#2307 的真实竞态）：入口必须在 DOM 里", () => {
    render(<Wrapper isRunning={true} persisted={true} />);
    expect(screen.getByTestId("chat-land-artifact-open-cm-1")).toBeInTheDocument();
  });

  it("完全空闲：入口在 DOM 里（既有行为不回退）", () => {
    render(<Wrapper isRunning={false} persisted={true} />);
    expect(screen.getByTestId("chat-land-artifact-open-cm-1")).toBeInTheDocument();
  });
});
