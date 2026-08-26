/**
 * F216（`agent-interrupts` 契约束）—— 中断决策统一守卫：8 错误码 fail-closed。
 * `apps/api/src/application/agent-interrupts/decision-guard.ts` 的
 * `guardAgentInterruptDecision`。范围边界与判定顺序见该文件头。
 *
 * 逐一构造每个码的触发路径，断言均非 0 处置（返回具体错误码，不是 null/静默放行），
 * 并断言"全部条件满足"时才返回 `null`（可以放行）——两个方向都要证明。
 */
import { describe, expect, it } from "vitest";
import { guardAgentInterruptDecision, type DecisionGuardInput } from "../../src/application/agent-interrupts/decision-guard";

const PENDING = { kind: "confirm_intent" as const, requestId: "req-1" };
const OK_PAYLOAD = { impliedKind: "confirm_intent" as const, requestId: "req-1", selectedOptionFound: null };

function baseInput(overrides: Partial<DecisionGuardInput> = {}): DecisionGuardInput {
  return {
    visible: true,
    canWrite: true,
    pendingInterrupt: PENDING,
    payload: OK_PAYLOAD,
    auditWritable: true,
    ...overrides,
  };
}

describe("F216 中断决策统一守卫 —— 8 码 fail-closed，逐一构造触发路径", () => {
  it("全部条件满足 ⇒ null（可以放行）——反证基线：不是恒返回错误码", () => {
    expect(guardAgentInterruptDecision(baseInput())).toBeNull();
  });

  it("NOT_VISIBLE：调用者对该线程无可见权", () => {
    expect(guardAgentInterruptDecision(baseInput({ visible: false }))).toBe("NOT_VISIBLE");
  });

  it("NO_WRITE_ROLE：可见但无写权（观察者恒无写权）", () => {
    expect(guardAgentInterruptDecision(baseInput({ canWrite: false }))).toBe("NO_WRITE_ROLE");
  });

  it("NO_ACTIVE_INTERRUPT：该线程当前没有本束任一 kind 的 pending 中断", () => {
    expect(guardAgentInterruptDecision(baseInput({ pendingInterrupt: null }))).toBe("NO_ACTIVE_INTERRUPT");
  });

  it("MALFORMED_RESUME_PAYLOAD：resume 载荷既不是已知字面量也不是合法 JSON", () => {
    expect(guardAgentInterruptDecision(baseInput({ payload: null }))).toBe("MALFORMED_RESUME_PAYLOAD");
  });

  it("INTERRUPT_KIND_MISMATCH：载荷隐含 kind 与当前 pending 中断的 kind 不符（对 confirm_intent 发 choose_option 形状）", () => {
    const result = guardAgentInterruptDecision(
      baseInput({ payload: { impliedKind: "choose_option", requestId: "req-1", selectedOptionFound: null } }),
    );
    expect(result).toBe("INTERRUPT_KIND_MISMATCH");
  });

  it("STALE_INTERRUPT：该中断已被另一决策解决（并发，两个标签页各点一次）", () => {
    const result = guardAgentInterruptDecision(
      baseInput({ payload: { impliedKind: "confirm_intent", requestId: "req-STALE", selectedOptionFound: null } }),
    );
    expect(result).toBe("STALE_INTERRUPT");
  });

  it("SELECTED_OPTION_NOT_FOUND：choose_option 的 selectedOptionId 不在原始 options 集合里", () => {
    const result = guardAgentInterruptDecision(
      baseInput({
        pendingInterrupt: { kind: "choose_option", requestId: "req-2" },
        payload: { impliedKind: "choose_option", requestId: "req-2", selectedOptionFound: false },
      }),
    );
    expect(result).toBe("SELECTED_OPTION_NOT_FOUND");
  });

  it("AUDIT_SINK_UNAVAILABLE：前面全部通过、决策本该生效，但审计写不进 ⇒ 整个 resume 失败", () => {
    expect(guardAgentInterruptDecision(baseInput({ auditWritable: false }))).toBe("AUDIT_SINK_UNAVAILABLE");
  });

  it("判定顺序：NOT_VISIBLE 优先于 NO_WRITE_ROLE（两者同时成立时报最根本的那个）", () => {
    const result = guardAgentInterruptDecision(baseInput({ visible: false, canWrite: false }));
    expect(result).toBe("NOT_VISIBLE");
  });

  it("判定顺序：AUDIT_SINK_UNAVAILABLE 排最后——审计不可用不会掩盖更根本的 kind 错配", () => {
    const result = guardAgentInterruptDecision(
      baseInput({
        auditWritable: false,
        payload: { impliedKind: "choose_option", requestId: "req-1", selectedOptionFound: null },
      }),
    );
    expect(result).toBe("INTERRUPT_KIND_MISMATCH");
  });

  it("choose_option 的 edit 分支命中原始选项时，selectedOptionFound=true 不触发 SELECTED_OPTION_NOT_FOUND", () => {
    const result = guardAgentInterruptDecision(
      baseInput({
        pendingInterrupt: { kind: "choose_option", requestId: "req-2" },
        payload: { impliedKind: "choose_option", requestId: "req-2", selectedOptionFound: true },
      }),
    );
    expect(result).toBeNull();
  });
});
