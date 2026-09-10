import { ConfirmIntentDecision, FillParamsDecision, ChooseOptionDecision, type RestorableInterrupt } from "@repo/contracts/agent-interrupts";

/** Validate only the whitelisted user form and preserve its authoritative option/field identities. */
export function validateInterruptDecision(form: RestorableInterrupt,
  input: { decision: "approve" | "reject" | "edit"; editedArgs?: Readonly<Record<string, unknown>> }): boolean {
  if (input.decision === "reject") return true;
  if (input.decision === "edit") {
    /**
     * issue #3310 ②：`confirm_task_intent` 的可编辑面从「只有 assumptions」放宽到
     * 「assumptions + 可选的 understanding」——用户改的正是「我的理解」里那个词
     * （舟山→中山），而此前改不了、也回传不了，于是模型上下文里那句话原封不动。
     * 白名单本身没有被放宽成"任意键"：仍然逐键比对一个封闭集合，且最终仍由
     * `ConfirmIntentDecision`（`understanding` 为 `min(1)` 的 optional）判定。
     */
    const expected: readonly string[] = form.toolName === "confirm_task_intent"
      ? ["assumptions", "understanding"]
      : form.toolName === "fill_run_params" ? ["fields"] : ["selectedOptionId"];
    if (!input.editedArgs || Object.keys(input.editedArgs).some((key) => !expected.includes(key))) return false;
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
