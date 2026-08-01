/**
 * F85 —— 研究计划参数面板（uc-6-2 R3 步骤7，AC4）。
 *
 * 纯单元测试，不连 Postgres（issue #74）。
 *
 * ## 要证的事，以及反证（对齐 `retention-param-resolution-no-hardcode.test.ts` 的手法）
 *
 * **AC4 的字面要求**：「数据保留值按项目参数渲染、代码中无写死天数」。若只断言
 * 「retentionDays = 180 时面板显示 180 天」，那么 `renderResearchPlanPanel` 把
 * `retentionDays` 忽略、内部写死 `180` 也能通过这条断言——断言的正好是它要禁止的东西。
 *
 * ⇒ 对一整张**任意**取值表（不含 180 这个「看起来眼熟」的默认值本身有特殊地位）跑同一条
 *   断言：写死任意一个数，其余每一行都会红。同样的手法用在 `plannedMinutes`（时长行）
 *   与 `compressionHint`（E6 压缩提示）上——两处都必须引用参数值,不是字面量 60/90。
 *
 * 其余断言覆盖 AC4 的「四行齐备」「每场人数含同组织上限」「时长含多人场」
 * 「数据保留 N 天 · 禁止用于训练是一行两语义」。
 */
import { describe, expect, it } from "vitest";
import {
  compressionHint,
  multiPersonMinutes,
  PER_SESSION_MAX_HEADCOUNT,
  PER_SESSION_MIN_HEADCOUNT,
  renderResearchPlanPanel,
  type ResearchPlanParamsInput,
} from "../../src/domain/interview/research-plan";

function baseInput(overrides: Partial<ResearchPlanParamsInput> = {}): ResearchPlanParamsInput {
  return {
    retentionDays: 180,
    trainingProhibited: true,
    plannedMinutes: 60,
    sameOrgLimit: 2,
    suggestedSessionCount: 22,
    multiPersonSessionCount: 4,
    ...overrides,
  };
}

/** 任意取值表——180 在里面，但它没有任何特殊地位（对齐 F78 的 `DAY_VALUES` 手法）。 */
const RETENTION_DAY_VALUES = [1, 7, 45, 180, 233, 365, 4000] as const;
const PLANNED_MINUTES_VALUES = [15, 40, 60, 75, 100] as const;

describe("F85 · AC4 —— 数据保留值按项目参数渲染，无写死天数", () => {
  it.each(RETENTION_DAY_VALUES)("retentionDays = %i 时，面板数据保留行原样显示这个数", (days) => {
    const panel = renderResearchPlanPanel(baseInput({ retentionDays: days }));
    expect(panel.dataRetention.value).toContain(`${days} 天`);
  });

  it("面板的数据保留是一行两语义：天数 + 禁止用于训练，不是两行", () => {
    const panel = renderResearchPlanPanel(baseInput({ retentionDays: 233, trainingProhibited: true }));
    expect(panel.dataRetention.label).toBe("数据保留");
    expect(panel.dataRetention.value).toContain("233 天");
    expect(panel.dataRetention.value).toContain("禁止用于训练");
  });

  it("trainingProhibited 是可读写的独立开关，false 时文案不再宣称禁止", () => {
    const panel = renderResearchPlanPanel(baseInput({ trainingProhibited: false }));
    expect(panel.dataRetention.value).not.toContain("禁止用于训练");
  });
});

describe("F85 · AC4 —— 时长含多人场，引用 plannedMinutes 参数而非写死 60/90", () => {
  it.each(PLANNED_MINUTES_VALUES)("plannedMinutes = %i 时，时长行同时显示常规与多人场时长", (minutes) => {
    const panel = renderResearchPlanPanel(baseInput({ plannedMinutes: minutes }));
    expect(panel.duration.value).toContain(`${minutes} 分`);
    expect(panel.duration.value).toContain(`${multiPersonMinutes(minutes)} 分`);
  });

  it("多人场时长按固定倍率从 plannedMinutes 派生（60 → 90 只是这张表里的一行）", () => {
    expect(multiPersonMinutes(60)).toBe(90);
    expect(multiPersonMinutes(40)).toBe(60);
    expect(multiPersonMinutes(15)).toBe(23);
  });
});

describe("F85 · AC4 —— 每场人数含同组织上限，建议场次含多人访谈场数", () => {
  it.each([1, 2, 3, 5])("sameOrgLimit = %i 时，每场人数行显示固定区间 + 该上限", (limit) => {
    const panel = renderResearchPlanPanel(baseInput({ sameOrgLimit: limit }));
    expect(panel.perSessionHeadcount.value).toContain(`${PER_SESSION_MIN_HEADCOUNT}–${PER_SESSION_MAX_HEADCOUNT} 人`);
    expect(panel.perSessionHeadcount.value).toContain(`同组织不超过 ${limit} 人`);
  });

  it("建议场次行同时显示总场次与多人场次", () => {
    const panel = renderResearchPlanPanel(baseInput({ suggestedSessionCount: 22, multiPersonSessionCount: 4 }));
    expect(panel.suggestedSessions.value).toContain("22 场");
    expect(panel.suggestedSessions.value).toContain("4 场多人访谈");
  });

  it("面板四行齐备：建议场次 / 每场人数 / 时长 / 数据保留", () => {
    const panel = renderResearchPlanPanel(baseInput());
    const labels = [panel.suggestedSessions, panel.perSessionHeadcount, panel.duration, panel.dataRetention].map(
      (line) => line.label,
    );
    expect(labels).toEqual(["建议场次", "每场人数", "时长", "数据保留"]);
  });
});

describe("F85 · E6 —— 合计时长超过研究计划参数时提示压缩，引用参数值而非写死 60", () => {
  it.each(PLANNED_MINUTES_VALUES)("plannedMinutes = %i 时，合计时长未超参数不提示", (minutes) => {
    expect(compressionHint(minutes, minutes)).toBeNull();
    expect(compressionHint(minutes - 1, minutes)).toBeNull();
  });

  it.each(PLANNED_MINUTES_VALUES)("plannedMinutes = %i 时，超过参数值即提示压缩，且提示文案引用该参数值", (minutes) => {
    const hint = compressionHint(minutes + 20, minutes);
    expect(hint).not.toBeNull();
    expect(hint).toContain(`${minutes} 分钟`);
    expect(hint).toContain(`${minutes + 20} 分钟`);
  });

  it("与 uc-6-1「超 60 分钟提示压缩」同源，但取的是参数值——plannedMinutes=60 时行为一致，不是巧合", () => {
    expect(compressionHint(61, 60)).not.toBeNull();
    expect(compressionHint(45, 60)).toBeNull();
  });
});
