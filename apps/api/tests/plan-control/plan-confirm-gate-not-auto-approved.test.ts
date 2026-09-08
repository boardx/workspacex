/**
 * issue #3132（B7）—— **网关不得替用户点确认**。
 *
 * ## 这条用例守的是一个会静默吞掉整道门的真实陷阱
 *
 * `write_todos` 在 `tool-risk-tier.ts` 里是 **L0**（记账工具，没有用户可见的外部副作用
 * ——那个分级是对的）。而 `handleInterruptedToolCall` 的既有判定是
 * 「非 L2 ⇒ 已授权 ⇒ `approveAndRequeue` 自动放行」。
 *
 * 所以在引擎侧谓词写对、契约 phase 判对、前端组件都挂对之后，run **仍然**会一路跑完：
 * 网关在这一层替用户点了确认，前端连一帧 `planning` 都看不到。这正是 #3132 的同一种
 * 形态（「符号存在，但那条路径永远走不到」），只是搬到了权限门这一层。
 *
 * 撤掉 `tool-permission-gate.ts` 里的 `isPlanConfirmation` 分支 ⇒ 本文件第一条红
 * （run 被 `approveAndRequeue` 而不是 `markAwaitingToolPermission`）。
 *
 * 同时守住反向：这条豁免**只**对计划确认生效，既有 L0/L1 工具的自动放行语义一个字不变
 * （否则就成了「给所有工具加一道门」，与判据 (b) 冲突）。
 */
import { describe, expect, it, vi } from "vitest";
import { handleInterruptedToolCall } from "../../src/application/agent-run/tool-permission-gate";
import type { ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { toOrgId } from "../../src/domain/org-id";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";

const LEDGER = {
  seq: 1,
  modelStartedAt: "2026-09-08T00:00:00Z",
  systemDigest: "digest",
  system: "system prompt",
};

function depsWithSpies() {
  const approveAndRequeue = vi.fn(async () => {});
  const markAwaitingToolPermission = vi.fn(async () => {});
  const hasGrant = vi.fn(async () => true); // 最宽松：连「以后都允许」都已授权。
  const deps = {
    runs: { approveAndRequeue, markAwaitingToolPermission, appendStep: vi.fn(async () => {}) },
    toolPermissionGrants: { hasGrant },
    clock: { now: () => "2026-09-08T00:00:01Z" },
    events: undefined,
    interjections: undefined,
  } as unknown as ExecuteAgentRunDeps;
  return { deps, approveAndRequeue, markAwaitingToolPermission, hasGrant };
}

const ORG = toOrgId("org");

describe("B7 · 计划确认中断绝不被网关自动放行", () => {
  it("write_todos 的中断 ⇒ 停进 awaiting_tool_permission，不 approveAndRequeue", async () => {
    const { deps, approveAndRequeue, markAwaitingToolPermission } = depsWithSpies();
    const result = await handleInterruptedToolCall(
      deps, ORG, "run-1",
      { toolName: PLAN_CONFIRMATION_TOOL_NAME, argsSummary: JSON.stringify({ todos: [{ content: "a" }, { content: "b" }] }) },
      LEDGER,
    );
    expect(result.autoApproved).toBe(false);
    expect(approveAndRequeue).not.toHaveBeenCalled();
    expect(markAwaitingToolPermission).toHaveBeenCalledTimes(1);
  });

  it("「以后都允许」的常驻授权不适用于计划确认——那是工具权限，不是对未来计划的预批", async () => {
    const { deps, approveAndRequeue, hasGrant } = depsWithSpies();
    const result = await handleInterruptedToolCall(
      deps, ORG, "run-2",
      { toolName: PLAN_CONFIRMATION_TOOL_NAME, argsSummary: null },
      LEDGER,
    );
    expect(result.autoApproved).toBe(false);
    expect(approveAndRequeue).not.toHaveBeenCalled();
    // 连问都不该问：授权查询与这条分支无关。
    expect(hasGrant).not.toHaveBeenCalled();
  });

  it("反向：既有 L0 工具的自动放行语义逐字不变（豁免没有溢出到别的工具上）", async () => {
    // `read_file` 是 L0。本改动之前它会被自动放行，之后必须**仍然**被自动放行——
    // 否则这道豁免就变成了「给所有工具加一道门」，与判据 (b) 直接冲突。
    const { deps, approveAndRequeue, markAwaitingToolPermission } = depsWithSpies();
    const result = await handleInterruptedToolCall(
      deps, ORG, "run-3", { toolName: "read_file", argsSummary: null }, LEDGER,
    );
    expect(result.autoApproved).toBe(true);
    expect(approveAndRequeue).toHaveBeenCalledTimes(1);
    expect(markAwaitingToolPermission).not.toHaveBeenCalled();
  });

  it("反向：L2 工具（call_skill）在已授权时仍然自动放行，#2767 语义不变", async () => {
    const { deps, approveAndRequeue } = depsWithSpies();
    const result = await handleInterruptedToolCall(
      deps, ORG, "run-4",
      { toolName: "call_skill", skillStableName: "quarterly-report", argsSummary: null },
      LEDGER,
    );
    expect(result.autoApproved).toBe(true);
    expect(approveAndRequeue).toHaveBeenCalledTimes(1);
  });
});
