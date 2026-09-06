"use client";

import * as React from "react";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { deepAgentHitl } from "@repo/contracts";
import { announceToChat } from "@/components/chat/chat-live-announcer";
// issue #2767 -- 从 `./tool-permission-card` 直接导入（不含 mock 缺省的版本），不是
// `agent-kernel-units.tsx` 那个薄包装：那个文件顶部整体 `import` 了
// `@/lib/mock/agent-kernel`（`tests/session/chat-dead-mock-cluster.test.ts` #462
// 机械禁止 `/chat` 路由闭包出现任何指向 `lib/mock/**` 的边，见 `tool-permission-
// card.tsx` 头注的完整说明）。
import {
  ToolPermissionCard,
  type ToolPermissionCardDecision,
  type ToolPermissionCardRequest,
} from "@/components/agent-kernel/tool-permission-card";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * issue #2767 —— `/chat` 宿主接入 F08 的 `ToolPermissionCard`，退役
 * `copilotkit-v2-approval-dialog.tsx`（`SendEmailApprovalDialog`）。
 *
 * ## 为什么要退役旧弹窗，不是加一层判断
 *
 * 旧弹窗的非交互分支（`!awaitingDecision || respond === undefined`）会渲染一个
 * 只读对话框，文案是「本轮已裁决，等待 run 收尾。」——这正是 devapp 人类实测报告的
 * 那句「等待批准：调用技能：pdf-create」的来源之一：`useHumanInTheLoop` 的
 * `inProgress` 态（参数还在流式组装）也会命中这个分支，弹出一个此刻并不需要任何
 * 人裁决的对话框。本组件在非 `"executing"` 态一律 `return null`，不渲染任何东西
 * （见下方 `ChatHostToolPermissionInner` 的早退分支）——这不是给旧行为再加一个条件，
 * 是从根上不再有"这个状态也许该弹"这类判断。
 *
 * ## 真正挡下 L0/L1 skill 弹窗的是网关分级，不是这个组件
 *
 * `pdf-create` 这类 L0 skill 现在根本不会让内核 interrupt（`harness.py` 的
 * `_call_skill_requires_hitl` 谓词按 `configurable.hitl_skill_names` 判定，见该
 * 文件头注），所以 `useHumanInTheLoop` 的 `render` 对它完全不会被调用到
 * `"executing"` 态——本组件只在真正的 L2 skill 走到人工确认时才出现。
 *
 * ## 四选一，不是三选一——且不再支持编辑参数
 *
 * F08 签核的 `ToolPermissionCard`（`ui-preview/plan-permissions/03-tool-permission-
 * card.png`）是「仅本次允许 / 本 run 内都允许 / 以后都允许 / 拒绝」四档，对应契约
 * `ToolPermissionDecisionKind`（once/run/forever/deny）——不是旧弹窗的「批准/编辑并
 * 批准/拒绝」三态。`respond()` 直接发四个字面量之一，`copilotkit-agui.controller.ts`
 * 的 `parseHitlDecision` 认得这四个值，路由到 F06 的 `decideToolPermission`（不是旧
 * `decideAgentRun`——两者的"拒绝"语义不同：F06 的 `deny` 让内核据此调整后续计划继续
 * 跑，不是直接判 run 失败，见 `decide-tool-permission.ts` 自己的文档）。三个具名
 * 虚拟工具（`confirm_task_intent`/`fill_run_params`/`choose_execution_option`）不受
 * 影响，仍然用 `copilotkit-v2-agent-interrupts.tsx` 的既有三态卡片。
 *
 * ## 「想做什么/为什么/影响范围」怎么来的——如实记录，不是假装有更细的数据
 *
 * 后端目前只落 `call_skill` 的真实参数 `{skill_stable_name, task}`
 * （`DeepAgentHitlToolArgs`），不产出「意图/理由」这类更细的结构化字段——
 * `ToolPermissionRequest` 契约里的 `intent`/`rationale` 是 UI 签核阶段的展示形状，
 * 生产侧尚未有对应的后端计算逻辑。本组件用技能名派生一句通用「想做什么」、给一句
 * 通用「为什么」，「具体命令」用完整参数 JSON（I-3：未截断，不是摘要）——这比旧
 * 弹窗只显示裸参数 JSON（`copilotkit-v2-hitl-args`，见 `chat-task-workbench-
 * approval.spec.ts` 记录的既有差距）更完整，但仍然是诚实的"目前只有这些真实信息"，
 * 不是编造一个看起来更聪明的理由。
 */

export const CALL_SKILL_TOOL_NAME = deepAgentHitl.DEEP_AGENT_HITL_TOOL_NAME;
export const callSkillToolParameters = deepAgentHitl.DeepAgentHitlToolArgs;

function describeSkillIntent(args: Record<string, unknown>): string {
  const name = args.skill_stable_name;
  return typeof name === "string" && name.length > 0 ? `调用技能：${name}` : "调用技能";
}

function toCardRequest(args: Record<string, unknown>): ToolPermissionCardRequest {
  return {
    risk: "L2",
    intent: describeSkillIntent(args),
    rationale: "这个技能被判定为高风险操作（可能不可逆或涉及外部系统），需要你确认后才会执行。",
    // I-3：完整参数，不截断——`JSON.stringify` 逐字节保留 `task` 全文。
    command: JSON.stringify(args, null, 2),
    affects: "具体影响范围由该技能自行决定；批准前不会执行任何操作。",
  };
}

/**
 * 实际承载交互的内部组件——同 `SendEmailApprovalDialog` 的既有先例，`render` 回调
 * 本身不直接使用 hooks（CopilotKit 把 `render` 当渲染函数调用，不保证是稳定的组件
 * 树位置），把状态管理放进一个真正的具名子组件里。
 */
function ToolPermissionDialog({
  awaitingDecision,
  args,
  respond,
}: {
  readonly awaitingDecision: boolean;
  readonly args: Record<string, unknown>;
  readonly respond?: (result: unknown) => void;
}): JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  const close = React.useCallback(() => setDismissed(true), []);

  const focusComposer = React.useCallback((): void => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    // `preventScroll`：裸 `focus()` 会把每一层祖先（含 AppShell 的 overflow 容器）滚到输入框处，
    // 2026-09-06 人类实测整个界面被滚空（见 `app-shell.tsx` 根节点 `overflow-clip` 注释）。
    composer?.focus({ preventScroll: true });
  }, []);
  const returnFocusToComposer = React.useCallback((event: Event) => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    if (composer === null) return;
    event.preventDefault();
    composer.focus({ preventScroll: true });
  }, []);
  // 同 `SendEmailApprovalDialog` 的既有纪律（issue #2075 TW-A11Y-5）：Esc/遮罩关闭
  // 与卸载两条路径都可能发生，两帧延迟兜底 Radix 自己的焦点恢复覆盖我们的设置。
  const closeAndReturnFocus = React.useCallback((): void => {
    close();
    requestAnimationFrame(() => requestAnimationFrame(focusComposer));
  }, [close, focusComposer]);

  const request = React.useMemo(() => toCardRequest(args), [args]);

  // issue #2075（TW-A11Y-4）—— 需要批准这一刻必须被播报。
  React.useEffect(() => {
    if (awaitingDecision) announceToChat(`需要你的批准：${request.intent}。请在审批对话框中选择决策。`);
  }, [awaitingDecision, request.intent]);

  if (!awaitingDecision || respond === undefined) return null;

  const handleDecide = (decision: ToolPermissionCardDecision): void => {
    closeAndReturnFocus();
    // 契约 `ToolPermissionDecisionKind`：once/run/forever/deny——`ToolPermissionCard`
    // 的 "always" 只是文案层命名，这里翻译回契约字面量。
    respond(decision === "always" ? "forever" : decision);
  };

  return (
    <Dialog
      open={!dismissed}
      onOpenChange={(next) => {
        // Esc/点遮罩层/默认关闭图标 → 等价于拒绝（同 F06 `deny` 语义：内核据此调整
        // 后续计划继续跑，不是直接判 run 失败）。
        if (!next) {
          closeAndReturnFocus();
          respond("deny");
        }
      }}
    >
      <DialogContent
        data-testid="chat-tool-permission-dialog"
        className="max-w-lg border-none bg-transparent p-0 shadow-none"
        hideClose
        onCloseAutoFocus={returnFocusToComposer}
      >
        <ToolPermissionCard request={request} decided={null} onDecide={handleDecide} />
      </DialogContent>
    </Dialog>
  );
}

/** `/chat` 宿主挂载点——`CopilotKitV2PanelBody` 内渲染一次即可（同
 *  `useHumanInTheLoop` 既有先例，不传 `agentId` 时默认绑定唯一的 `"default"` agent）。 */
export function ChatHostToolPermission(): null {
  useHumanInTheLoop({
    name: CALL_SKILL_TOOL_NAME,
    description: "在真正调用这个技能之前，请人确认",
    parameters: callSkillToolParameters,
    render: ({ status, args, respond }) => (
      <ToolPermissionDialog
        awaitingDecision={status === "executing" && respond !== undefined}
        args={args as Record<string, unknown>}
        respond={respond}
      />
    ),
  });
  return null;
}
