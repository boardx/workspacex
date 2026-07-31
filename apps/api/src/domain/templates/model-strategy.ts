/**
 * 模型策略三条 lane 的领域校验（F20 / `uc-2-1` R3 步骤 5, R7「模型与配额」, I-21）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。三条 lane（`onsite` / `postSession` /
 * `confidential`）该选哪个模型是应用层的事，这里只判**这次选择合法不合法**。
 *
 * ## 为什么复用 `domain/model/selectable.ts`，不另写一份「已启用」判据
 *
 * `selectableModels` 已经是「已启用集合」与「机密只收 self-hosted」的唯一实现
 * （F50 · uc-20-2 可选范围过滤器），且 `routeModelCall`（`agent-runtime` 束）与它
 * 共用同一条判据。本束若再写一遍「机密材料只能选本地模型」，就是本仓第十次
 * 「同一事实声明在两处」——两处判据迟早会在某次改动里读到不同的结果。
 * ⇒ 本文件只组合它的输出，不重新判定「什么算已启用」「什么算机密可选」。
 *
 * ## 两种拒绝的区别（契约 `setModelStrategy.err`）
 *
 * - `MODEL_NOT_ENABLED`：这个 `ModelRef` 根本不在「已启用」集合里（任何 lane）。
 * - `CONFIDENTIAL_ROUTE_VIOLATION`：模型本身已启用，但 `confidential` lane
 *   选了一个非 `self-hosted` 的模型——**这是隐私硬路由违规，不是「没启用」**，
 *   两者在契约里是不同的码，判定顺序也必须先查启用、再查机密路由（否则一个
 *   「没启用的云端模型」会被错误地报成路由违规而不是没启用）。
 */
import type { z } from "zod";
import { templates } from "@repo/contracts";
import { selectableModels, type SelectableCandidateRow } from "../model/selectable";

export type ModelLane = z.infer<typeof templates.ModelLane>;

export interface ModelStrategyLanes {
  readonly onsite: string;
  readonly postSession: string;
  readonly confidential: string;
}

export type ModelStrategyVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "MODEL_NOT_ENABLED" | "CONFIDENTIAL_ROUTE_VIOLATION";
      readonly lane: ModelLane;
      readonly modelId: string;
    };

const LANES: readonly ModelLane[] = ["onsite", "postSession", "confidential"];

/**
 * 校验三条 lane 的分派是否都合法。
 *
 * 判定顺序（顺序本身是契约行为，见文件头）：
 * 1. 每条 lane 的 `ModelRef` 必须在「已启用」集合内（`purpose: null`），
 *    否则 `MODEL_NOT_ENABLED`。
 * 2. `confidential` lane 额外要求命中「已启用 ∩ self-hosted」子集
 *    （`purpose: "confidential"`），否则 `CONFIDENTIAL_ROUTE_VIOLATION`。
 *
 * ⚠ 只报**第一个**踩到的问题，不做「收集全部错误」——契约 `setModelStrategy` 的
 * `err` 是单值枚举，一次调用只对应一个失败码。
 */
export function validateModelStrategy(
  lanes: ModelStrategyLanes,
  pool: readonly SelectableCandidateRow[],
): ModelStrategyVerdict {
  const enabledIds = new Set(selectableModels(pool, null).map((row) => row.modelId));
  const confidentialIds = new Set(selectableModels(pool, "confidential").map((row) => row.modelId));

  for (const lane of LANES) {
    const modelId = lanes[lane];
    if (!enabledIds.has(modelId)) {
      return { ok: false, code: "MODEL_NOT_ENABLED", lane, modelId };
    }
    if (lane === "confidential" && !confidentialIds.has(modelId)) {
      return { ok: false, code: "CONFIDENTIAL_ROUTE_VIOLATION", lane, modelId };
    }
  }
  return { ok: true };
}
