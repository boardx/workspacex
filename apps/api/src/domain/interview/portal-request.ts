/**
 * `domain/interview/portal-request.ts` —— F96（uc-6-6 R3）：自助门户三项能力的**纯计算**部分。
 *
 * 三件事分别对应：
 *   · 改选择 —— `diffConsentBits`：算出「收紧」与「放宽」两个不相交的键集合。
 *     **收紧才触发撤回**，放宽只是写一条新的历史版本，不产生任何下游副作用（R7：不追溯）。
 *   · 要删除 —— `buildErasureDisclosure`：删除确认页**必须含四段说明**（会删/不会删/时限/
 *     不可逆），缺一即失败（V10）。时限文案的数字**唯一来自** `WITHDRAWAL_SLA_MS`
 *     （与 F89 的 `domain/interview/withdrawal.ts` 同一事实源），不在这里另写 5 / 30。
 *   · 状态可查 —— `deriveErasureRequestView` / `deriveConsentChangeRequestView`：
 *     把撤回单据的五步快照翻译成受访者能看懂的一句话状态 + 预计完成时间（V6）。
 *
 * ⚠ 「不会删」的清单依赖 [待定 D-9] 法定留存清单（合规外部输入），本文件写的是
 *   R8 界面线索给出的**已确认**两项（审计留痕、已签字决策本身），不编造更多。
 */
import { WITHDRAWAL_SLA_MS } from "@repo/contracts/org-admin";
import { interview } from "@repo/contracts";
import { CONSENT_ITEMS } from "@repo/contracts/consent-item";
import type { z } from "zod";
import type { WithdrawalStepRecord } from "./withdrawal";

/** 派生自契约的 `interview.ConsentKey`，不重新声明（single-source，同 `subject.ts` 的立场）。 */
export type ConsentKeyValue = z.infer<typeof interview.ConsentKey>;
/** 派生自契约的 `interview.ConsentBits`。 */
export type ConsentBits = z.infer<typeof interview.ConsentBits>;

/**
 * 四位的固定顺序。
 * ⚠ **不在这里另列一遍**（#533）：顺序本身属契约，唯一事实源是 `consent-item.ts` 的
 *   `CONSENT_ITEMS`。原来这里写着「全仓只在这里声明一次」——那句话当时就是假的
 *   （契约两处 + `consent-token-ports.ts` + 本处，共四份），现改为直接引用。
 */
export const ALL_CONSENT_KEYS: readonly ConsentKeyValue[] = CONSENT_ITEMS;

export interface ConsentBitsDiff {
  /** true → false：即时生效并触发撤回（R7）。 */
  readonly tightened: readonly ConsentKeyValue[];
  /** false → true：即时生效，但**不追溯**（R7）——本函数只报告，不产生任何数据。 */
  readonly loosened: readonly ConsentKeyValue[];
}

export function diffConsentBits(previous: ConsentBits, next: ConsentBits): ConsentBitsDiff {
  const tightened: ConsentKeyValue[] = [];
  const loosened: ConsentKeyValue[] = [];
  for (const key of ALL_CONSENT_KEYS) {
    const was = previous[key];
    const now = next[key];
    if (was === now) continue;
    if (was && !now) tightened.push(key);
    else loosened.push(key);
  }
  return { tightened, loosened };
}

export interface ErasureDisclosure {
  readonly willDelete: readonly string[];
  readonly willNotDelete: readonly string[];
  readonly slaText: string;
  readonly irreversible: true;
}

/**
 * R8 删除确认页的四段说明。⚠ `slaText` 的分钟/天数从 `WITHDRAWAL_SLA_MS` 现算，
 * 不写死「5 分钟」「30 天」这两个字面量——防止两处 SLA 数值某天各自漂移。
 */
export function buildErasureDisclosure(): ErasureDisclosure {
  const logicalMinutes = WITHDRAWAL_SLA_MS.logicalRetire / 60_000;
  const physicalDays = WITHDRAWAL_SLA_MS.physicalDelete / (24 * 60 * 60_000);
  return {
    willDelete: ["录音", "文字稿", "你的引述", "由你的话产生的证据关联"],
    willNotDelete: [
      "法定留存要求的审计留痕",
      "已签字的决策本身（其结论不会被自动改写，仅通知拍板人复核）",
    ],
    slaText:
      `逻辑失效 ≤${logicalMinutes} 分钟内完成；物理删除 ≤${physicalDays} 天内完成，` +
      `完成后会向你发送可核验的删除回执。` +
      `此操作不可逆——删除后即使你重新授权，也无法恢复已删除的数据。`,
    irreversible: true,
  };
}

/** 撤回单据第 05 步是否已完成——决定「删除」这一条 SubjectRequest 该显示什么状态。 */
function step(steps: readonly WithdrawalStepRecord[], no: 1 | 2 | 3 | 4 | 5): WithdrawalStepRecord | undefined {
  return steps.find((s) => s.no === no);
}

/**
 * 把撤回单据的五步快照翻译成「要求删除全部记录」这条请求该显示的一句话状态 + 预计完成时间。
 * ⚠ **不能只给一句「已提交」就没有下文**（V6）——逻辑失效已完成之后，仍需带出
 *   物理删除的预计完成时间，直到第 05 步真正 `done`。
 */
export function deriveErasureRequestView(
  steps: readonly WithdrawalStepRecord[],
): { readonly status: string; readonly etaAt: string | null } {
  const step5 = step(steps, 5);
  if (step5?.state === "done") {
    return { status: "删除已完成", etaAt: null };
  }
  const step4 = step(steps, 4);
  const reviewClause = step4?.state === "needs-human" ? "· 已生成拍板人复核任务" : "";
  return {
    status: `删除请求已受理 · 逻辑失效已完成${reviewClause} · 物理删除处理中`,
    etaAt: step5?.dueAt ?? null,
  };
}

/**
 * 把「改选择」这条请求翻译成状态：没有触发撤回（纯放宽，或没有任何变化）即时算完成；
 * 触发了撤回的（收紧）要跟着撤回单据的进度走，直到物理删除完成。
 */
export function deriveConsentChangeRequestView(
  triggeredSteps: readonly WithdrawalStepRecord[] | null,
): { readonly status: string; readonly etaAt: string | null } {
  if (triggeredSteps === null) return { status: "变更已完成", etaAt: null };
  const step5 = step(triggeredSteps, 5);
  if (step5?.state === "done") return { status: "变更已完成，撤回数据流已处理完毕", etaAt: null };
  return { status: "变更已受理 · 撤回数据流处理中", etaAt: step5?.dueAt ?? null };
}
