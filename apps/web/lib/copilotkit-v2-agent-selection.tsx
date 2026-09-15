"use client";

import * as React from "react";

/**
 * issue #2023（差距清单第 4 项）—— `/chat/copilotkit-v2` 的 agent 选择状态。
 *
 * 必须是一个 context，不能只是 `copilotkit-v2-panel.tsx` 组件内部的 `useState`：
 * `copilotkit-v2-providers.tsx` 的 `<CopilotKit headers>` 需要读到"当前选中的
 * agent id"来构造这一轮请求的 header（见 `copilotkit-v2-agent-header.ts`），而
 * `<CopilotKit>` 是 `CopilotKitV2Panel` 的**父级**（`layout.tsx` 挂
 * `CopilotKitV2Providers`，`page.tsx` 里 `CopilotKitV2Panel` 是它的子树）——选择发生
 * 在子组件，消费发生在父组件，唯一干净的做法是把状态提到两者共同的父层
 * （本 provider 包在 `CopilotKitV2Providers` 外面，见 `layout.tsx`）。
 *
 * `apps/web/app/api/copilotkit/[[...slug]]/route.ts` 的 `AgentsFactory` 是这条选择
 * 最终生效的地方；本文件只负责浏览器侧的状态与向下透传，不做任何后端路由判断。
 */
interface CopilotKitV2AgentSelectionValue {
  /** `null` = 还没有选定（首次加载 agent 列表之前，或组织里没有可用 agent）。 */
  readonly selectedAgentId: string | null;
  readonly setSelectedAgentId: (agentId: string | null) => void;
}

const CopilotKitV2AgentSelectionContext = React.createContext<CopilotKitV2AgentSelectionValue | null>(null);

export function CopilotKitV2AgentSelectionProvider({
  children,
  initialAgentId = null,
}: {
  children: React.ReactNode;
  /**
   * 进来就选中哪个 agent。`null`（缺省）= 保持"未选择"，与 `/chat` 现有行为**逐字相同**。
   *
   * ## 为什么需要它（2026-09-15 真机截图暴露）
   *
   * 专属 Agent 入口（`/agent/team*`）把线程准备好、把自己的 Agent 挂进 roster，然后
   * 打开 chat。但"挂进 roster"与"这次请求用哪个 agent"是两件事：后者只看这里的
   * `selectedAgentId`（经 `COPILOTKIT_V2_SELECTED_AGENT_HEADER` 送到 `route.ts` 的
   * `AgentsFactory`，再到服务端 `resolveEffectiveAgentId`）。初值恒为 `null` 时请求
   * 不带那个 header，服务端落到"org 动态默认"——也就是**通用助手**在回答，专属
   * Agent 的 instructions 一行都没进 system prompt。用户问它"你可以做什么"，它答的是
   * 通用助手的能力清单，看起来像 Agent 配错了，其实是根本没被选中。
   *
   * ⚠ 这条只设**初值**，之后用户在 picker 里换 agent 照常生效（`setSelectedAgentId`
   * 不受影响）——它是"默认选中谁"，不是"锁死不许换"。
   */
  initialAgentId?: string | null;
}): JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(initialAgentId);
  const value = React.useMemo<CopilotKitV2AgentSelectionValue>(
    () => ({ selectedAgentId, setSelectedAgentId }),
    [selectedAgentId],
  );
  return (
    <CopilotKitV2AgentSelectionContext.Provider value={value}>
      {children}
    </CopilotKitV2AgentSelectionContext.Provider>
  );
}

export function useCopilotKitV2AgentSelection(): CopilotKitV2AgentSelectionValue {
  const ctx = React.useContext(CopilotKitV2AgentSelectionContext);
  if (ctx === null) {
    throw new Error(
      "useCopilotKitV2AgentSelection must be used within CopilotKitV2AgentSelectionProvider (see app/chat/copilotkit-v2/layout.tsx)",
    );
  }
  return ctx;
}
