"use client";
import * as React from "react";
import type { agentInterrupts } from "@repo/contracts";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
export function RestoredInterruptForm({ interrupt, pending, decide }: {
  interrupt: agentInterrupts.RestorableInterrupt; pending: boolean;
  decide: (decision: "approve" | "edit" | "reject", editedArgs?: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  switch (interrupt.toolName) {
    case "confirm_task_intent": return <ConfirmIntentCard args={interrupt.args} state="default" canWrite={!pending} onContinue={() => void decide("approve")} onEditSubmit={(assumptions) => void decide("edit", { assumptions })} />;
    case "fill_run_params": return <FillParamsCard supportsLedgerOnly={false} fields={interrupt.args.fields.map((field) => ({ ...field, kind: typeof (field.aiGuess ?? field.currentValue) === "boolean" ? "boolean" as const : "text" as const }))} state="default" canWrite={!pending} onSubmit={(payload) => void (payload.decision === "approve" ? decide("approve") : decide("edit", { fields: payload.fields }))} />;
    case "choose_execution_option": return <ChooseOptionCard options={interrupt.args.options} state="default" canWrite={!pending} onSelectConfirm={(selectedOptionId) => void decide("edit", { selectedOptionId })} onDecline={() => void decide("reject")} />;
  }
}
