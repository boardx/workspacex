"use client";
import * as React from "react";
import type { agentInterrupts } from "@repo/contracts";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
export function RestoredInterruptForm({ interrupt, pending, canWrite = true, decided, decide }: {
  interrupt: agentInterrupts.RestorableInterrupt; pending: boolean; canWrite?: boolean;
  /** issue #3310：这是一条**已结束的确认记录**（`AgentRunView.resolvedApprovals`），不是待办。 */
  decided?: { decision: "once" | "run" | "forever" | "deny" | "reject" | "edit" | null };
  decide: (decision: "approve" | "edit" | "reject", editedArgs?: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  /**
   * `pending` is submission progress, while `canWrite` is authorization. They must stay
   * separate: folding both into `canWrite={!pending}` briefly labels an accepted personal-chat
   * decision as a project-observer denial while the POST is still in flight (#3567).
   */
  switch (interrupt.toolName) {
    case "confirm_task_intent": return <ConfirmIntentCard args={interrupt.args} state={pending ? "loading" : "default"} canWrite={canWrite} decided={decided} onContinue={() => void decide("approve")} onEditSubmit={(edited) => void decide("edit", edited.understanding === interrupt.args.understanding ? { assumptions: edited.assumptions } : { assumptions: edited.assumptions, understanding: edited.understanding })} />;
    case "fill_run_params": return <FillParamsCard supportsLedgerOnly={false} fields={interrupt.args.fields.map((field) => ({ ...field, kind: typeof (field.aiGuess ?? field.currentValue) === "boolean" ? "boolean" as const : "text" as const }))} state={pending ? "loading" : "default"} canWrite={canWrite} onSubmit={(payload) => void (payload.decision === "approve" ? decide("approve") : decide("edit", { fields: payload.fields }))} />;
    case "choose_execution_option": return <ChooseOptionCard options={interrupt.args.options} state={pending ? "loading" : "default"} canWrite={canWrite} onSelectConfirm={(selectedOptionId) => void decide("edit", { selectedOptionId })} onDecline={() => void decide("reject")} />;
  }
}
