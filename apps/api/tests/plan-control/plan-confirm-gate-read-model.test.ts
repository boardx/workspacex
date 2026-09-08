/**
 * issue #3132（B7）—— 计划确认门的**读模型**反证。
 *
 * 契约层证明了「`planning` 这个态可达」；本文件证明 `getPlanLedger` 真的会在
 * run 停在 `write_todos` 中断上时**产出**那个态，并把提案计划下发给前端。
 *
 * 撤掉 `get-plan-ledger.ts` 里的提案投影（`parseProposedSteps` /
 * `hasPendingPlanConfirmation`），本文件整组红。
 */
import { describe, expect, it } from "vitest";
import { getPlanLedger } from "../../src/application/plan-control/get-plan-ledger";
import type {
  PlanLedgerRepository, PlanRunSnapshot, PlanRunStatusReader,
} from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";

const emptyRepo = {
  getLatest: async () => null,
  listOrphanedConstraints: async () => [],
} as unknown as PlanLedgerRepository;

function readerFor(run: PlanRunSnapshot | null): PlanRunStatusReader {
  return {
    getLatestRun: async () => run,
    recordRemoteRunId: async () => { throw new Error("read must not write"); },
    markRunPaused: async () => { throw new Error("read must not write"); },
  };
}

const PERMISSION_REQUEST_ID = "9f1d2c3b-4a5e-4f6a-8b7c-0d1e2f3a4b5c";

function pendingPlanRun(overrides: Partial<PlanRunSnapshot> = {}): PlanRunSnapshot {
  return {
    runId: "run-1",
    // 仓储把 `awaiting_tool_permission` 折叠进 `running`（见 `ACTIVE_RUN_STATUSES` 头注），
    // 所以这里如实用 `running` —— 不是为了让测试好过而挑一个特殊状态。
    status: "running",
    pausedAt: null,
    pauseRequestedAt: null,
    cancelRequestedAt: null,
    pendingToolName: PLAN_CONFIRMATION_TOOL_NAME,
    pendingArgsSummary: JSON.stringify({
      todos: [
        { content: "收集季度数据", status: "pending" },
        { content: "整理成表", status: "pending" },
        { content: "写结论", status: "pending" },
      ],
    }),
    pendingPermissionRequestId: PERMISSION_REQUEST_ID,
    createdAt: new Date().toISOString(),
    agentId: "agent",
    remoteRunId: null,
    errorCode: null,
    ...overrides,
  };
}

const ask = (run: PlanRunSnapshot | null) =>
  getPlanLedger(emptyRepo, readerFor(run), { orgId: toOrgId("org"), threadId: "t" });

describe("B7 · getPlanLedger 在计划确认中断上产出 planning + 提案计划", () => {
  it("待决 write_todos ⇒ phase=planning、steps=提案、stepsAreProposal=true、gate.required=true", async () => {
    const out = await ask(pendingPlanRun());
    expect(out.phase).toBe("planning");
    expect(out.stepsAreProposal).toBe(true);
    expect(out.steps.map((s) => s.content)).toEqual(["收集季度数据", "整理成表", "写结论"]);
    // 账本从未被写过：提案不是账本。revision 仍是 0 是这条语义的机械证据。
    expect(out.revision).toBe(0);
    expect(out.gate.required).toBe(true);
    // 前端要靠这两个字段凑出 `decidePermissionRequest`——恢复停住的那条 run
    // （人类裁决 O-2），而不是 `confirmPlan` 新起一条。缺任一个确认门就是摆设。
    expect(out.pendingPermissionRequestId).toBe(PERMISSION_REQUEST_ID);
    expect(out.activeRunId).toBe("run-1");
  });

  it("判据 (b) 正向断言：简单问答（无待决中断、无账本）不被加门", async () => {
    // 这条是**正向**的：它证明这道门没有溢出到普通对话上。把引擎侧谓词改成恒 True
    // 在真实链路上会破坏的正是这一条的语义（见 Python 侧同名反证）。
    const out = await ask(pendingPlanRun({ pendingToolName: null, pendingArgsSummary: null, pendingPermissionRequestId: null }));
    expect(out.phase).not.toBe("planning");
    expect(out.stepsAreProposal).toBe(false);
    expect(out.gate.required).toBe(false);
    expect(out.gate.reason).toBe("no-plan");
    expect(out.steps).toHaveLength(0);
  });

  it("单步提案不产生确认门（判据 (b) 的另一半：todoCount=1）", async () => {
    const out = await ask(pendingPlanRun({
      pendingArgsSummary: JSON.stringify({ todos: [{ content: "只有一步", status: "pending" }] }),
    }));
    // phase 仍是 planning（引擎确实停住了），但 gate 不要求确认——组件的渲染门是
    // `phase === "planning" && gate.required`，所以门不出现。两个判定各司其职。
    expect(out.gate.required).toBe(false);
    expect(out.gate.reason).toBe("single-step");
  });

  it("待决的是别的工具（call_skill）⇒ 不是 planning，既有 approving 语义不变", async () => {
    const out = await ask(pendingPlanRun({ pendingToolName: "call_skill" }));
    expect(out.stepsAreProposal).toBe(false);
    expect(out.phase).toBe("approving");
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "终态 %s：即使还留着待决中断，也不回到 planning，且不下发提案步骤（#2927 / #3079）",
    async (status) => {
      const out = await ask(pendingPlanRun({ status }));
      expect(out.phase).toBe(status === "succeeded" ? "done" : status);
      expect(out.stepsAreProposal).toBe(false);
      expect(out.steps).toHaveLength(0);
      expect(out.pendingPermissionRequestId).toBeNull();
    },
  );
});

describe("B7 · 截断陷阱（#2017 的同一个坑，不重踩）", () => {
  it("4000 字符量级的长计划 args 完整解析得出全部步骤", async () => {
    // `pending_args_summary` 的产地默认按 PROGRESS_SUMMARY_MAX_CHARS=500 截断并接一个
    // `…`——那会把 JSON 截成非法串。`write_todos` 在 `deep-agent-model-provider.ts`
    // 享有 4000 字符豁免，本用例依赖它。把那条豁免撤掉，长计划这条红而短计划仍绿
    // ——正是本仓「全绿但空转」的形态，所以它必须单独存在。
    const longTodos = Array.from({ length: 20 }, (_, i) => ({
      content: `第 ${i + 1} 步：${"详细描述".repeat(20)}`,
      status: "pending",
    }));
    const summary = JSON.stringify({ todos: longTodos });
    expect(summary.length).toBeGreaterThan(500);
    const out = await ask(pendingPlanRun({ pendingArgsSummary: summary }));
    expect(out.phase).toBe("planning");
    expect(out.steps).toHaveLength(20);
  });

  it("被截断成非法 JSON ⇒ 不进 planning（fail-closed：宁可不渲染，也不给一张空卡片）", async () => {
    const truncated = `${JSON.stringify({ todos: [{ content: "a" }, { content: "b" }] }).slice(0, 30)}…`;
    const out = await ask(pendingPlanRun({ pendingArgsSummary: truncated }));
    expect(out.phase).not.toBe("planning");
    expect(out.stepsAreProposal).toBe(false);
  });

  it.each([null, "", "{}", '{"todos":[]}', '{"todos":"nope"}', '{"todos":[{"noContent":1}]}'])(
    "args 形状不对（%s）⇒ 不进 planning",
    async (summary) => {
      const out = await ask(pendingPlanRun({ pendingArgsSummary: summary }));
      expect(out.stepsAreProposal).toBe(false);
      expect(out.phase).not.toBe("planning");
    },
  );
});
