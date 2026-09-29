/**
 * AG06 —— escalate 中断经 decision-guard 校验 kind 与决策人身份（03-agent-role.md R3 ⑧、E6、E7）。
 */
import { describe, expect, it } from "vitest";
import { guardAgentInterruptDecision, type DecisionGuardInput } from "../../src/application/agent-interrupts/decision-guard";
import {
  escalationStatusAfterTimeout,
  parseEscalateResumePayload,
} from "../../src/application/agent-interrupts/escalate-decision";

const PENDING = { kind: "escalate" as const, requestId: "esc-1" };
const RESOLVE = JSON.stringify({ decision: "resolve", decisionText: "同意追加预算" });

function input(raw: string, deciderId: string, overrides: Partial<DecisionGuardInput> = {}): DecisionGuardInput {
  return {
    visible: true,
    canWrite: true,
    pendingInterrupt: PENDING,
    payload: parseEscalateResumePayload(raw, "esc-1"),
    auditWritable: true,
    escalation: { deciderId, eligibleDeciderIds: ["owner-1"] },
    ...overrides,
  };
}

describe("AG06 escalate decision guard", () => {
  it("target person resolve passes", () => {
    expect(guardAgentInterruptDecision(input(RESOLVE, "owner-1"))).toBeNull();
  });

  it("target person reject passes", () => {
    const raw = JSON.stringify({ decision: "reject", reason: "不在预算内" });
    expect(guardAgentInterruptDecision(input(raw, "owner-1"))).toBeNull();
  });

  it("E6: non-target decider is refused", () => {
    expect(guardAgentInterruptDecision(input(RESOLVE, "member-9"))).toBe("ESCALATION_DECIDER_FORBIDDEN");
  });

  it("E6: missing decider identity fails closed", () => {
    expect(guardAgentInterruptDecision(input(RESOLVE, "owner-1", { escalation: undefined }))).toBe(
      "ESCALATION_DECIDER_FORBIDDEN",
    );
  });

  it("E6: choose_option-shaped payload against escalate ⇒ INTERRUPT_KIND_MISMATCH", () => {
    const raw = JSON.stringify({ decision: "edit", editedArgs: { selectedOptionId: "opt-a" } });
    expect(parseEscalateResumePayload(raw, "esc-1")?.impliedKind).toBe("choose_option");
    expect(guardAgentInterruptDecision(input(raw, "owner-1"))).toBe("INTERRUPT_KIND_MISMATCH");
  });

  it("escalate-shaped payload against a choose_option interrupt ⇒ INTERRUPT_KIND_MISMATCH", () => {
    expect(
      guardAgentInterruptDecision(input(RESOLVE, "owner-1", { pendingInterrupt: { kind: "choose_option", requestId: "esc-1" } })),
    ).toBe("INTERRUPT_KIND_MISMATCH");
  });

  it("garbage payload ⇒ MALFORMED_RESUME_PAYLOAD", () => {
    expect(guardAgentInterruptDecision(input("not json", "owner-1"))).toBe("MALFORMED_RESUME_PAYLOAD");
    expect(guardAgentInterruptDecision(input(JSON.stringify({ decision: "resolve" }), "owner-1"))).toBe(
      "MALFORMED_RESUME_PAYLOAD",
    );
  });

  it("E7: timeout keeps pending, never auto-approves", () => {
    expect(escalationStatusAfterTimeout("pending")).toBe("pending");
  });
});
