/**
 * F215（`agent-interrupts` 契约束）—— UC-3 `chooseExecutionOption` 的
 * `SELECTED_OPTION_NOT_FOUND` 守卫（`usecases.md` 统一失败枚举 + `domain.md` I-6）。
 *
 * 范围边界与 `fill-params-decision.ts` 同一纪律：这是 `ChooseOptionDecision` 在
 * application 层的唯一消费点，纯函数、不落库、不碰共享的
 * `POST /agent-runs/:runId/decision` 端点契约（同一份"不在本 issue 单方面扩大一个
 * 所有 HITL 类型共用的 `.strict()` 契约"的理由，见 `fill-params-decision.ts` 文件头）。
 *
 * I-6 的核心：`selectedOptionId` 必须在**原始** `options` 集合里按 id 命中，不用
 * 数组下标——选项数组因并发/重渲染而重排时，下标寻址会静默选错，id 寻址不会。
 */
import type { ChooseOptionArgs, ChooseOptionDecision, OptionCard } from "@repo/contracts/agent-interrupts";

export type ChooseOptionResolution =
  | { readonly kind: "resolved"; readonly option: OptionCard }
  | { readonly kind: "declined" }
  | { readonly kind: "error"; readonly code: "SELECTED_OPTION_NOT_FOUND" };

/**
 * `originalOptions` 必须是这次中断**触发时**的原始集合（`ChooseOptionArgs.options`），
 * 不是决策时刻重新查询/重新渲染出来的集合——否则"按 id 命中原始集合"这句话本身就
 * 失去意义（决策者能看见的选项永远该是他做决定时那一份）。
 */
export function resolveChooseOptionDecision(
  originalOptions: ChooseOptionArgs["options"],
  decision: ChooseOptionDecision,
): ChooseOptionResolution {
  if (decision.decision === "reject") return { kind: "declined" };
  const found = originalOptions.find((o) => o.optionId === decision.editedArgs.selectedOptionId);
  if (found === undefined) return { kind: "error", code: "SELECTED_OPTION_NOT_FOUND" };
  return { kind: "resolved", option: found };
}
