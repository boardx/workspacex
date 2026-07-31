/**
 * 用例：试跑一场（F21 / 契约 `templates.startTrialRun`，发布前置条件之一 · AC3a）。
 *
 * 产生一条 `kind: "trial-run"` 的 `BlueprintBinding`——与 F18 `designer-shell.ts` 里
 * 「用过 N 次」`countAppliedProjects` 读的是同一张绑定表，只是那边过滤掉这一种、
 * 这里恰恰只产出这一种（I-22：试跑不计入用过 N 次）。
 *
 * ⚠ 调用方必须把返回的 `binding` 追加进蓝本的绑定集合、并把结果喂给
 * `trial-run-gate.ts` 的 `hasTrialRun`——本用例本身不持久化，持久化是仓储的事。
 */

import { hasTrialRun, type TrialRunGateVerdict } from "../../domain/templates/trial-run-gate";
import type { BlueprintBinding } from "../../domain/templates/designer-shell";

export interface StartTrialRunResult {
  readonly trialRunId: string;
  /** 追加进蓝本绑定集合的那一条。⚠ kind 恒为 "trial-run"，不计入 appliedProjectCount */
  readonly binding: BlueprintBinding;
  /** 见 `trial-run-gate.ts` 头注：判据挂在绑定表上，今天等价于「创建即算」（D-6 未裁） */
  readonly trialRunDone: true;
}

export function startTrialRun(trialRunId: string): StartTrialRunResult {
  return { trialRunId, binding: { kind: "trial-run" }, trialRunDone: true };
}

/** 把「已有的绑定集合 + 这次新试跑」喂给门槛判定——供调用方在同一次请求里立即复核。 */
export function verifyTrialRunSatisfiesGate(
  existingBindings: readonly BlueprintBinding[],
  result: StartTrialRunResult,
): TrialRunGateVerdict {
  return { blocked: !hasTrialRun([...existingBindings, result.binding]) };
}
