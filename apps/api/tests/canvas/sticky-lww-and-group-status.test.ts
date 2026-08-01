import { describe, expect, it } from "vitest";
import {
  applyStickyChange, emptyStickyState, findSupersededRevision, resolveEffectivePatch,
} from "../../src/domain/canvas/sticky-lww";
import {
  computeCompleteness, computeGroupCanvasStatus, isStalled, DEFAULT_STALLED_THRESHOLD_MS,
} from "../../src/domain/canvas/group-canvas-status";

/**
 * F105 — 便签级 LWW（I-19：不弹冲突条，但被覆盖的那次必须可查）
 * + 组画布状态/完成度 enum（O-32：落后 = 有必填分区为空、不横向比较；停滞阈值默认 5 分钟可配置）。
 *
 * 与另外两份测试（判定表 / 三出口）分工：那两份对应 issue 点名的两条 verification
 * 命令；本文件是同一 feature 内、覆盖 user_visible_behavior 其余两句话
 * （便签级 LWW 不弹冲突条 / 组画布状态与同步状态取固定 enum）的补充验证，
 * 不在 issue 的必跑列表里，但同样纳入 evidence。
 */
describe("F105 · applyStickyChange —— 便签级 LWW，不弹冲突条但留痕（I-19）", () => {
  let idSeq = 0;
  const nextId = () => `rev-${++idSeq}`;

  it("首次写入：supersededRevisionId 为 null（这张便签之前没有任何生效值）", () => {
    const state = emptyStickyState("sticky-1");
    const result = applyStickyChange({
      state, patch: { text: "第一版文本" }, clientTs: "2026-08-01T10:00:00.000Z", makeRevisionId: nextId,
    });
    expect(result.supersededRevisionId).toBeNull();
    expect(resolveEffectivePatch(result.nextState)).toEqual({ text: "第一版文本" });
  });

  it("更晚的 clientTs 覆盖更早的：supersededRevisionId 指向被覆盖的那一条，且历史里查得到", () => {
    let state = emptyStickyState("sticky-2");
    const first = applyStickyChange({
      state, patch: { text: "v1" }, clientTs: "2026-08-01T10:00:00.000Z", makeRevisionId: nextId,
    });
    state = first.nextState;
    const firstRevisionId = state.current?.revisionId;

    const second = applyStickyChange({
      state, patch: { text: "v2" }, clientTs: "2026-08-01T10:05:00.000Z", makeRevisionId: nextId,
    });

    expect(second.supersededRevisionId).toBe(firstRevisionId);
    expect(resolveEffectivePatch(second.nextState)).toEqual({ text: "v2" });
    // I-19：不弹冲突条，但被覆盖的那次必须能查到——不是"覆盖了就没了"。
    const superseded = findSupersededRevision(second.nextState, second.supersededRevisionId!);
    expect(superseded?.patch).toEqual({ text: "v1" });
  });

  it("迟到的、时间戳更早的改动：不覆盖当前生效值，但仍然被记进历史（不丢内容）", () => {
    let state = emptyStickyState("sticky-3");
    state = applyStickyChange({
      state, patch: { text: "晚到达但时间戳更晚" }, clientTs: "2026-08-01T10:10:00.000Z", makeRevisionId: nextId,
    }).nextState;
    const beforeHistoryLen = state.history.length;

    const late = applyStickyChange({
      state, patch: { text: "早到达但时间戳更早（网络抖动重放）" },
      clientTs: "2026-08-01T10:01:00.000Z", makeRevisionId: nextId,
    });

    expect(resolveEffectivePatch(late.nextState)).toEqual({ text: "晚到达但时间戳更晚" });
    expect(late.nextState.history.length).toBe(beforeHistoryLen + 1);
  });

  it("跨区移动（sectionId patch）同样走 LWW，不是特殊路径", () => {
    const state = emptyStickyState("sticky-4");
    const result = applyStickyChange({
      state, patch: { sectionId: "sec-2" }, clientTs: "2026-08-01T10:00:00.000Z", makeRevisionId: nextId,
    });
    expect(resolveEffectivePatch(result.nextState)).toEqual({ sectionId: "sec-2" });
  });
});

describe("F105 · 组画布状态 / 完成度 enum（O-32）", () => {
  it("落后当且仅当必填分区非空——不看任何跨组数据（签名里没有其他组这个参数）", () => {
    const completeness = computeCompleteness({
      definedSectionIds: ["s1", "s2", "s3"],
      requiredSectionIds: ["s1", "s2"],
      sectionHasContent: new Map([["s1", true], ["s2", false], ["s3", true]]),
      awaitingCitationCount: 0,
      filledSectionCount: 2,
    });
    expect(completeness.missingRequiredSections).toEqual(["s2"]);
    expect(completeness.defined).toBe(3);

    const status = computeGroupCanvasStatus({
      missingRequiredSections: completeness.missingRequiredSections,
      viewerInGroup: false,
      viewerIsReadOnly: false,
    });
    expect(status).toBe("落后");
  });

  it("必填分区全部有内容时不落后（进行中）", () => {
    const completeness = computeCompleteness({
      definedSectionIds: ["s1", "s2"],
      requiredSectionIds: ["s1", "s2"],
      sectionHasContent: new Map([["s1", true], ["s2", true]]),
      awaitingCitationCount: 0,
      filledSectionCount: 2,
    });
    expect(completeness.missingRequiredSections).toEqual([]);
    const status = computeGroupCanvasStatus({
      missingRequiredSections: completeness.missingRequiredSections,
      viewerInGroup: false,
      viewerIsReadOnly: false,
    });
    expect(status).toBe("进行中");
  });

  it("defined 严格等于模板分区定义表条数，不是「已出现便签的分区数」（I-21）", () => {
    const completeness = computeCompleteness({
      definedSectionIds: ["s1", "s2", "s3", "s4"],
      requiredSectionIds: [],
      sectionHasContent: new Map(),
      awaitingCitationCount: 0,
      filledSectionCount: 0,
    });
    expect(completeness.defined).toBe(4);
  });

  it("无来源·待补的草稿不计入完成度分子（I-23）", () => {
    const completeness = computeCompleteness({
      definedSectionIds: ["s1"],
      requiredSectionIds: [],
      sectionHasContent: new Map([["s1", true]]),
      awaitingCitationCount: 1,
      filledSectionCount: 1,
    });
    expect(completeness.done).toBe(0);
  });

  it("只读视角优先于落后：观察者视角一律显示只读，不管必填分区是否为空", () => {
    const status = computeGroupCanvasStatus({
      missingRequiredSections: ["s1"], viewerInGroup: false, viewerIsReadOnly: true,
    });
    expect(status).toBe("只读");
  });

  it("你在这组优先于落后：自己组的画布即便必填分区为空，也显示「你在这组」而不是「落后」", () => {
    const status = computeGroupCanvasStatus({
      missingRequiredSections: ["s1"], viewerInGroup: true, viewerIsReadOnly: false,
    });
    expect(status).toBe("你在这组");
  });

  it("停滞判定：默认阈值 5 分钟，超过才算停滞", () => {
    expect(DEFAULT_STALLED_THRESHOLD_MS).toBe(5 * 60 * 1000);
    expect(isStalled({ msSinceLastEdit: 4 * 60 * 1000 })).toBe(false);
    expect(isStalled({ msSinceLastEdit: 6 * 60 * 1000 })).toBe(true);
  });

  it("停滞阈值可配置——不是硬编码 5 分钟为唯一取值", () => {
    expect(isStalled({ msSinceLastEdit: 90 * 1000, thresholdMs: 60 * 1000 })).toBe(true);
    expect(isStalled({ msSinceLastEdit: 30 * 1000, thresholdMs: 60 * 1000 })).toBe(false);
  });
});
