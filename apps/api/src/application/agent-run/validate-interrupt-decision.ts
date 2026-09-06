import { ConfirmIntentDecision, FillParamsDecision, ChooseOptionDecision, type RestorableInterrupt } from "@repo/contracts/agent-interrupts";

/** Validate only the whitelisted user form and preserve its authoritative option/field identities. */
export function validateInterruptDecision(form: RestorableInterrupt,
  input: { decision: "approve" | "reject" | "edit"; editedArgs?: Readonly<Record<string, unknown>> }): boolean {
  if (input.decision === "reject") return true;
  if (input.decision === "edit") {
    const expected = form.toolName === "confirm_task_intent" ? "assumptions" : form.toolName === "fill_run_params" ? "fields" : "selectedOptionId";
    if (!input.editedArgs || Object.keys(input.editedArgs).some((key) => key !== expected)) return false;
  }
  switch (form.toolName) {
    case "confirm_task_intent": return ConfirmIntentDecision.safeParse(input).success;
    case "choose_execution_option": {
      const parsed = ChooseOptionDecision.safeParse(input);
      if (!parsed.success || parsed.data.decision !== "edit") return false;
      const selected = parsed.data.editedArgs.selectedOptionId;
      return form.args.options.some((option) => option.optionId === selected);
    }
    case "fill_run_params": {
      const parsed = FillParamsDecision.safeParse({ ...input, appliedTo: "full-rerun" });
      if (!parsed.success) return false;
      if (parsed.data.decision === "approve") return true;
      const names = parsed.data.editedArgs.fields.map((field) => field.name);
      return new Set(names).size === names.length && names.every((name) => form.args.fields.some((field) => field.name === name));
    }
  }
}
