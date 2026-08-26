/**
 * F216（`agent-interrupts` 契约束）—— XC-59 反证：仅有 `agent-interrupts` 三种新中断
 * 待决、没有任何 `call_skill` 待审批时，`PlanPhase` 不得被误判成 `"approving"`
 * （`design-coherence.md` 2026-08-26 交叉复核明确要求）。
 *
 * ## 责任归属——如实说明（不重复实现，只在本束侧断言）
 *
 * 权威修复点在 `plan-control` 束的 `derivePlanPhase` 派生函数
 * （`packages/contracts/src/plan-control.ts`）——**实测确认已经落地**（F972，
 * `PLAN_APPROVAL_TOOL_WHITELIST` 只含 `"call_skill"`，`agent-interrupts` 三个工具名
 * 故意不在其中）。`packages/contracts/tests/plan-control/
 * plan-control-schema-single-source.test.ts` 的「XC-59 反证」describe 块已经从
 * `plan-control` 侧断言过同一件事——那是权威实现方的断言。
 *
 * 本文件是 F216（`agent-interrupts` 侧）对同一件事的**独立**断言：verification 要求
 * 这条断言落在 `apps/api`（本束的门控命令路径），不是「重复维护第二份白名单」
 * （`derivePlanPhase`/`PLAN_APPROVAL_TOOL_WHITELIST` 仍是唯一事实源，本文件只 import
 * 消费，不重新声明判定逻辑）——即"谁先做完 PlanPhase 谁就要让本断言通过"里，
 * `plan-control` 线（F972）已经先做完，本文件验证的正是"它确实通过了"。
 */
import { describe, expect, it } from "vitest";
import { derivePlanPhase, PLAN_APPROVAL_TOOL_WHITELIST } from "@repo/contracts/plan-control";
import { AGENT_INTERRUPTS_TOOL_NAME_LIST } from "@repo/contracts/agent-interrupts";

describe("F216 XC-59 反证 —— 仅 agent-interrupts 中断待决时，PlanPhase 不是 approving", () => {
  it("反空转：agent-interrupts 三个工具名一个都不在 PLAN_APPROVAL_TOOL_WHITELIST 里", () => {
    for (const toolName of AGENT_INTERRUPTS_TOOL_NAME_LIST) {
      expect(PLAN_APPROVAL_TOOL_WHITELIST).not.toContain(toolName);
    }
  });

  it.each(AGENT_INTERRUPTS_TOOL_NAME_LIST)(
    "仅 %s 一种待决中断、无 call_skill 审批 ⇒ derivePlanPhase 不返回 approving（落在 executing）",
    (toolName) => {
      const phase = derivePlanPhase({
        runStatus: "running",
        ledgerEmpty: false,
        hasFailedStep: false,
        pendingToolCalls: [{ toolName, awaitingApproval: true }],
      });
      expect(phase).not.toBe("approving");
      expect(phase).toBe("executing");
    },
  );

  it("三种新中断同时待决（理论上 I-8 不允许，但守卫层要 fail-closed，不能因为多个待决就误判）——依然不是 approving", () => {
    const phase = derivePlanPhase({
      runStatus: "running",
      ledgerEmpty: false,
      hasFailedStep: false,
      pendingToolCalls: AGENT_INTERRUPTS_TOOL_NAME_LIST.map((toolName) => ({ toolName, awaitingApproval: true })),
    });
    expect(phase).not.toBe("approving");
  });

  it("反证的另一半：真的存在 call_skill 待审批时，PlanPhase 确实是 approving（证明白名单机制本身有效，不是恒不触发）", () => {
    const phase = derivePlanPhase({
      runStatus: "running",
      ledgerEmpty: false,
      hasFailedStep: false,
      pendingToolCalls: [{ toolName: "call_skill", awaitingApproval: true }],
    });
    expect(phase).toBe("approving");
  });

  it("混合场景：call_skill 待审批 + agent-interrupts 中断同时存在 ⇒ 仍判 approving（call_skill 的信号不会被新工具名稀释掉）", () => {
    const phase = derivePlanPhase({
      runStatus: "running",
      ledgerEmpty: false,
      hasFailedStep: false,
      pendingToolCalls: [
        { toolName: "call_skill", awaitingApproval: true },
        { toolName: AGENT_INTERRUPTS_TOOL_NAME_LIST[0]!, awaitingApproval: true },
      ],
    });
    expect(phase).toBe("approving");
  });
});
