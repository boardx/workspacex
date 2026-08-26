/**
 * F214（`agent-interrupts` 契约束）—— UC-2 `fillRunParams` 的 `appliedTo` 两态
 * （`full-rerun` / `ledger-only`）在 application 层的落地：
 * `apps/api/src/application/agent-interrupts/fill-params-decision.ts` 的
 * `planFillParamsResume`。范围边界见该文件头注释——本测试只验证这个纯函数，不是
 * 共享 `POST /agent-runs/:runId/decision` 端点的 e2e（该端点的 `appliedTo` 透传是
 * 登记在案的后续任务，不在本 issue 单方面扩展一个所有 HITL 类型共用的 `.strict()`
 * 契约）。
 */
import { describe, expect, it } from "vitest";
import { planFillParamsResume } from "../../src/application/agent-interrupts/fill-params-decision";
import type { FillParamsDecision } from "@repo/contracts/agent-interrupts";

const EDITED_FIELDS = [
  { name: "compare_baseline", value: "环比（MoM）" },
  { name: "cc_recipients", value: "ops@example.test" },
];

describe("F214 UC-2 appliedTo —— full-rerun / ledger-only 两态（domain.md 缺口 AI-1 知情降级）", () => {
  it("approve（未改动）：不产出任何 appliedTo 语义，resume 用原始 args", () => {
    const decision: FillParamsDecision = { decision: "approve" };
    expect(planFillParamsResume(decision)).toEqual({ kind: "approve-original" });
  });

  it("edit + full-rerun：resume 携带编辑后的完整字段列表（不是 diff）", () => {
    const decision: FillParamsDecision = {
      decision: "edit",
      editedArgs: { fields: EDITED_FIELDS },
      appliedTo: "full-rerun",
    };
    expect(planFillParamsResume(decision)).toEqual({
      kind: "resume-with-edits",
      editedArgs: { fields: EDITED_FIELDS },
    });
  });

  it("edit + ledger-only：resume 不携带编辑值（用原始 args 放行，当前步骤不因编辑改变行为）", () => {
    const decision: FillParamsDecision = {
      decision: "edit",
      editedArgs: { fields: EDITED_FIELDS },
      appliedTo: "ledger-only",
    };
    const plan = planFillParamsResume(decision);
    expect(plan.kind).toBe("ledger-only");
    if (plan.kind === "ledger-only") {
      expect(plan.resume).toEqual({ kind: "approve-original" });
    }
  });

  it("edit + ledger-only：编辑后的字段被完整记进 ledgerFields——「落账本」这一半可判定、可读回", () => {
    const decision: FillParamsDecision = {
      decision: "edit",
      editedArgs: { fields: EDITED_FIELDS },
      appliedTo: "ledger-only",
    };
    const plan = planFillParamsResume(decision);
    expect(plan.kind).toBe("ledger-only");
    if (plan.kind === "ledger-only") {
      expect(plan.ledgerFields).toEqual(EDITED_FIELDS);
    }
  });

  it("反证：full-rerun 与 ledger-only 对同一份编辑产出不同的 resume 行为——appliedTo 不是摆设字段", () => {
    const base = { decision: "edit" as const, editedArgs: { fields: EDITED_FIELDS } };
    const fullRerun = planFillParamsResume({ ...base, appliedTo: "full-rerun" });
    const ledgerOnly = planFillParamsResume({ ...base, appliedTo: "ledger-only" });
    expect(fullRerun.kind).toBe("resume-with-edits");
    expect(ledgerOnly.kind).toBe("ledger-only");
    expect(fullRerun.kind).not.toBe(ledgerOnly.kind);
  });
});
