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
  if (runId && host.pendingRunId === runId) return null;
  const parsed = agentInterrupts.RestorableInterrupt.safeParse({ toolName, args });
  if (!parsed.success) return <p role="status">正在接收确认内容…</p>;
  if (runId && status !== "complete") return <RestoredRunApproval runId={runId} bearer={host.bearer} canWrite={host.canWrite} fallbackInterrupt={parsed.data} />;
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
