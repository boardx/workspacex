import { describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  canBindTemplateToSegment,
  SEGMENT_TEMPLATE_BINDING_LIMIT,
  type SegmentTemplateBinding,
} from "../../src/domain/canvas/segment-binding";

/**
 * F102 — I-6：同一 `agendaSegmentId` 的模板绑定数 ≤ 2（`SEGMENT_TEMPLATE_LIMIT`）。
 *
 * 顺带穷举 I-5 新增绑定半条：archived / draft / trial 模板一律拒绝新增绑定
 * （只有 `published` 可以），与模板不存在（`TEMPLATE_NOT_FOUND`）三种判定互不干扰——
 * 这条判定复用 F101 `template-lifecycle.ts` 的 `canCreateNewBinding`，本文件不重写第二份。
 */

const seg = "segment-1";

function binding(bindingId: string, templateKey: string, boundTemplateVersion = 1): SegmentTemplateBinding {
  return { bindingId, agendaSegmentId: seg, templateKey, boundTemplateVersion };
}

describe("F102 · 同一议程环节模板绑定上限（I-6）", () => {
  it(`上限常量是 ${SEGMENT_TEMPLATE_BINDING_LIMIT}（Backlog 上限，本仓单一事实源）`, () => {
    expect(SEGMENT_TEMPLATE_BINDING_LIMIT).toBe(2);
  });

  it("0 条既有绑定 + published 模板 → 允许绑定", () => {
    const result = canBindTemplateToSegment({ existingBindingsForSegment: [], templateStatus: "published" });
    expect(result).toEqual({ ok: true });
  });

  it("1 条既有绑定（未到上限）+ published 模板 → 允许绑定", () => {
    const result = canBindTemplateToSegment({
      existingBindingsForSegment: [binding("b-1", "swot")],
      templateStatus: "published",
    });
    expect(result).toEqual({ ok: true });
  });

  it("2 条既有绑定（已达上限）→ 第三个绑定被拒 SEGMENT_TEMPLATE_LIMIT，即便模板本身是 published", () => {
    const result = canBindTemplateToSegment({
      existingBindingsForSegment: [binding("b-1", "swot"), binding("b-2", "pestel")],
      templateStatus: "published",
    });
    expect(result).toEqual({ ok: false, reason: "SEGMENT_TEMPLATE_LIMIT" });
  });

  it("上限判定只看目标 agendaSegmentId 自己的绑定数，不受传入数组以外因素影响", () => {
    // 调用方职责：existingBindingsForSegment 已经是"过滤到这一个环节"之后的结果。
    // 这里断言：只要传入的数组长度到了上限，判定就拒绝——不隐含任何跨环节的全局计数。
    const twoBindings = [binding("b-1", "a"), binding("b-2", "b")];
    expect(canBindTemplateToSegment({ existingBindingsForSegment: twoBindings, templateStatus: "published" })).toEqual({
      ok: false,
      reason: "SEGMENT_TEMPLATE_LIMIT",
    });
  });

  it("模板不存在 → TEMPLATE_NOT_FOUND，且优先于绑定数判定", () => {
    const result = canBindTemplateToSegment({
      existingBindingsForSegment: [binding("b-1", "swot"), binding("b-2", "pestel")],
      templateStatus: undefined,
    });
    expect(result).toEqual({ ok: false, reason: "TEMPLATE_NOT_FOUND" });
  });

  describe("I-5 新增绑定半条：非 published 状态一律拒绝新增绑定", () => {
    const nonPublishedStatuses = C.TemplateStatus.options.filter((s) => s !== "published");

    it("archived / draft / trial 三种非 published 状态全部覆盖", () => {
      expect(nonPublishedStatuses.sort()).toEqual(["archived", "draft", "trial"].sort());
    });

    for (const status of nonPublishedStatuses) {
      it(`templateStatus="${status}" → TEMPLATE_ARCHIVED（即便该环节尚无任何绑定）`, () => {
        const result = canBindTemplateToSegment({ existingBindingsForSegment: [], templateStatus: status });
        expect(result).toEqual({ ok: false, reason: "TEMPLATE_ARCHIVED" });
      });
    }

    it("published 是唯一允许新增绑定的状态", () => {
      for (const status of C.TemplateStatus.options) {
        const result = canBindTemplateToSegment({ existingBindingsForSegment: [], templateStatus: status });
        expect(result.ok, `status=${status}`).toBe(status === "published");
      }
    });
  });
});
