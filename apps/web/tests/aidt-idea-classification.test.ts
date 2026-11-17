import { describe, expect, it } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtClassifiableIdeas, aidtIdeaClassificationFor, aidtIdeaClassificationLines, confirmAidtIdeaClassification, invalidateAidtIdeaClassification, readAidtIdeaClassification, repairAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "@/features/aidt/lib/aidt-idea-classification";

const draft = (): AidtUiStageDraft => ({ fields: { brainstorm: "学生原稿" }, ideas: [{ id: "one", title: "试饮", description: "先尝一小杯" }, { id: "two", title: "口味表", description: "比较口味" }, { id: "blank", title: "", description: "" }], selectedIdeaId: "two", selectionReasons: { two: "小组自行选定" } });
const classified = (): AidtUiStageDraft => confirmAidtIdeaClassification(setAidtIdeaClassificationReason(setAidtIdeaCategory(setAidtIdeaCategory(draft(), "one", "fun", true), "one", "easy", true), "one", "小杯容易制作，也能有趣地比较。"));

describe("student idea classification", () => {
  it("keeps multiple canonical labels on one candidate, independent from the selected idea", () => {
    const before = draft(), after = classified(), state = readAidtIdeaClassification(after);
    expect(state.tags.one).toEqual(["easy", "fun"]);
    expect(state.confirmed).toBe(true);
    expect(after.ideas).toEqual(before.ideas);
    expect(after.selectedIdeaId).toBe("two");
    expect(after.selectionReasons).toEqual(before.selectionReasons);
    expect(before.fields).toEqual({ brainstorm: "学生原稿" });
    expect(aidtIdeaClassificationFor(after, "one").labels).toEqual(["最容易实现的", "最有趣的"]);
    expect(StageDraft.safeParse(after).success).toBe(true);
  });

  it("allows empty categories and unclassified candidates, while requiring student reasons for assigned labels", () => {
    const empty = readAidtIdeaClassification(confirmAidtIdeaClassification(draft()));
    expect(empty.confirmed).toBe(true);
    expect(empty.tags).toEqual({});
    const noReason = setAidtIdeaCategory(draft(), "one", "breakthrough", true);
    expect(readAidtIdeaClassification(noReason).canConfirm).toBe(false);
    expect(confirmAidtIdeaClassification(noReason)).toBe(noReason);
    expect(readAidtIdeaClassification({ ...draft(), ideas: [] }).canConfirm).toBe(false);
  });

  it("clears confirmation after a student changes a reason, tag, or the external candidate content", () => {
    const saved = classified();
    expect(readAidtIdeaClassification(setAidtIdeaClassificationReason(saved, "one", "另一种理由")).confirmed).toBe(false);
    expect(readAidtIdeaClassification(setAidtIdeaCategory(saved, "one", "fun", false)).confirmed).toBe(false);
    const renamed = invalidateAidtIdeaClassification({ ...saved, ideas: saved.ideas.map((idea) => idea.id === "one" ? { ...idea, title: "改名" } : idea) });
    expect(readAidtIdeaClassification(renamed).confirmed).toBe(false);
    expect(readAidtIdeaClassification(renamed).tags.one).toEqual(["easy", "fun"]);
    expect(renamed.selectedIdeaId).toBe("two");
  });

  it("does not leave removed or blank candidates in active classification and normalizes them on reconfirmation", () => {
    const original = classified(), removed = { ...original, ideas: original.ideas.filter((idea) => idea.id !== "one") };
    const state = readAidtIdeaClassification(removed);
    expect(state.tags.one).toBeUndefined();
    expect(state.reasons.one).toBeUndefined();
    expect(state.confirmed).toBe(false);
    expect(state.canConfirm).toBe(true);
    const normalized = confirmAidtIdeaClassification(removed);
    expect(JSON.parse(normalized.fields.ideaClassificationTags!)).toEqual({});
    expect(aidtIdeaClassificationLines(normalized).join("\n")).not.toContain("小杯");
    expect(aidtClassifiableIdeas(draft()).map((idea) => idea.id)).toEqual(["one", "two"]);
  });

  it.each(["not json", "[]", '"string"', '{"one":["unknown"]}', '{"one":"easy"}'])("fails closed on malformed classification %s", (raw) => {
    const bad = { ...draft(), fields: { ideaClassificationTags: raw, ideaClassificationConfirmed: "true" } };
    expect(readAidtIdeaClassification(bad)).toMatchObject({ canConfirm: false, confirmed: false });
    expect(readAidtIdeaClassification(bad).issues.length).toBeGreaterThan(0);
    const repaired = repairAidtIdeaClassification(bad);
    expect(readAidtIdeaClassification(repaired)).toMatchObject({ confirmed: false, canConfirm: true, tags: {} });
  });

  it("preserves oversized reasons without silently truncating them, but prevents confirmation", () => {
    const next = setAidtIdeaClassificationReason(setAidtIdeaCategory(draft(), "one", "easy", true), "one", "长".repeat(6000));
    expect(readAidtIdeaClassification(next).reasons.one).toHaveLength(6000);
    expect(readAidtIdeaClassification(next).canConfirm).toBe(false);
    expect(readAidtIdeaClassification(next).issues.join(" ")).toContain("超过共享字段长度");
  });

  it("ignores invalid targets and exports the student's status and reasons without claiming voting or save success", () => {
    const before = draft();
    expect(setAidtIdeaCategory(before, "blank", "easy", true)).toBe(before);
    expect(setAidtIdeaClassificationReason(before, "gone", "原因")).toBe(before);
    const lines = aidtIdeaClassificationLines(classified()).join("\n");
    expect(lines).toContain("试饮：最容易实现的、最有趣的");
    expect(lines).toContain("口味表：暂未分类");
    expect(lines).toContain("分类与投票、共享保存分别核对");
    expect(lines).not.toContain("投票完成");
  });

  it("handles a candidate named __proto__ without prototype mutation", () => {
    const special = { ...draft(), ideas: [{ id: "__proto__", title: "特别点子", description: "学生原稿" }] };
    const next = setAidtIdeaClassificationReason(setAidtIdeaCategory(special, "__proto__", "easy", true), "__proto__", "纸张即可尝试");
    expect(readAidtIdeaClassification(confirmAidtIdeaClassification(next)).tags.__proto__).toEqual(["easy"]);
    expect(Object.prototype).not.toHaveProperty("easy");
  });
});
