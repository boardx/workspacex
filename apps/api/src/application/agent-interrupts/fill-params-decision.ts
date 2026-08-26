/**
 * F214（`agent-interrupts` 契约束）—— UC-2 `fillRunParams` 的 `appliedTo` 应用规则
 * （`usecases.md` UC-2 + `domain.md` 缺口 AI-1）。
 *
 * ## 这个文件做什么、不做什么——一处刻意收窄的范围边界
 *
 * `packages/contracts/src/agent-interrupts.ts` 的 `FillParamsDecision` 已经在契约层
 * 强制了 `appliedTo: "full-rerun" | "ledger-only"` 二选一（F212）。本文件是这条契约
 * 在 application 层的**唯一消费点**：把一份已通过 zod 校验的 `FillParamsDecision`
 * 翻译成"这次 resume 该怎么办"的纯函数决策——**不**直接改写
 * `apps/api/src/application/agent-run/decide-agent-run.ts` 共享的
 * `POST /agent-runs/:runId/decision` 端点契约（`wave2Runtime.operations.decideAgentRun.in`
 * 是 `.strict()` 的，且被 `call_skill` 等**全部** HITL 类型共用）。
 *
 * **为什么不直接扩展那个共享端点**：`appliedTo` 是 `fill_params` 专属字段，把它塞进
 * 一个所有 HITL 类型共用的 `.strict()` 契约，要么放宽成"任意工具都能传 appliedTo"
 * （契约变宽，`call_skill` 的裁决路径也要跟着重新审查），要么在契约里按工具名做
 * 条件校验（契约本身失去"一种输入形状"的简单性）——两者都超出"让 fill_params 的
 * appliedTo 落地"这一件事本身，属于影响面更大的独立改动，不在本 issue 单方面做，
 * 登记为后续任务（同 `agent-interrupts.ts` 文件头"Python 侧 `@tool` 是下一个 feature"
 * 同一处置纪律）。
 *
 * ⇒ 本文件把 `appliedTo` 的语义**先在 application 层钉成可判定的纯函数**：
 *   - `full-rerun`：这次 resume **携带**编辑后的 `fields`（对应 `decide-agent-run.ts`
 *     既有的 `editAndRequeue` 路径——从最近 checkpoint 全量续跑，`domain.md` AI-1 已
 *     如实标注"不是精确子集重跑"）。
 *   - `ledger-only`：这次 resume **不携带**编辑后的值（等价于用原始 args 放行，
 *     当前待批步骤不因这次编辑而改变行为），编辑后的字段被记进
 *     `ledgerFields`——`usecases.md` UC-2 原文"run 活跃时只落账本，下一轮送达"里
 *     "落账本"这一半在这里落地为一个可读取、可断言的返回值；"下一轮送达"（把账本
 *     内容真正喂给某个未来 run）依赖 `domain.md` AI-1 同一个未证实的 checkpoint fork
 *     能力，本文件不冒充自己解决了它——调用方目前只能"记下来"，不能自动"用上"。
 */
import type { FillParamsDecision } from "@repo/contracts/agent-interrupts";

/** `ledger-only` 时被记账、暂不生效的字段——`usecases.md` UC-2「落账本」那一半的可判定形状。 */
export interface FillParamsLedgerField {
  readonly name: string;
  readonly value: unknown;
}

export type FillParamsResumePlan =
  | { readonly kind: "approve-original" }
  | { readonly kind: "resume-with-edits"; readonly editedArgs: { readonly fields: readonly { name: string; value?: unknown }[] } }
  | {
      readonly kind: "ledger-only";
      /** resume 时仍用原始 args 放行——这次待批步骤不因编辑而改变行为。 */
      readonly resume: { readonly kind: "approve-original" };
      readonly ledgerFields: readonly FillParamsLedgerField[];
    };

/**
 * `FillParamsDecision` → 这次该怎么 resume。纯函数，不落库、不触发任何副作用——
 * 调用方负责把返回值分别接到 `decide-agent-run.ts` 的 approve/edit 两条既有路径，
 * 以及（`ledger-only` 分支）一个尚待建的账本落点（登记为后续任务，见文件头）。
 */
export function planFillParamsResume(decision: FillParamsDecision): FillParamsResumePlan {
  if (decision.decision === "approve") {
    return { kind: "approve-original" };
  }
  if (decision.appliedTo === "full-rerun") {
    return { kind: "resume-with-edits", editedArgs: { fields: decision.editedArgs.fields } };
  }
  // decision.appliedTo === "ledger-only"
  return {
    kind: "ledger-only",
    resume: { kind: "approve-original" },
    ledgerFields: decision.editedArgs.fields.map((f) => ({ name: f.name, value: f.value })),
  };
}
