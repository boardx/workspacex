/**
 * Phase 14 F03 (`streaming-transport` 契约束) -- the WS-bus-forwarding side of
 * `execute-run.ts`/`writeback.ts`, extracted into its own file.
 *
 * ## Why extracted rather than inline
 *
 * `execute-run.ts` carries its own machine-checked "stayed thin" regression guard
 * (`tests/agent-run/execute-run-thin-gateway.test.ts`, Phase 14 F01's own line-count
 * assertion) -- the whole point of F01 was shrinking that file down to a single call plus
 * bookkeeping, and a hard ceiling is how that stays true instead of eroding one "just one
 * more thing" at a time. The WS forwarding this feature adds is real, additive behaviour
 * (not a fourth execution branch F01 already ruled out), but it is also not core "forward
 * one call to the kernel" logic -- it is a side channel over what execute-run.ts already
 * knows. Keeping it in its own file lets `execute-run.ts`'s own call sites stay one-line
 * calls into here, honouring that regression guard instead of asking it to grow.
 */
import type { OrgId } from "../../domain/org-id";
import type { AgentRunClock, ModelCallProgressEvent } from "./ports";
import type { RunEventBusPort } from "./run-event-bus";
import { parseWriteTodosSnapshot } from "@repo/contracts/agui-state-events";
import type { PlanLedgerRepository } from "../plan-control/ports";
import { ingestEnginePlanSnapshot } from "../plan-control/ingest-engine-plan-snapshot";

/** The executor awaits this write; transports only project the persisted plan. */
export async function persistToolPlan(repo: PlanLedgerRepository | undefined, orgId: OrgId, threadId: string, event: ModelCallProgressEvent): Promise<void> {
  if (!repo || event.phase === "in_progress" || event.ok === false || event.toolName !== "write_todos") return;
  const snapshot = parseWriteTodosSnapshot(event.toolArgsSummary ?? "");
  if (snapshot) await ingestEnginePlanSnapshot(repo, { orgId, threadId, todos: snapshot.todos });
}

export interface ForwardsToEventBus {
  readonly clock: AgentRunClock;
  readonly events?: RunEventBusPort;
}

/**
 * The one place a `status_change` event goes out on the WS bus, so every call site spells
 * the same fire-and-forget shape (never awaited, never gating the ledger write it
 * accompanies -- I-3).
 */
export function publishStatusChange(
  deps: ForwardsToEventBus,
  orgId: OrgId,
  runId: string,
  status: "running" | "awaiting_tool_permission" | "succeeded" | "failed",
): void {
  deps.events?.publish(orgId, runId, (seq) => ({
    type: "status_change", runId, seq, status, pausedBy: null, emittedAt: deps.clock.now(),
  }));
}

export function publishTokenDelta(
  deps: ForwardsToEventBus,
  orgId: OrgId,
  runId: string,
  delta: string,
): void {
  deps.events?.publish(orgId, runId, (seq) => ({
    type: "token_delta", runId, seq, delta, emittedAt: deps.clock.now(),
  }));
}

/**
 * Forwards ONE `ModelCallProgressEvent` (`execute-run.ts`'s `onProgress` callback -- the
 * SAME event the ledger's `record()` call just wrote a `tool_call` step for) onto the WS
 * bus as `tool_call_start`/`tool_call_end`, plus the two events that naturally accompany a
 * completed tool call: `checkpoint_saved` (a durable point over the step ledger just
 * written -- see this function's own inline doc) and, for `write_todos` specifically,
 * `plan_update`.
 *
 * `ledgerStepSeq` is the seq `record()` just used for this SAME event's ledger row --
 * reused (not a fresh counter) so the checkpoint id it derives is stable across a reconnect
 * (same run, same step ⇒ same `checkpointId`).
 */
export function forwardToolCallProgress(
  deps: ForwardsToEventBus,
  orgId: OrgId,
  runId: string,
  event: ModelCallProgressEvent,
  ledgerStepSeq: number,
): void {
  if (event.toolCallId === undefined || event.toolCallId === null) return;
  const toolCallId = event.toolCallId;

  if (event.phase === "in_progress") {
    deps.events?.publish(orgId, runId, (seq) => ({
      type: "tool_call_start", runId, seq, toolCallId, toolName: event.toolName,
      // R6 后置条件："完整入参，不是截断摘要" -- `toolArgsFull` carries the real object a
      // provider had before truncating it into `toolArgsSummary` (`ports.ts`'s own doc on
      // `ModelCallProgressEvent.toolArgsFull`). `{}` for a provider that hasn't been
      // updated to populate it -- never a thrown error, see that field's own doc.
      args: (event.toolArgsFull ?? {}) as Record<string, unknown>,
      emittedAt: deps.clock.now(),
    }));
    return;
  }

  deps.events?.publish(orgId, runId, (seq) => ({
    type: "tool_call_end", runId, seq, toolCallId,
    // 见 `execute-run.ts` `record()` 这次调用自己的 `failureCode: null`：这一层目前对
    // `tool_call` 步骤只有"完成"一种终态记录，不区分工具执行本身是否失败——既有限制，
    // 不是本 feature 引入的倒退（`ModelCallProgressEvent` 本身也没有一个 `ok` 字段）。
    ok: event.ok !== false,
    result: event.toolResultFull ?? null,
    emittedAt: deps.clock.now(),
  }));

  // Phase 14 F03 -- `checkpoint_saved`: a durable, resumable point over the append-only
  // step ledger `execute-run.ts`'s `record()` call just wrote. NOT a literal LangGraph
  // checkpoint id from `deep-agent-service` -- `ModelCallCompletion` does not surface one
  // yet (R10 notes the DEPENDENCY on a real checkpointer; this gateway does not yet receive
  // one to relay). Deterministic and stable across a reconnect (`${runId}:${ledgerStepSeq}`),
  // so a client cannot observe it change identity between two subscriptions of the same run.
  deps.events?.publish(orgId, runId, (seq) => ({
    type: "checkpoint_saved", runId, seq, checkpointId: `${runId}:${ledgerStepSeq}`,
    emittedAt: deps.clock.now(),
  }));

  // Phase 14 F03 (`plan_update`, R3 步骤 2) -- `write_todos` 的完整快照，复用
  // `agui-state-events.ts` 既有的 `AguiTodosSnapshot` 解析纪律（不新造第二套 todo 快照
  // 形状）。解析失败（非法 JSON、非本仓约定的形状）⇒ 不发事件，同
  // `parseWriteTodosSnapshot` 自己文档的"反空转"纪律：宁可这次没有 plan_update，也不喂
  // 客户端一个编造的快照。
  if (event.toolName === "write_todos" && event.toolArgsSummary !== null) {
    const plan = parseWriteTodosSnapshot(event.toolArgsSummary);
    if (plan !== null) {
      deps.events?.publish(orgId, runId, (seq) => ({
        type: "plan_update", runId, seq, plan, emittedAt: deps.clock.now(),
      }));
    }
  }
}
