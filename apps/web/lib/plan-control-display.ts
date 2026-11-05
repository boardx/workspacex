import { PLAN_GATE_REASON_LABEL_ZH, type PlanGateReason } from "@repo/contracts/plan-control";
import { failureNextStep } from "@repo/contracts/deployment";
import { AGENT_RUN_ERROR_TEXT, AGENT_RUN_FAILURE_REASON_TEXT } from "./agent-run-error-labels";
import { translate, type MessageKey } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

export function planControlGateReason(reason: PlanGateReason | (string & {}), locale: Locale): string {
  return Object.hasOwn(PLAN_GATE_REASON_LABEL_ZH, reason)
    ? translate(locale, `chatPlanControl.gate.${reason as PlanGateReason}`)
    : translate(locale, "chatPlanControl.gateFallback");
}

// Provenance is explicit: these labels are returned by the contract's local-edition
// policy, never arbitrary caller/model text. The policy still decides which advice wins.
const localNextKeys = new Map<string, MessageKey>();
for (const reason of Object.keys(AGENT_RUN_FAILURE_REASON_TEXT) as (keyof typeof AGENT_RUN_FAILURE_REASON_TEXT)[]) {
  const label = failureNextStep("local", reason);
  if (label !== null) localNextKeys.set(label, `chatPlanControl.nextCause.${reason}`);
}
for (const code of Object.keys(AGENT_RUN_ERROR_TEXT) as (keyof typeof AGENT_RUN_ERROR_TEXT)[]) {
  // These two contract codes have no error-level advice; no empty resource entry.
  if (code === "HITL_REJECTED" || code === "MODEL_CALL_FAILED") continue;
  const label = failureNextStep("local", null, code);
  if (label !== null) localNextKeys.set(label, `chatPlanControl.nextError.${code}`);
}
export function planControlLocalNext(label: string, locale: Locale): string {
  const key = localNextKeys.get(label);
  return key ? translate(locale, key) : label;
}
