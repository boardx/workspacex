/**
 * F95 —— 虚拟来源隔离是接口层的门，不是按钮置灰 (`uc-6-5` R3 step7-8, AC3/V3,
 * `packages/contracts/src/interview.ts` `markStrongInsight`/`referenceForDecision`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的一条不变量
 *
 * **只有真人来源能标强 / 能被引用为决策依据（I-28）**——虚拟来源一律
 * `VIRTUAL_SOURCE_FORBIDDEN`，且是**同一道门**：`markStrongInsight` 与
 * `referenceForDecision` 两个接口调用同一个 `checkSourceAllowsStrongUse`，
 * 不是两处各自判一次（AGENTS.md「同一事实不得声明在两处」）。
 *
 * ⚠ 这道门必须在**接口层**（本文件供两个 controller 调用）生效，一个只在
 * 前端把按钮置灰的实现，任何直接调接口的人（脚本 / 另一个前端 / agent）
 * 都能绕过去——所以这里的断言看的是"调用被拒绝"，不是"按钮不可点"。
 *
 * ## 本文件刻意没有的东西
 * · **候选生成阶段 `sourceKind` 的传播规则**（任一虚拟即整条候选标 virtual）——
 *   那是 `candidate-insight.ts`（F94）的事，本文件只消费已经落定的 `sourceKind`，
 *   不重新判定"这条洞察算不算虚拟"。
 */
import { interview as C } from "@repo/contracts";
import type { z } from "zod";

export type InterviewSourceKindT = z.infer<typeof C.InterviewSourceKind>;

export type SourceGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "VIRTUAL_SOURCE_FORBIDDEN" };

/**
 * checkSourceAllowsStrongUse —— `markStrongInsight` 与 `referenceForDecision`
 * 复用的同一道"虚拟来源不可标强/不可作决策依据"门（V3 / I-28）。
 *
 * ⚠ 只看 `sourceKind`，不看调用方是谁——服务端强制，不依赖客户端有没有
 *   把按钮置灰。任何 `sourceKind === "virtual"` 的洞察，无论走哪个接口，
 *   在这里都必须被拒绝。
 */
export function checkSourceAllowsStrongUse(
  insight: Pick<z.infer<typeof C.Insight>, "sourceKind">,
): SourceGateResult {
  return insight.sourceKind === "virtual"
    ? { ok: false, reason: "VIRTUAL_SOURCE_FORBIDDEN" }
    : { ok: true };
}

/**
 * checkMarkStrongAllowed —— `markStrongInsight` 接口层门（与
 * `checkReferenceForDecisionAllowed` 是同一函数的两个具名入口，
 * 防止调用方"忘了这是同一道门"而各自重新实现一次）。
 */
export const checkMarkStrongAllowed = checkSourceAllowsStrongUse;

/** checkReferenceForDecisionAllowed —— `referenceForDecision` 接口层门，同上。 */
export const checkReferenceForDecisionAllowed = checkSourceAllowsStrongUse;
