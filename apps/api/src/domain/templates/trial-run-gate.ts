/**
 * 发布门槛的**试跑面**（F21 / `uc-2-1` AC3a，contract `TRIAL_RUN_REQUIRED`）。
 *
 * 与 `publish-gate.ts`（F17，必填面）刻意是**两个文件、两个函数**：
 * F22 落地「发布门槛（必填 ∧ 已试跑）」时把两道门 `&&` 起来，任何一道单独变化
 * 都不用碰另一道的代码或测试——`publish-gate.ts` 头注已经写明它自己「不做试跑门槛」，
 * 正是为了把这一半留给本文件，而不是让一个函数覆盖两件事却只叫得像其中一件。
 *
 * ## 「已试跑」判据：本文件选的立场
 *
 * D-6（`KNOWN_CONTRACT_GAPS.T7`）未裁：「已试跑」算不算数，是创建实例即算，
 * 还是要跑完 / 出产出。`designer-shell.ts` 已经用 `BlueprintBinding`（`kind: "trial-run"`）
 * 这同一张表分了「试跑绑定」与「正式套用绑定」——本文件复用同一个模型：
 * **门槛看的是「这个蓝本有没有至少一条试跑绑定」，不是某个单独的布尔标记**。
 * 这与「创建即算」的差别在于：绑定是**领域里已经存在、可枚举、可审计**的记录，
 * 而不是 `startTrialRun` 调用方自己声明的一个布尔——试跑记录本身仍然只在
 * `startTrialRun` 成功创建时出现一条，所以今天的行为等价于「创建即算」，
 * 但**判据挂在绑定表上**，一旦 D-6 裁成「要跑完才算」，只需要给 `BlueprintBinding`
 * 加一个 `completed` 字段再在这里多判一次，`hasTrialRun` 的调用方一行不用改。
 * ⇒ 本文件不重新发明「creation ⇒ done」的捷径，也不假装已经把 D-6 判完。
 */

import type { BlueprintBinding } from "./designer-shell";

export interface TrialRunGateVerdict {
  /** true ⇒ 拒绝发布，错误码 `TRIAL_RUN_REQUIRED`（AC3a） */
  readonly blocked: boolean;
}

/** 蓝本是否已有至少一条试跑绑定。⚠ 不看 `appliedProjectCount`——那个恒不含试跑（I-22） */
export function hasTrialRun(bindings: readonly BlueprintBinding[]): boolean {
  return bindings.some((b) => b.kind === "trial-run");
}

/** 判定语句恒为「没有任何试跑绑定 ⇒ 阻断」，与试跑发生在哪个版本、哪一次无关。 */
export function evaluateTrialRunGate(bindings: readonly BlueprintBinding[]): TrialRunGateVerdict {
  return { blocked: !hasTrialRun(bindings) };
}
