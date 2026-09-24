/**
 * 第一个价值时刻事件目录（ACCEPTED D33，backlog E1）的行为测试。
 * 测的是「违反约束的事实 / 上报会被拒」，以及本地聚合只把计数带出实例。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIRST_VALUE_BUDGET_MINUTES,
  FIRST_VALUE_STEP,
  FirstValueFunnelCounts,
  FirstValueLocalFact,
  FirstValueStep,
  aggregateFirstValueFunnel,
  firstValueMedianMinutes,
  mayLeaveInstance,
  type FirstValueLocalFactValue,
} from "../src/first-value-events";
import { TelemetryUsage } from "../src/instance-telemetry";
import { TELEMETRY_CONSENT_DEFAULTS } from "../src/instance-telemetry";

const META = { instanceId: "a".repeat(64), periodEnd: "2026-09-24T23:59:59Z" };
const at = (min: number) => new Date(Date.parse("2026-09-24T10:00:00Z") + min * 60_000).toISOString();
const fact = (
  orgId: string,
  step: FirstValueLocalFactValue["step"],
  min: number,
  orgKind: FirstValueLocalFactValue["orgKind"] = "standard",
): FirstValueLocalFactValue => ({ orgId, orgKind, step, occurredAt: at(min) });

describe("第一个价值时刻事件目录（ACCEPTED）", () => {
  it("价值时刻是漏斗里的一步，且在「上传自己的材料」与示例回答之后", () => {
    const steps = FirstValueStep.options;
    expect(steps).toContain(FIRST_VALUE_STEP);
    expect(steps.indexOf(FIRST_VALUE_STEP)).toBeGreaterThan(steps.indexOf("own_material_uploaded"));
    expect(steps.indexOf(FIRST_VALUE_STEP)).toBeGreaterThan(steps.indexOf("cited_answer_sample"));
    expect(steps[0]).toBe("first_sign_in");
  });

  it("本地事实：多一个字段就拒（不许夹带文件名、问题原文），组织 id 不许是可读名字", () => {
    expect(FirstValueLocalFact.safeParse(fact("org-a", "own_material_uploaded", 1)).success).toBe(true);
    expect(FirstValueLocalFact.safeParse({ ...fact("org-a", "own_material_uploaded", 1), fileName: "合同.pdf" }).success).toBe(false);
    expect(FirstValueLocalFact.safeParse({ ...fact("org-a", "own_material_uploaded", 1), orgId: "某某资本" }).success).toBe(false);
  });

  it("离开实例只看 usage 同意，出厂默认不离开（D22）", () => {
    expect(mayLeaveInstance(TELEMETRY_CONSENT_DEFAULTS)).toBe(false);
    expect(mayLeaveInstance({ ...TELEMETRY_CONSENT_DEFAULTS, usage: true })).toBe(true);
    expect(mayLeaveInstance({ health: true, usage: false, diagnostics: true, benchmark: true })).toBe(false);
  });

  it("本地聚合：只出计数与中位数，排除 personal-local，同步取最早", () => {
    const r = aggregateFirstValueFunnel(
      [
        fact("org-a", "first_sign_in", 0),
        fact("org-a", "own_material_uploaded", 3),
        fact("org-a", "cited_answer_own_material", 8),
        fact("org-a", "cited_answer_own_material", 30), // 重复，取最早
        fact("org-b", "first_sign_in", 0),
        fact("org-b", "cited_answer_own_material", 40), // 超预算
        fact("org-c", "first_sign_in", 0),
        fact("org-p", "first_sign_in", 0, "personal-local"),
        fact("org-p", "cited_answer_own_material", 1, "personal-local"),
      ],
      META.periodEnd,
    );
    expect(r.orgsReachedStep.first_sign_in).toBe(3);
    expect(r.orgsReachedStep.cited_answer_own_material).toBe(2);
    expect(firstValueMedianMinutes([fact("org-a", "first_sign_in", 0), fact("org-a", "cited_answer_own_material", 8), fact("org-b", "first_sign_in", 0), fact("org-b", "cited_answer_own_material", 40)], META.periodEnd)).toBe(24);
    expect(r.orgsWithinBudget).toBe(1);
    expect(FIRST_VALUE_BUDGET_MINUTES).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(r)).not.toMatch(/org-/);
  });

  it("无人到达价值时刻：中位数缺席；周期末之后的事实不计", () => {
    const late = { ...fact("org-a", FIRST_VALUE_STEP, 0), occurredAt: "2026-09-25T01:00:00Z" };
    const r = aggregateFirstValueFunnel([fact("org-a", "first_sign_in", 0), late], META.periodEnd);
    expect(r.orgsReachedStep[FIRST_VALUE_STEP]).toBe(0);
    expect(firstValueMedianMinutes([fact("org-a", "first_sign_in", 0), late], META.periodEnd)).toBeUndefined();
  });

  it("计数上报：键集合固定、自相矛盾的计数与错误的同意项被拒", () => {
    const ok = aggregateFirstValueFunnel([fact("org-a", "first_sign_in", 0), fact("org-a", FIRST_VALUE_STEP, 5)], META.periodEnd);
    expect(FirstValueFunnelCounts.safeParse(ok).success).toBe(true);
    expect(FirstValueFunnelCounts.safeParse({ ...ok, orgsReachedStep: { ...ok.orgsReachedStep, pageViewed: 1 } }).success).toBe(false);
    expect(FirstValueFunnelCounts.safeParse({ ...ok, orgsWithinBudget: 2 }).success).toBe(false);
    // 实例 / 同意 / personal-local 由 S2 信封承载，这里多带即拒
    expect(FirstValueFunnelCounts.safeParse({ ...ok, consentItem: "usage" }).success).toBe(false);
    // 中位数只在 S2 benchmark 里声明一处；这里多带一个就拒（strict）
    expect(FirstValueFunnelCounts.safeParse({ ...ok, medianMinutesToFirstValue: 3 }).success).toBe(false);
  });

  it("已签核（D33）：从 index.ts 导出，且漏斗计数挂在 S2 usage 分节上", () => {
    const index = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8");
    expect(index).toMatch(/export \* as firstValueEvents from "\.\/first-value-events"/);
    const counts = aggregateFirstValueFunnel([fact("org-a", "first_sign_in", 0), fact("org-a", FIRST_VALUE_STEP, 5)], META.periodEnd);
    const usage = { runCount: 1, tokenCount: 1, seatCount: 1, organizationCount: 1, skillPackRuns: [], firstValueFunnel: counts };
    expect(TelemetryUsage.safeParse(usage).success).toBe(true);
    expect(TelemetryUsage.safeParse({ ...usage, firstValueFunnel: { ...counts, orgsWithinBudget: 9 } }).success).toBe(false);
  });
});
