/**
 * 缩略图几何的纯函数单测（R8，2026-08-26）。
 *
 * 起因是人类实测反馈「card 必须有可视化模板的预览」——此前未排版的模板（19 个内置 +
 * 存量 org 模板）在卡片上只有一行文字说明，那不是预览。现在两条来源共用一个出口：
 * 已排版走 12×8 网格，未排版走**渲染时用的同一个** `computeAutoLayout`。
 */
import { describe, expect, it } from "vitest";
import { thumbBoxesOf } from "@/components/canvas/template-a1-thumbnail";
import type { CanvasTemplate } from "@/lib/live-canvas";

type Section = CanvasTemplate["sections"][number];

function tpl(sections: Section[]): CanvasTemplate {
  return {
    key: "t", displayName: "T", version: 1, status: "draft", builtin: false,
    visibility: "org-wide", underlyingType: "canvas", sections, usageCount: 0, tags: [],
    title: "", footer: "",
  } as CanvasTemplate;
}

function section(id: string, over: Partial<Section> = {}): Section {
  return {
    sectionId: id, name: id, order: 0, required: false, capacity: null, ...over,
  } as Section;
}

describe("已排版的模板 —— 12×8 网格换百分比", () => {
  it("占满整幅的区块 = 0%,0%,100%,100%", () => {
    const [b] = thumbBoxesOf(tpl([section("s1", {
      type: "便利贴列表",
      layout: { col: 1, row: 1, w: 12, h: 8, cols: 5, max: 6, tone: 0, overflow: "缩小字号" },
    })]));
    expect(b).toMatchObject({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 });
  });

  it("右半幅、下半幅的区块落在 50%", () => {
    const [b] = thumbBoxesOf(tpl([section("s1", {
      type: "便利贴列表",
      layout: { col: 7, row: 5, w: 6, h: 4, cols: 5, max: 6, tone: 0, overflow: "缩小字号" },
    })]));
    expect(b!.leftPct).toBeCloseTo(50, 5);
    expect(b!.topPct).toBeCloseTo(50, 5);
    expect(b!.widthPct).toBeCloseTo(50, 5);
    expect(b!.heightPct).toBeCloseTo(50, 5);
  });

  it("贴纸色跟着 tone 走；文本类区块用浅灰（§3.1 原话）", () => {
    const boxes = thumbBoxesOf(tpl([
      section("s1", { type: "便利贴列表", layout: { col: 1, row: 1, w: 3, h: 2, cols: 5, max: 6, tone: 1, overflow: "缩小字号" } }),
      section("s2", { type: "短文本", layout: { col: 4, row: 1, w: 3, h: 1, cols: 5, max: 6, tone: 1, overflow: "缩小字号" } }),
    ]));
    expect(boxes[0]!.color).toBe("#F2C6C2");   // tone 1 = 粉
    expect(boxes[1]!.color).toBe("#FAF9F6");   // 文本类恒浅灰，不看 tone
  });
});

describe("未排版的模板（19 个内置的形态）—— 走渲染时用的同一个自动布局", () => {
  const autoSections = [
    section("s1", { name: "用户描述", order: 0 }),
    section("s2", { name: "目标和需求", order: 1 }),
    section("s3", { name: "行为与偏好", order: 2 }),
    section("s4", { name: "痛点和挑战", order: 3 }),
  ];

  it("**画得出色块**——这正是人类反馈要的「可视化预览」，不是一行文字说明", () => {
    const boxes = thumbBoxesOf(tpl(autoSections));
    expect(boxes).toHaveLength(4);
  });

  it("每个色块都落在 0-100% 之内，不会溢出纸面", () => {
    for (const b of thumbBoxesOf(tpl(autoSections))) {
      expect(b.leftPct).toBeGreaterThanOrEqual(0);
      expect(b.topPct).toBeGreaterThanOrEqual(0);
      expect(b.leftPct + b.widthPct).toBeLessThanOrEqual(100.01);
      expect(b.topPct + b.heightPct).toBeLessThanOrEqual(100.01);
    }
  });

  it("4 个分区排成 2×2 —— 与 computeAutoLayout 的分档表一致（不是另算一套）", () => {
    const boxes = thumbBoxesOf(tpl(autoSections));
    const lefts = new Set(boxes.map((b) => Math.round(b.leftPct)));
    const tops = new Set(boxes.map((b) => Math.round(b.topPct)));
    expect(lefts.size).toBe(2);
    expect(tops.size).toBe(2);
  });

  it("色块互不重叠", () => {
    const boxes = thumbBoxesOf(tpl(autoSections));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlapX = a.leftPct < b.leftPct + b.widthPct - 0.01 && b.leftPct < a.leftPct + a.widthPct - 0.01;
        const overlapY = a.topPct < b.topPct + b.heightPct - 0.01 && b.topPct < a.topPct + a.heightPct - 0.01;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});

describe("空模板", () => {
  it("零分区 ⇒ 零色块（界面另有一句「空模板 · 还没有分区」）", () => {
    expect(thumbBoxesOf(tpl([]))).toEqual([]);
  });
});
