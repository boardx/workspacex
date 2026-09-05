/**
 * Phase 14 F12 —— `artifacts-steering` 契约束 UC-4 `interject`（R3' 中途插话）的前端
 * 真实 API 薄封装。后端是 F11 的 `POST /agent-runs/:runId/interject`
 * （`apps/api/src/interface/controllers/agent-run.controller.ts`）。
 *
 * ## 类型全部走 `z.infer`（`lint-contract-source` 要求）
 *
 * 这里**不重新声明**请求/响应的任何字段：`InterjectInput`/`InterjectOutput`/
 * `InterjectError` 都从 `@repo/contracts` 的 `artifactsSteering` 派生，路径与方法也从
 * `operations.interject` 取，不各写一份字面量——与 `agent-kernel-stream.ts` 取
 * `operations.subscribeRunEvents.path` 是同一条纪律。
 *
 * ## 错误映射只做一次
 *
 * 控制器把契约的两种失败码落成 HTTP 状态：`NOT_VISIBLE` ⇒ 404（I-3，不确认存在性；
 * R5"不是发起者"也折进这一支），`RUN_NOT_RUNNING` ⇒ 409 且信封带
 * `reasonCode: "AGENT_RUN_NOT_RUNNING"`。`classifyInterjectFailure` 是这个映射在前端的
 * **唯一**落点——组件只认契约的 `InterjectError` 枚举值，不在 JSX 里比对 HTTP 状态码。
 */
import { artifactsSteering as AS } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, ApiError } from "./api-client";

export type InterjectInput = z.infer<typeof AS.InterjectInput>;
export type InterjectOutput = z.infer<typeof AS.InterjectOutput>;
export type InterjectError = z.infer<typeof AS.InterjectError>;

/** 组件依赖的最小函数形状，测试用注入替身，生产用 `interjectAgentRun`。 */
export type InterjectFn = (input: InterjectInput) => Promise<InterjectOutput>;

const INTERJECT_OP = AS.operations.interject;

/** 控制器 409 信封里的 `reasonCode`（`agent-run.controller.ts` `interject()`）。 */
const NOT_RUNNING_REASON_CODE = "AGENT_RUN_NOT_RUNNING";

export function interjectPath(runId: string): string {
  return INTERJECT_OP.path.replace(":runId", encodeURIComponent(runId));
}

/**
 * 发送一条插话。请求体只有 `text`（`runId` 走路径参数，契约 `in` 的 `runId` 对应
 * `:runId`，不重复塞进 body——`lint-body-path-param-leak` 门控的同一条规则）。
 */
export async function interjectAgentRun(
  input: InterjectInput,
  opts: { readonly sessionToken?: string | null; readonly signal?: AbortSignal } = {},
): Promise<InterjectOutput> {
  // `INTERJECT_OP.method` 在契约里没有 `as const`，类型是宽的 `string`；这里的字面量
  // 与契约 `operations.interject.method` 一致，由测试机械比对，不是第二份声明。
  return apiRequest<InterjectOutput>(interjectPath(input.runId), {
    method: "POST",
    body: { text: input.text },
    sessionToken: opts.sessionToken,
    signal: opts.signal,
  });
}

/**
 * 把一次失败归到契约的 `InterjectError`；不属于契约两种失败码的（网络错误、5xx、
 * 非 JSON 响应……）返回 `null`，由调用方按"未知失败"处理，不猜测语义。
 */
export function classifyInterjectFailure(error: unknown): InterjectError | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 404) return "NOT_VISIBLE";
  if (error.status === 409 && error.reasonCode === NOT_RUNNING_REASON_CODE) return "RUN_NOT_RUNNING";
  return null;
}

/** 用户可读的失败文案——枚举的每个值都有一条，缺一条 TypeScript 会先红。 */
export const INTERJECT_FAILURE_COPY: Readonly<Record<InterjectError, string>> = {
  NOT_VISIBLE: "找不到这个任务，或它不是由你发起的，插话未被接受。",
  RUN_NOT_RUNNING: "任务已不在执行中，这条插话没有被接受；等它回到执行中再试。",
};

export const INTERJECT_UNKNOWN_FAILURE_COPY = "插话没有发出去，请稍后再试。";
