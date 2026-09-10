"use client";
import * as React from "react";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { agentInterrupts } from "@repo/contracts";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";
import { InterruptRenderContext } from "./workbench/interrupt-render-context";
import { RestoredRunApproval } from "./workbench/restored-run-approval";
import { RestoredInterruptForm } from "./workbench/restored-interrupt-form";

function InterruptView({ toolName, args, status }: { toolName: string; args: unknown; status: string }): React.ReactNode {
  const runId = React.useContext(MessageRunContext);
  const host = React.useContext(InterruptRenderContext);
  const parsed = agentInterrupts.RestorableInterrupt.safeParse({ toolName, args });
  if (!parsed.success) return runId && host.pendingRunId === runId ? null : <p role="status">正在接收确认内容…</p>;
  /**
   * issue #3310 ③ —— 此前这里在 `host.pendingRunId === runId` 时**无条件** `return null`。
   *
   * 它想做的是去重（宿主 `copilotkit-v2-panel-body.tsx` 已经在渲染那张权威待决卡），但
   * `pendingRunId` 说的是「这条 run 现在有某个待决请求」，不是「待决的就是**这一条**」。
   * 于是同一条 run 上的下一次授权请求（用户实测里是开始生成画布那一次）一到，早已被裁决
   * 的这张确认记录整张消失——与 #3302 是同一个机理（挂载门绑在一个会走开的状态上）。
   * 而在裁决之前它一直返回 null，也意味着下面那个组件从未挂载过，它用来判断「这条已被
   * 裁决」的本地状态因此恒假（#3310 ①）。
   *
   * 去重改由下面那个组件在**权威读**上做（它本来就在读 `getAgentRun`）：待决的确实是这
   * 一条时它自己返回 null，是别的请求时它按 `resolvedApprovals` 把这一条画成已结束的记录。
   */
  if (runId && status !== "complete") return <RestoredRunApproval runId={runId} bearer={host.bearer} canWrite={host.canWrite} fallbackInterrupt={parsed.data} hostRendersPending={host.pendingRunId === runId} />;
  if (host.pendingRunId === runId && runId) return null;
  return <fieldset disabled aria-label={status === "complete" ? "已结束的确认记录" : "等待确认请求持久化"}>
    <RestoredInterruptForm interrupt={parsed.data} pending={false} decide={async () => {}} />
  </fieldset>;
}

export function CopilotKitV2AgentInterrupts(): null {
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent, parameters: agentInterrupts.ConfirmIntentArgs,
    render: ({ args, status }) => <InterruptView toolName="confirm_task_intent" args={args} status={status} /> });
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams, parameters: agentInterrupts.FillParamsArgs,
    render: ({ args, status }) => <InterruptView toolName="fill_run_params" args={args} status={status} /> });
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption, parameters: agentInterrupts.ChooseOptionArgs,
    render: ({ args, status }) => <InterruptView toolName="choose_execution_option" args={args} status={status} /> });
  return null;
}
