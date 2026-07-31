import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  AGENDA_SEGMENT_DEFINITIONS,
  ORDERED_DURATION_TIERS,
  agendaSegmentCountForTier,
  agendaSegmentsForTier,
  isOrderedDurationTier,
  type AgendaSegmentRow,
} from "../../src/domain/templates/agenda-segment-table";
import { planDurationTierChange } from "../../src/domain/templates/duration-tier";
import { setDurationTier, TemplateOperationError } from "../../src/application/templates/set-duration-tier";

/**
 * F19 —— 时长档位与议程环节表联动（`uc-2-1` R3 步骤 1 / A1 / AC4，契约 `setDurationTier`）。
 *
 * R3 主表逐字：半天 7 / 一天 11 / 两天（默认）14 / 三天 19。这些数字**从表派生**，
 * 本文件不重复硬编码 —— 每条断言都对照 `agendaSegmentCountForTier`，而不是对照字面量
 * 7/11/14/19 本身写死在测试里（唯一例外：第一个 describe 用字面量核对 R3 主表本身没抄错）。
 */

describe("R3 主表：四档的议程环节数", () => {
  it("半天 7 / 一天 11 / 两天 14 / 三天 19 —— 逐字对照需求文档", () => {
    expect(agendaSegmentCountForTier("half-day")).toBe(7);
    expect(agendaSegmentCountForTier("one-day")).toBe(11);
    expect(agendaSegmentCountForTier("two-day")).toBe(14);
    expect(agendaSegmentCountForTier("three-day")).toBe(19);
  });

  it("表不是空的，且四档互不相同（否则上一条可能在空转）", () => {
    expect(AGENDA_SEGMENT_DEFINITIONS.length).toBeGreaterThan(0);
    const counts = ORDERED_DURATION_TIERS.map((t) => agendaSegmentCountForTier(t));
    expect(new Set(counts).size).toBe(counts.length);
  });

  it("改表 ⇒ 计数自动跟着变（加一行到最高档，只有三天档计数变化）", () => {
    const extra: AgendaSegmentRow = {
      segmentKey: "iteration-landing-plan-extra",
      title: "新增环节",
      group: "iteration-landing-plan",
      introducedAtTier: "three-day",
      optional: true,
    };
    const grown = [...AGENDA_SEGMENT_DEFINITIONS, extra];
    expect(agendaSegmentCountForTier("three-day", grown)).toBe(agendaSegmentCountForTier("three-day") + 1);
    expect(agendaSegmentCountForTier("half-day", grown)).toBe(agendaSegmentCountForTier("half-day"));
  });

  it("每一档都是前一档的超集（累加式档位，升档不丢失下位档的内容）", () => {
    for (let i = 1; i < ORDERED_DURATION_TIERS.length; i++) {
      const lower = agendaSegmentsForTier(ORDERED_DURATION_TIERS[i - 1]!).map((r) => r.segmentKey);
      const higher = new Set(agendaSegmentsForTier(ORDERED_DURATION_TIERS[i]!).map((r) => r.segmentKey));
      for (const key of lower) expect(higher.has(key), `${key} 应该仍在更高档位里`).toBe(true);
    }
  });

  it("custom 不是可排序档位（D-7：宁可拒绝也不猜一个推导式）", () => {
    expect(isOrderedDurationTier("custom")).toBe(false);
    for (const t of ORDERED_DURATION_TIERS) expect(isOrderedDurationTier(t)).toBe(true);
  });
});

describe("换档位：升档只增不减，不需要确认（不是破坏性变更）", () => {
  it("半天 → 三天：全部新增，没有移除，不要求 confirmed", () => {
    const result = planDurationTierChange({ currentTier: "half-day", targetTier: "three-day", confirmed: false });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("unreachable");
    expect(result.agendaSegmentCount).toBe(19);
    expect(result.removed).toEqual([]);
    expect(result.added.length).toBe(19 - 7);
    expect(result.recoverable).toEqual([]);
  });

  it("新蓝本首次选档位（currentTier: null）：等价于纯新增，不要求确认", () => {
    const result = planDurationTierChange({ currentTier: null, targetTier: "two-day", confirmed: false });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("unreachable");
    expect(result.agendaSegmentCount).toBe(14);
    expect(result.removed).toEqual([]);
  });

  it("同档位不变：added/removed 都是空的", () => {
    const result = planDurationTierChange({ currentTier: "two-day", targetTier: "two-day", confirmed: false });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("unreachable");
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe("降档：会丢内容 ⇒ 未确认时拒绝，且清单不得静默丢弃（A2）", () => {
  it("未确认时返回 confirmation-required，并带上将被移除的清单", () => {
    const result = planDurationTierChange({ currentTier: "three-day", targetTier: "half-day", confirmed: false });
    expect(result.kind).toBe("confirmation-required");
    if (result.kind !== "confirmation-required") throw new Error("unreachable");
    expect(result.removed.length).toBe(19 - 7);
    expect(result.added).toEqual([]);
  });

  it("确认后才真正应用，且被移除的环节全部进 recoverable（『切回该档位可恢复』）", () => {
    const result = planDurationTierChange({ currentTier: "three-day", targetTier: "half-day", confirmed: true });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("unreachable");
    expect(result.agendaSegmentCount).toBe(7);
    expect(result.removed.length).toBe(19 - 7);
    expect(result.recoverable).toEqual(result.removed);
    // 切回该档位可恢复：把被移除的目标档重新选回去，移除的那批环节原样重新出现
    const back = planDurationTierChange({ currentTier: "half-day", targetTier: "three-day", confirmed: false });
    expect(back.kind).toBe("applied");
    if (back.kind !== "applied") throw new Error("unreachable");
    expect(new Set(back.added.map((r) => r.agendaSegmentId))).toEqual(
      new Set(result.removed.map((r) => r.agendaSegmentId)),
    );
  });

  it("反证：一天 → 半天只移除 4 个（差值），不是移除全部 11 个", () => {
    const result = planDurationTierChange({ currentTier: "one-day", targetTier: "half-day", confirmed: true });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("unreachable");
    expect(result.removed.length).toBe(11 - 7);
    expect(result.agendaSegmentCount).toBe(7);
  });
});

describe("custom 档位：拒绝而不是瞎猜（D-7 / CUSTOM_TIER_RULE_UNDEFINED）", () => {
  it("目标档位是 custom ⇒ 明确拒绝，不返回任何计数或增删", () => {
    const result = planDurationTierChange({ currentTier: "two-day", targetTier: "custom", confirmed: true });
    expect(result.kind).toBe("custom-tier-undefined");
  });
});

describe("应用层：错误码与契约一致，响应体通过契约 out 校验", () => {
  it("降档未确认 ⇒ 抛出 TIER_CHANGE_NEEDS_CONFIRMATION，且是契约里已有的码", () => {
    expect(templates.operations.setDurationTier.err).toContain("TIER_CHANGE_NEEDS_CONFIRMATION");
    let caught: unknown;
    try {
      setDurationTier({ currentTier: "three-day", targetTier: "half-day", confirmed: false });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateOperationError);
    expect((caught as TemplateOperationError).reasonCode).toBe("TIER_CHANGE_NEEDS_CONFIRMATION");
    // A2：清单没有被吞掉，payload 里能看到将被移除的环节
    expect((caught as TemplateOperationError).payload?.removed.length).toBe(19 - 7);
  });

  it("custom 档位 ⇒ 抛出 CUSTOM_TIER_RULE_UNDEFINED，且是契约里已有的码", () => {
    expect(templates.operations.setDurationTier.err).toContain("CUSTOM_TIER_RULE_UNDEFINED");
    expect(() => setDurationTier({ currentTier: "two-day", targetTier: "custom", confirmed: true })).toThrow(
      TemplateOperationError,
    );
  });

  it("正常应用时，响应体整体能被契约 out 校验通过（返回方向也受契约管）", () => {
    const out = setDurationTier({ currentTier: "half-day", targetTier: "two-day", confirmed: false });
    const parsed = templates.operations.setDurationTier.out.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it("反向断言：契约确实会拒绝漂移的响应体（否则上一条可能在空转）", () => {
    const out = setDurationTier({ currentTier: "half-day", targetTier: "two-day", confirmed: false });
    const withExtraField = { ...out, extra: "not in contract" };
    expect(templates.operations.setDurationTier.out.safeParse(withExtraField).success).toBe(false);
    expect(
      templates.operations.setDurationTier.out.safeParse({ ...out, agendaSegmentCount: -1 }).success,
    ).toBe(false);
  });

  it("每个 AgendaSegmentRef 都能被契约的 AgendaSegmentRef 解析", () => {
    const out = setDurationTier({ currentTier: "half-day", targetTier: "three-day", confirmed: false });
    for (const ref of [...out.added, ...out.removed, ...out.recoverable]) {
      expect(templates.AgendaSegmentRef.safeParse(ref).success, JSON.stringify(ref)).toBe(true);
    }
  });
});
