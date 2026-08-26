/**
 * The ONE canonical serialization of a `PlanLedger` revision into the text that gets sent
 * to the model (I-10's "送达内容", UC-12 `deliverPlanToRun`).
 *
 * ⚠ **Single source, used by BOTH sides of the assertion.** `UC-7 confirmPlan` computes
 * `deliveredPlanDigest` by hashing this function's output; `execute-run.ts`'s system-prompt
 * assembly (the ACTUAL injection point, `domain.md` 三·①) calls this SAME function to build
 * the text it prepends. If these ever diverged into two implementations, "the digest matches
 * what was actually sent" would stop being a real assertion and become two things that
 * happen to usually agree — exactly the drift this repo's CLAUDE.md calls out by name.
 */
import { createHash } from "node:crypto";
import type { PlanStep } from "@repo/contracts/plan-control";

const STATUS_LABEL_ZH: Readonly<Record<PlanStep["status"], string>> = {
  pending: "待办", in_progress: "进行中", completed: "已完成",
};

/**
 * `null` when the ledger has no steps (I-10 has nothing to require delivery of at that
 * point — a "no-plan" thread's next run gets no plan block, byte-identical to before
 * plan-control existed).
 */
export function serializePlanForDelivery(ledger: {
  readonly revision: number; readonly steps: readonly PlanStep[];
}): string | null {
  if (ledger.steps.length === 0) return null;
  const lines: string[] = [
    "## 当前计划（用户已确认或正在执行的任务分解）",
    `账本版本 revision=${ledger.revision}。以下步骤与约束来自用户的计划面板，` +
      "约束是必须遵守的额外要求，不是可选建议。",
  ];
  ledger.steps.forEach((step, i) => {
    lines.push(`${i + 1}. [${STATUS_LABEL_ZH[step.status]}] ${step.content}`);
    for (const c of step.constraints) lines.push(`   - 约束：${c.text}`);
  });
  return lines.join("\n");
}

export function planDeliveryDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
