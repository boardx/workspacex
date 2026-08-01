/**
 * F60 -- UC-4.4 阶段二：agent 互调调用链（`recordCallChainHop`）—— 深度上限（O-36：2，
 * I-46）+ 被调方不继承主调方权限（I-47）+ 需批准的动作暂停等批准（R3 步骤 4）。
 *
 * `user_visible_behavior` 摘录: 「agent 互调记录调用链与深度（上限 2，深度 3 在第 3 层被
 * 终止留痕），被调方不继承主调方权限、需批准的动作暂停等批准。」
 *
 * ## Why "does not inherit" is a fact about this function's SIGNATURE, not a runtime check
 * `RecordCallChainHopInput` has no field carrying the caller's permission result -- there is no
 * parameter a caller could pass the caller's own `ThreeLayerResult` through into the callee's
 * admission decision. `calleePermission` must be produced by re-running F56's
 * `intersectAgentPermission` against the CALLEE's own three facts (its own MCP scope, its own
 * whitelist entry, its own task package). That independence is what I-47 requires; this module
 * does not re-derive permission logic, it only refuses to accept a shortcut around it.
 *
 * ## Why depth is checked first, before callee-running and callee-permission
 * The contract's own error tuple order (`CALL_DEPTH_EXCEEDED`, `EFFECTIVE_PERMISSION_DENIED`,
 * `AGENT_DISABLED`, `PROVENANCE_WRITE_FAILED`) puts depth first. Checking depth before anything
 * else about the callee means a depth-3 hop is terminated "在第 3 层" (I-46) regardless of
 * whether that third agent would otherwise have been reachable and authorized -- the recursion
 * guard is unconditional, not "only when the callee would also have failed anyway".
 *
 * ## Why every terminating branch still calls `writer.write` before throwing
 * R3 step 5 / E5: "未获批准即终止的调用链同样留痕（已拒绝 / 已取消）" -- termination is not
 * silent. And per I-44's sibling guarantee for call chains: if THAT audit write itself fails,
 * the whole hop must fail with `PROVENANCE_WRITE_FAILED`, same hard precondition as
 * `tool-call-audit.ts`'s `recordToolCall`.
 */
import { agentRuntime as A, thresholds as T } from "@repo/contracts";
import type { z } from "zod";
import type { ThreeLayerResult } from "./three-layer-permission";

/** O-36 第 4 项：唯一有原型依据的裁决值。**不得在别处另抄字面量 `2`。** */
export const CALL_CHAIN_MAX_DEPTH: number = T.requireValue<number>(
  T.THRESHOLDS.agentCallChainMaxDepth,
  "agentCallChainMaxDepth",
);

export type CallChainApprovalStateT = z.infer<typeof A.CallChainApprovalState>;

export class CallDepthExceededError extends Error {
  constructor(public readonly depth: number) {
    super(`CALL_DEPTH_EXCEEDED depth=${depth}（上限 ${CALL_CHAIN_MAX_DEPTH}）`);
    this.name = "CallDepthExceededError";
  }
}

export class EffectivePermissionDeniedError extends Error {
  constructor() {
    super("EFFECTIVE_PERMISSION_DENIED");
    this.name = "EffectivePermissionDeniedError";
  }
}

export class AgentDisabledError extends Error {
  constructor() {
    super("AGENT_DISABLED");
    this.name = "AgentDisabledError";
  }
}

export class ProvenanceWriteFailedError extends Error {
  constructor() {
    super("PROVENANCE_WRITE_FAILED");
    this.name = "ProvenanceWriteFailedError";
  }
}

/** One audited fact about this hop's outcome; the port the application layer implements. */
export interface CallChainAuditWriter {
  write(event: {
    readonly kind: "hop" | "depth-exceeded" | "callee-disabled" | "permission-denied";
    readonly callerAgentId: string;
    readonly calleeAgentId: string;
    readonly taskName: string;
    readonly depth: number;
    readonly tokens: number;
    readonly approvalState: CallChainApprovalStateT;
  }): { readonly ok: boolean };
}

export interface RecordCallChainHopInput {
  readonly callerAgentId: string;
  readonly calleeAgentId: string;
  readonly taskName: string;
  readonly depth: number;
  readonly tokens: number;
  /** Whether the action the callee is about to take requires human approval (R3 step 4). */
  readonly requiresApproval: boolean;
  /** Whether the callee agent is currently `运行中` (E4). */
  readonly calleeRunning: boolean;
  /**
   * The callee's OWN three-layer permission result (F56 `intersectAgentPermission`), computed
   * independently of the caller. ⚠ There is deliberately no `callerPermission` field on this
   * interface -- see file header.
   */
  readonly calleePermission: ThreeLayerResult;
}

export interface RecordCallChainHopOutput {
  readonly chainId: string;
  readonly approvalState: CallChainApprovalStateT;
}

function makeChainId(input: {
  callerAgentId: string;
  calleeAgentId: string;
  depth: number;
}): string {
  return `chain-${input.callerAgentId}-${input.calleeAgentId}-d${input.depth}`;
}

export function recordCallChainHop(
  input: RecordCallChainHopInput,
  writer: CallChainAuditWriter,
): RecordCallChainHopOutput {
  if (input.depth > CALL_CHAIN_MAX_DEPTH) {
    const written = writer.write({
      kind: "depth-exceeded",
      callerAgentId: input.callerAgentId,
      calleeAgentId: input.calleeAgentId,
      taskName: input.taskName,
      depth: input.depth,
      tokens: input.tokens,
      approvalState: "已取消",
    });
    if (!written.ok) throw new ProvenanceWriteFailedError();
    throw new CallDepthExceededError(input.depth);
  }

  if (!input.calleeRunning) {
    const written = writer.write({
      kind: "callee-disabled",
      callerAgentId: input.callerAgentId,
      calleeAgentId: input.calleeAgentId,
      taskName: input.taskName,
      depth: input.depth,
      tokens: input.tokens,
      approvalState: "已取消",
    });
    if (!written.ok) throw new ProvenanceWriteFailedError();
    throw new AgentDisabledError();
  }

  if (!input.calleePermission.allowed) {
    const written = writer.write({
      kind: "permission-denied",
      callerAgentId: input.callerAgentId,
      calleeAgentId: input.calleeAgentId,
      taskName: input.taskName,
      depth: input.depth,
      tokens: input.tokens,
      approvalState: "已拒绝",
    });
    if (!written.ok) throw new ProvenanceWriteFailedError();
    throw new EffectivePermissionDeniedError();
  }

  const approvalState: CallChainApprovalStateT = input.requiresApproval ? "已暂停" : "人已批准";
  const written = writer.write({
    kind: "hop",
    callerAgentId: input.callerAgentId,
    calleeAgentId: input.calleeAgentId,
    taskName: input.taskName,
    depth: input.depth,
    tokens: input.tokens,
    approvalState,
  });
  if (!written.ok) throw new ProvenanceWriteFailedError();

  return { chainId: makeChainId(input), approvalState };
}
