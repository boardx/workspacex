"use client";
import * as React from "react";
import { InterjectionComposer } from "@/components/agent-kernel/interjection-composer";
import { interjectAgentRun, type InterjectFn } from "@/lib/agent-kernel-interject";
import type { AgentKernelRunStatus } from "@/lib/agent-kernel-stream";

/**
 * issue #2756 —— `/chat` 宿主里的中途插话入口。F12 的 `InterjectionComposer` 原样复用
 * （行为与 `interjection-input` / `interjection-ack` 等 data-testid 一个字不改），这里只做
 * 宿主该做的两件事：
 *
 * 1. **只在 `status === "running"` 时渲染**——契约 UC-4 只对 `running` 开放插话；宿主拿
 *    不到状态（还没收到第一条 `status_change`）或状态不是 `running` 时**不渲染**，而不是
 *    渲染一个 disabled 的输入框：/chat 里已经有自己的进度指示，多一个灰掉的框只是噪音。
 *    （组件自身的 disabled 对照组仍由 `tests/agent-kernel/interjection-composer.test.tsx`
 *    看守，那是组件契约，不是宿主契约。）
 * 2. **`interject` 走真实 `interjectAgentRun`**，带上宿主当前的 bearer——不新写 fetch。
 *
 * 不渲染 `AgentKernelNonTerminalView`：它的 `ProgressStream` 是签核原型的
 * `MOCK_PROGRESS_STEPS` 假进度，进 /chat 就是在真实页面上画假步骤；/chat 自己的
 * `copilotkit-v2-running-indicator` 才是真实进度，本组件挂在它下方作兄弟节点。
 */
export function ChatHostInterjection({ runId, status, sessionToken }: {
  readonly runId: string | null;
  readonly status: AgentKernelRunStatus | null;
  readonly sessionToken: string | null;
}): JSX.Element | null {
  const interject = React.useCallback<InterjectFn>(
    (input) => interjectAgentRun(input, { sessionToken }),
    [sessionToken],
  );
  if (runId === null || status !== "running") return null;
  return (
    <div data-testid="chat-host-interjection" data-run-id={runId} className="mt-3">
      <InterjectionComposer runId={runId} status={status} interject={interject} />
    </div>
  );
}
