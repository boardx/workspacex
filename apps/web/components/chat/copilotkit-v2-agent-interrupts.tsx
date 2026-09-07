"use client";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { agentInterrupts } from "@repo/contracts";

export function CopilotKitV2AgentInterrupts(): null {
  // Keep framework tool registration; the durable request owns all actionable UI.
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent, parameters: agentInterrupts.ConfirmIntentArgs, render: () => null });
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams, parameters: agentInterrupts.FillParamsArgs, render: () => null });
  useHumanInTheLoop({ name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption, parameters: agentInterrupts.ChooseOptionArgs, render: () => null });
  return null;
}
