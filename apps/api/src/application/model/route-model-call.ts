/**
 * `routeModelCall` 用例（F51 / UC-20.3，机密硬路由的唯一执行点）。
 *
 * 决策本身（候选集收窄、拒绝码、绕过判定）全部在 `../../domain/model/route-call.ts`
 * 的纯函数 `decideModelRoute` 里；这一层只做三件事：
 *   1. 取数——机密性判据只能来自 Context Pack（`ConfidentialityReader`，I-13 / X-7 / I-50：
 *      唯一取数入口是 `contextPackId`，不得自行另查一套库）；
 *   2. 调用领域决策；
 *   3. 落痕——**拒绝也要写 `RoutingDecision`**（契约第 6 步），且 `bypassAttempt` 的拒绝
 *      额外计入越权拦截计数（契约第 7 步，`BypassAuditSink`）；写不进去本身是硬前置
 *      失败（`PROVENANCE_WRITE_FAILED`，I-44）——调用不允许「成功但没留痕」。
 *
 * ⚠ 本用例不做任何"重新判断机密性"的事——`ConfidentialityReader` 是应用层与
 *   Context Pack 之间唯一的读口，本文件不缓存它跨调用（R9：只在同一次调用内有效）。
 */
import { randomUUID } from "node:crypto";
import {
  decideModelRoute,
  type ConfidentialitySignal,
  type RouteVerdict,
} from "../../domain/model/route-call";
import type { SelectableCandidateRow } from "../../domain/model/selectable";
import { agentRuntime as C } from "@repo/contracts";
import type { z } from "zod";

/** `routeModelCall.in.taskKind` — derived, not restated (same discipline as `registry.ts`). */
type TaskKind = z.infer<typeof C.TaskKind>;

/** 应用层与 Context Pack 之间关于机密性的唯一读口（I-13 / I-50）。 */
export interface ConfidentialityReader {
  /**
   * 逐项判定这一次调用的上下文是否含机密材料。
   * ⚠ 标记缺失或冲突时返回 `"unknown"`，领域层会从严按含机密处理（I-12）——
   *   本接口不得自行"从宽"折成 `false`。
   */
  read(contextPackId: string): Promise<ConfidentialitySignal>;
}

/** 候选池读口——与 `listSelectableModels`（F50）共用同一份 `SelectableCandidateRow`。 */
export interface RouteModelPoolReader {
  listCandidates(orgId: string): Promise<readonly SelectableCandidateRow[]>;
}

/** 一次路由决策的落痕记录（对应契约 `RoutingDecision`）。 */
export interface RoutingDecisionRecord {
  readonly decisionId: string;
  readonly callId: string;
  readonly containsConfidential: boolean;
  readonly candidateModelIds: readonly string[];
  readonly selectedModelId: string | null;
  readonly outcome: "routed" | "rejected";
  readonly reason: string;
  readonly at: string;
}

/**
 * 决策留痕。⚠ **拒绝也要写**（I-44 硬前置的另一面：写不进去 ⇒ 本次调用必须失败，
 * 不允许「调用被拒但这件事本身没留痕」）。
 */
export interface RoutingDecisionSink {
  record(entry: RoutingDecisionRecord): Promise<void>;
}

/**
 * 越权拦截计数（UC-4.4，后台总览「越权调用尝试 …… 已拦截 N 次」的数据来源）。
 * ⚠ 只有 `bypassAttempt === true` 的拒绝才计数——候选池恰好为空这类正常拒绝不算绕过。
 */
export interface BypassAuditSink {
  recordBypassAttempt(entry: {
    readonly callId: string;
    readonly orgId: string;
    readonly requestedModelId: string;
    readonly code: string;
  }): Promise<void>;
}

export interface RouteModelCallClock {
  now(): string;
  newDecisionId(): string;
}

export const systemClock: RouteModelCallClock = {
  now: () => new Date().toISOString(),
  newDecisionId: () => randomUUID(),
};

export interface RouteModelCallPorts {
  readonly pool: RouteModelPoolReader;
  readonly confidentiality: ConfidentialityReader;
  readonly decisions: RoutingDecisionSink;
  readonly bypassAudit: BypassAuditSink;
  readonly clock?: RouteModelCallClock;
}

export interface RouteModelCallInput {
  readonly orgId: string;
  readonly callId: string;
  readonly contextPackId: string;
  readonly requestedModelId: string | null;
  /** 契约里带着，但"含客户机密→禁止降级"的判据取自 `containsConfidential`，不是这个标签本身。 */
  readonly taskKind: TaskKind;
}

export type RouteModelCallErrorCode =
  | "NO_LOCAL_MODEL_AVAILABLE"
  | "CONFIDENTIAL_ROUTE_VIOLATION"
  | "MODEL_NOT_SELECTABLE"
  | "COMPOSITE_MEMBER_DISABLED";

/** 契约 `routeModelCall` 的失败态——携带足够信息供接口层拼文案，而不是裸字符串。 */
export class RouteModelCallError extends Error {
  constructor(
    readonly code: RouteModelCallErrorCode,
    readonly detail: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = "RouteModelCallError";
  }
}

export interface RouteModelCallOutput {
  readonly selectedModelId: string;
  readonly decisionId: string;
  /** 含机密时恒为 null——含机密禁止降级（domain 层保证） */
  readonly degradedTo: string | null;
}

function reasonFor(verdict: RouteVerdict): string {
  if (verdict.ok) {
    return verdict.containsConfidential
      ? "含机密，路由至自托管模型"
      : "未含机密，按可选范围选定模型";
  }
  switch (verdict.code) {
    case "NO_LOCAL_MODEL_AVAILABLE":
      return "本次内容含客户机密，需本地模型处理，当前无可用本地模型";
    case "CONFIDENTIAL_ROUTE_VIOLATION":
      return "本次含机密，仅本地模型可选，拒绝所请求的闭源模型";
    case "COMPOSITE_MEMBER_DISABLED":
      return `所请求的组合因成员停用不可用：${verdict.blockedByMemberIds.join("、")}`;
    case "MODEL_NOT_SELECTABLE":
      return "所请求的模型当前不可选（未启用或不存在）";
  }
}

/**
 * `routeModelCall`（UC-20.3）。
 *
 * ⚠ 判定顺序、拒绝码、绕过判定全部委托给 `decideModelRoute`——本函数不得重复判定。
 * ⚠ **记录中不得包含机密内容原文**（I-13）：`candidateModelIds` / `selectedModelId` 都是
 *   模型 id，不是被路由内容本身；调用方若把机密原文塞进 `reason` 之外的字段，
 *   那是调用方的错误，不是本用例的契约。
 */
export async function routeModelCall(
  input: RouteModelCallInput,
  ports: RouteModelCallPorts,
): Promise<RouteModelCallOutput> {
  const clock = ports.clock ?? systemClock;
  const [pool, confidentiality] = await Promise.all([
    ports.pool.listCandidates(input.orgId),
    ports.confidentiality.read(input.contextPackId),
  ]);

  const verdict = decideModelRoute({
    pool,
    requestedModelId: input.requestedModelId,
    confidentiality,
  });

  const decisionId = clock.newDecisionId();
  const at = clock.now();
  const reason = reasonFor(verdict);

  // 拒绝也要写（I-44）：先落痕，再抛错——这样"写失败"这件事本身可以浮现为
  // PROVENANCE_WRITE_FAILED，而不是被一个 catch-and-ignore 吞掉。
  await ports.decisions.record({
    decisionId,
    callId: input.callId,
    containsConfidential: verdict.containsConfidential,
    candidateModelIds: verdict.candidateModelIds,
    selectedModelId: verdict.ok ? verdict.selectedModelId : null,
    outcome: verdict.ok ? "routed" : "rejected",
    reason,
    at,
  });

  if (!verdict.ok) {
    if (verdict.bypassAttempt && verdict.requestedModelId !== null) {
      await ports.bypassAudit.recordBypassAttempt({
        callId: input.callId,
        orgId: input.orgId,
        requestedModelId: verdict.requestedModelId,
        code: verdict.code,
      });
    }
    throw new RouteModelCallError(verdict.code, {
      requestedModelId: verdict.requestedModelId,
      candidateModelIds: verdict.candidateModelIds,
      blockedByMemberIds: verdict.blockedByMemberIds,
      reason,
    });
  }

  return { selectedModelId: verdict.selectedModelId, decisionId, degradedTo: verdict.degradedTo };
}
