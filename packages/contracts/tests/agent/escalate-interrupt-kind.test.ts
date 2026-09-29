/**
 * AG06 —— escalate 中断 kind（03-agent-role.md R3 ⑧）。
 * AgentInterruptKind 含 escalate；kind→工具名映射一处派生（R10：不两处手写）；载荷/决策形状收紧。
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_INTERRUPT_KIND_TO_TOOL_NAME,
  AGENT_INTERRUPTS_TOOL_NAME_LIST,
  AgentInterruptKind,
  ESCALATE_MATTER_TOOL_NAME,
} from "../../src/agent-interrupts";
import { agentRole as R } from "../../src/index";

describe("AG06 escalate interrupt kind", () => {
  it("AgentInterruptKind accepts escalate", () => {
    expect(AgentInterruptKind.options).toContain("escalate");
    expect(AgentInterruptKind.safeParse(R.ESCALATE_INTERRUPT_KIND).success).toBe(true);
  });

  it("kind→tool-name map covers every kind and agent-role derives its tool name from it", () => {
    for (const kind of AgentInterruptKind.options) expect(AGENT_INTERRUPT_KIND_TO_TOOL_NAME[kind]).toBeTruthy();
    expect(AGENT_INTERRUPT_KIND_TO_TOOL_NAME.escalate).toBe(ESCALATE_MATTER_TOOL_NAME);
    expect(R.ESCALATE_TOOL_NAME).toBe(AGENT_INTERRUPT_KIND_TO_TOOL_NAME.escalate);
    const names = Object.values(AGENT_INTERRUPT_KIND_TO_TOOL_NAME);
    expect(new Set(names).size).toBe(names.length);
  });

  it("escalate is not added to the Python-backed HITL tool list (runtime wiring out of scope)", () => {
    expect(AGENT_INTERRUPTS_TOOL_NAME_LIST).not.toContain(ESCALATE_MATTER_TOOL_NAME);
  });

  it("EscalatePayload requires {matter, reason, target, contextRefs} and rejects extra fields", () => {
    const ok = { matter: "预算超限", reason: "超出 20%", target: "project_owner", contextRefs: ["ev-1"] };
    expect(R.EscalatePayload.safeParse(ok).success).toBe(true);
    expect(R.EscalatePayload.safeParse({ ...ok, target: "anyone" }).success).toBe(false);
    expect(R.EscalatePayload.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    const { reason: _r, ...missing } = ok;
    expect(R.EscalatePayload.safeParse(missing).success).toBe(false);
  });

  it("EscalateDecision is resolve|reject only; choose_option shape is rejected", () => {
    expect(R.EscalateDecision.safeParse({ decision: "resolve", decisionText: "批准" }).success).toBe(true);
    expect(R.EscalateDecision.safeParse({ decision: "reject", reason: "不批" }).success).toBe(true);
    expect(R.EscalateDecision.safeParse({ decision: "edit", editedArgs: { selectedOptionId: "a" } }).success).toBe(false);
    expect(R.EscalateDecision.safeParse({ decision: "approve" }).success).toBe(false);
  });
});
