/**
 * issue #3310 ② —— 把用户裁决时真正被采纳的那一份参数合回**展示用**的中断快照。
 *
 * 人类实测：模型提案「舟山马鞍岛的房产中介」，用户点「改假设」把舟山改成中山并确认，
 * 而卡片此后一直画着舟山。取证结论：编辑值确实到了服务端（`pending_edited_args`）也确实
 * 到了后续执行（`edited_action.args` → `tools.py` 的 `confirm_task_intent`），**断的是展示**
 * ——全仓此前没有任何一处把 `pending_edited_args` 合回 `pending_interrupt`，于是「已裁决的
 * 那张记录」永远画的是模型最初的提案，而不是用户按下确认的那一份。
 *
 * ⚠ 这个函数**只用于展示**，一个字都不参与授权判定或 resume 载荷组装：resume 走的仍然是
 * `pending_edited_args` 原文（`execute-run.ts`）。合并失败（老数据、形状对不上）时一律
 * 逐字回落到原提案——绝不因为合不上就编一份出来，也绝不因此丢掉这条记录。
 *
 * ⚠ 各 `editedArgs` 的形状不是完整 args，见 `packages/contracts/src/agent-interrupts.ts`：
 *   · confirm_task_intent → `{assumptions, understanding?}`（无 requestId）
 *   · fill_run_params     → `{fields: [{name, value}]}`（不是完整 ParamField）
 *   · choose_execution_option → `{selectedOptionId}`（args 里根本没有这个字段）
 */
import { RestorableInterrupt } from "@repo/contracts/agent-interrupts";

function parsedEditedArgs(editedArgs: unknown): Record<string, unknown> | null {
  if (typeof editedArgs === "string") {
    try { return parsedEditedArgs(JSON.parse(editedArgs)); } catch { return null; }
  }
  if (!editedArgs || typeof editedArgs !== "object" || Array.isArray(editedArgs)) return null;
  return editedArgs as Record<string, unknown>;
}

export function applyEditedInterruptArgs(
  interrupt: RestorableInterrupt,
  editedArgs: unknown,
): RestorableInterrupt {
  const edited = parsedEditedArgs(editedArgs);
  if (edited === null) return interrupt;
  let candidate: unknown;
  switch (interrupt.toolName) {
    case "confirm_task_intent": {
      const assumptions = Array.isArray(edited.assumptions)
        && edited.assumptions.every((a) => typeof a === "string" && a.trim().length > 0)
        ? edited.assumptions : interrupt.args.assumptions;
      const understanding = typeof edited.understanding === "string" && edited.understanding.trim().length > 0
        ? edited.understanding : interrupt.args.understanding;
      candidate = { toolName: interrupt.toolName, args: { ...interrupt.args, understanding, assumptions } };
      break;
    }
    case "fill_run_params": {
      const values = new Map<string, unknown>();
      if (Array.isArray(edited.fields)) {
        for (const field of edited.fields) {
          if (field && typeof field === "object" && !Array.isArray(field)) {
            const name = (field as Record<string, unknown>).name;
            if (typeof name === "string") values.set(name, (field as Record<string, unknown>).value);
          }
        }
      }
      candidate = { toolName: interrupt.toolName, args: { ...interrupt.args,
        fields: interrupt.args.fields.map((field) => values.has(field.name)
          ? { ...field, currentValue: values.get(field.name) ?? null } : field) } };
      break;
    }
    // `选了哪个方案` 不住在 args 里，没有可合并的展示字段——原样返回。
    case "choose_execution_option": return interrupt;
  }
  const reparsed = RestorableInterrupt.safeParse(candidate);
  return reparsed.success ? reparsed.data : interrupt;
}
