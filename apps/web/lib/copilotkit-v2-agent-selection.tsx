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
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
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
