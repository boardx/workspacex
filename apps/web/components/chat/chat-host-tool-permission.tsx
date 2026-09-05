"use client";
import * as React from "react";
import {
  ToolPermissionCard, type ToolPermissionCardRequest, type ToolPermissionDecisionKind,
} from "@/components/agent-kernel/tool-permission-card";
import { announceToChat } from "@/components/chat/chat-live-announcer";
import { decideToolPermission } from "@/lib/agent-run";
import { ApiError } from "@/lib/api-client";
import { useChatHostPendingToolPermission } from "@/lib/chat-host-tool-permission-run";
import type { AgentKernelRunStatus } from "@/lib/agent-kernel-stream";

/**
 * issue #2774 —— `/chat` 宿主里的四选一工具权限确认卡（F08 `ToolPermissionCard`），
 * **退役**旧 `copilotkit-v2-approval-dialog.tsx`（`useHumanInTheLoop` 只注册了一个
 * 工具名 `APPROVAL_TOOL_NAME`，且其"能不能裁决"依赖 CopilotKit AG-UI 逐工具调用的
 * `respond()` 桥接语义——该文件头注自己记录过一次真实回归（DA-19g），本次 devapp
 * 实测又撞见同一类症状：读到只读分支、`respond` 未定义、没有任何按钮能裁决）。
 *
 * 本卡改走一条更简单、不依赖 AG-UI 逐工具调用桥接的路径：观察 F06 的
 * `awaiting_tool_permission` 状态（`useChatHostInterjectionRun` 已经在订阅的同一条流，
 * 见 `chat-host-tool-permission-run.ts` 头注），裁决直接打 REST
 * `decideToolPermission`（`plan-permissions` 契约 UC-6）。与工具具体叫什么名字无关——
 * 只要 `classifyToolRisk` 判它是 L2，这条路径都能裁决，不像旧弹窗只认 `call_skill`。
 *
 * ## a11y：#2075 TW-A11Y-4/5，从旧弹窗迁移过来（不能丢）
 *
 * - TW-A11Y-4：卡片出现（`pending !== null`）时播报"需要你的批准"——旧弹窗同一句纪律
 *   （"这是整条链路上最需要播报的一刻：不播报，屏幕阅读器用户根本不知道系统正在等他
 *   做决定"），原样保留。
 * - TW-A11Y-5：裁决提交**成功**后把焦点交回 composer。旧弹窗因为是模态 Dialog，
 *   关闭路径有好几条（Escape/遮罩点击/按钮），需要 `onCloseAutoFocus` + 两帧兜底；
 *   本卡不是模态（没有 Radix FocusScope 会抢焦点），裁决成功后卡片会随下一次
 *   `status_change` 事件自然从 DOM 消失，这里只需要在裁决请求 resolve 的那一刻显式
 *   把焦点交回去，不必等卸载、也不需要处理"卸载时机不确定"的兜底。
 */
export function ChatHostToolPermission({ runId, status, sessionToken }: {
  readonly runId: string | null;
  readonly status: AgentKernelRunStatus | null;
  readonly sessionToken: string | null;
}): JSX.Element | null {
  const pending = useChatHostPendingToolPermission({ runId, status, sessionToken });

  React.useEffect(() => {
    if (pending !== null) {
      announceToChat(
        `需要你的批准：调用工具 ${pending.toolName}。请在下方选择仅本次允许、本次运行内都允许、以后都允许或拒绝。`,
      );
    }
  }, [pending]);

  const focusComposer = React.useCallback((): void => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    composer?.focus();
  }, []);

  const onDecide = React.useCallback(async (decision: ToolPermissionDecisionKind): Promise<void> => {
    if (runId === null || pending === null) return;
    try {
      // `toolCallId`：后端 `decide-tool-permission.ts` 自己的文档承认这个字段只在错误
      // 信息里回显、不参与判定（本仓执行内核每次只有一个待批工具调用）——传 toolName
      // 占位，不发明一个客户端假 id 冒充服务端追踪的调用标识。
      await decideToolPermission(runId, pending.toolName, decision, sessionToken ?? undefined);
      // TW-A11Y-5：裁决提交成功后把焦点交回 composer（同旧弹窗两帧兜底的谨慎程度，
      // 见该文件 `closeAndReturnFocus` 的注记：排两帧确保落在浏览器自身可能触发的
      // 任何默认焦点行为之后）。
      requestAnimationFrame(() => requestAnimationFrame(focusComposer));
    } catch (e) {
      if (e instanceof ApiError && e.reasonCode === "RUN_NOT_AWAITING_TOOL_PERMISSION") {
        throw new Error("这次请求已经被处理，或 run 已经结束——请刷新查看最新状态");
      }
      throw new Error("提交失败，请重试");
    }
  }, [runId, pending, sessionToken, focusComposer]);

  if (pending === null) return null;

  const request: ToolPermissionCardRequest = {
    tool: pending.toolName,
    risk: "L2",
    // 后端目前只落 toolName + 有上限的参数摘要（`AgentRunView.pendingApproval`），没有
    // 捕获逐次调用的具体 intent/rationale——如实用通用文案兜底，不编一个具体理由冒充
    // 模型说过的话（同旧弹窗 `describeSkillAction` 取不到具体名字时的兜底纪律）。
    intent: `调用工具 ${pending.toolName}`,
    rationale: "该操作被标记为高风险（L2：不可逆或有外部影响），执行前需要你确认。",
    command: pending.argsSummary ?? "(无参数摘要)",
    affects: "具体影响范围以 agent 说明为准；如不确定，可先选择拒绝。",
  };

  return (
    <div data-testid="chat-host-tool-permission" data-run-id={runId} className="mt-3">
      <ToolPermissionCard request={request} onDecide={onDecide} />
    </div>
  );
}
