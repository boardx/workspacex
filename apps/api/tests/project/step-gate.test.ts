/**
 * Pure unit test for `evaluateStepGate` (F120 / I-P45 / I-P17).
 *
 * No database: this is the judgement itself, isolated from the FK lookup that feeds it.
 * The DB-backed bidirectional assertions (both directions of both codes, against a real
 * `agenda_segments` row and the FK from F118) live in `step-closed-bidirectional.test.ts`
 * and `accepted-sources-whitelist.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { evaluateStepGate, type StepGateSegment } from "../../src/domain/project/step-gate";

const seg = (over: Partial<StepGateSegment>): StepGateSegment => ({
  state: "active",
  acceptedSources: [],
  ...over,
});

describe("evaluateStepGate — STEP_CLOSED (V4: closed + open + skipped)", () => {
  it("closed 环节：拒绝", () => {
    expect(evaluateStepGate(seg({ state: "closed" }), "upload")).toBe("STEP_CLOSED");
  });

  it("skipped 环节：同样拒绝 —— 终态有两个，不能只测 closed", () => {
    expect(evaluateStepGate(seg({ state: "skipped" }), "upload")).toBe("STEP_CLOSED");
  });

  it("反证：active 环节 —— 必须成功，证明不是恒拒绝", () => {
    expect(evaluateStepGate(seg({ state: "active" }), "upload")).toBe("OK");
  });

  it("反证：pending 环节 —— 同样必须成功", () => {
    expect(evaluateStepGate(seg({ state: "pending" }), "upload")).toBe("OK");
  });
});

describe("evaluateStepGate — STEP_REJECTS_ARTIFACT_TYPE (V5: 拒 + 通 + 空白名单全通)", () => {
  it("白名单 ['upload']：prototype-run 被拒", () => {
    expect(evaluateStepGate(seg({ acceptedSources: ["upload"] }), "prototype-run")).toBe(
      "STEP_REJECTS_ARTIFACT_TYPE",
    );
  });

  it("反证：白名单 ['upload']：upload 本身必须成功", () => {
    expect(evaluateStepGate(seg({ acceptedSources: ["upload"] }), "upload")).toBe("OK");
  });

  it("空白名单（默认全接受）：任何来源都通 —— 这是 Q-2③ 特别要求的第三条", () => {
    const anySource = seg({ acceptedSources: [] });
    for (const source of [
      "survey",
      "conversation",
      "interview",
      "prototype-run",
      "research-run",
      "upload",
      "ai-generated",
    ] as const) {
      expect(evaluateStepGate(anySource, source)).toBe("OK");
    }
  });
});

describe("evaluateStepGate — 优先级：STEP_CLOSED 先于 STEP_REJECTS_ARTIFACT_TYPE", () => {
  it("已 closed 且来源也不在白名单里：报 STEP_CLOSED，不是来源码", () => {
    const closedWithWhitelist = seg({ state: "closed", acceptedSources: ["upload"] });
    expect(evaluateStepGate(closedWithWhitelist, "prototype-run")).toBe("STEP_CLOSED");
  });
});
