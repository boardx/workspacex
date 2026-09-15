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
   * 首次挂载时的默认选中项。缺省 `null` ⇒ `/chat` 那条路由行为**逐字不变**
   * （那里"不选"是必须保持可用的状态，见 `copilotkit-v2-panel.tsx`）。
   *
   * ⚠ 存在的理由（2026-09-15 真机实测）：单 Agent 入口（`/agent/<team>`）把 Agent
   * 挂进线程 roster 之后就以为大功告成，但**「挂进 roster」决定的是"这条线程编制里
   * 有谁"，不决定"这次请求用哪个 agent"**。没选中 ⇒ 请求不带
   * `COPILOTKIT_V2_SELECTED_AGENT_HEADER` ⇒ 服务端 `resolveEffectiveAgentId` 落到
   * 「org 动态默认」= 通用助手。于是那个 Agent 的 instructions 一行都没进 system
   * prompt——用户看到的是通用助手在回答，而不是他点进来的那个 Agent。
   *
   * ⚠ 它必须是 `useState` 的**初值**，不能"先挂载再异步 setState"：
   * `copilotkit-v2-providers.tsx` 里那段关于 token 的头注记录过同一个时序竞争——
   * 底层 proxied agent 有一定概率在构造那一帧就把 headers 定死，随后的 prop 变化
   * 不一定生效。那里的结论是"让首帧就是最终值，消灭空档本身，而不是试图跑赢它"，
   * 这里沿用同一条。⇒ 调用方必须**解析出 agentId 之后再挂本 provider**。
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
