/**
 * `TemplateCanvasGrid` 的「超出时」渲染分支——2026-09-01 人类反馈「便利贴太大装不下」
 * 修复的钉子：`layout.overflow` 此前只用来拼一句警告文案，三个选项渲染出来长得
 * 一模一样。这里直接挂组件本体，反证三个选项现在真的产出不同的 DOM：
 *  · 「叠放」：装不下时最后一格换成 `+N` 堆叠 tile，而不是把超出的数据整段裁掉；
 *  · 「截断」：贴纸文字套 `-webkit-line-clamp`，不是无限延伸/被外层硬裁；
 *  · 「缩小字号」：贴纸字号随这条数据的文字长度变化，长文字字号明显更小。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { TemplateCanvasGrid } from "@/components/canvas/template-canvas-grid";
import type { SectionDraft, SectionLayoutDraft } from "@/components/canvas/template-editor-model";

function listSection(overflow: SectionLayoutDraft["overflow"], max: number): SectionDraft {
  return {
    sectionId: "s1",
    key: "items",
    name: "关键合作伙伴",
    type: "便利贴列表",
    aiHint: null,
    order: 0,
    required: false,
    capacity: null,
    layout: { col: 1, row: 1, w: 3, h: 3, cols: 1, max, tone: 0, overflow },
  };
}

const LONG_TEXT = "提供底层大语言模型API及算力支持的AI技术厂商，同时承担持续训练与算力调度的责任";

function renderGrid(section: SectionDraft, runData: Record<string, unknown>) {
  return render(
    <TemplateCanvasGrid
      sections={[section]}
      gridCols={12}
      showSample={false}
      runData={runData}
      selectedId={null}
      editable={false}
      title=""
      footer=""
      onSelect={() => {}}
      onPlace={() => {}}
      onMove={() => {}}
    />,
  );
}

describe("TemplateCanvasGrid —— overflow 策略真的驱动渲染，不再是白配的文案", () => {
  it("「叠放」：数据条数超过容量时，渲染 +N 堆叠 tile，而不是让数据整段消失", () => {
    const { getByTestId } = renderGrid(
      listSection("叠放", 99),
      { items: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] },
    );
    const stack = getByTestId("tpladmin-editor-stack-s1");
    expect(stack.textContent).toMatch(/^\+\d+$/);
  });

  it("非「叠放」（缩小字号）：装不下时不产出堆叠 tile，仍走原有的「装不下」警告文案", () => {
    const { queryByTestId, getByTestId } = renderGrid(
      listSection("缩小字号", 99),
      { items: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] },
    );
    expect(queryByTestId("tpladmin-editor-stack-s1")).toBeNull();
    expect(getByTestId("tpladmin-editor-overflow-s1")).toBeInTheDocument();
  });

  it("「截断」：贴纸文字节点套了 line-clamp 样式，不是无限制延伸", () => {
    const { getByTestId } = renderGrid(listSection("截断", 6), { items: [LONG_TEXT] });
    const block = getByTestId("tpladmin-editor-block-s1");
    const note = within(block).getByText(LONG_TEXT);
    expect(note.style.webkitLineClamp).not.toBe("");
    expect(note.style.overflow).toBe("hidden");
  });

  it("「缩小字号」：长文字的贴纸字号明显小于短文字，同一容量、同一贴纸实尺下按内容自适应", () => {
    const short = renderGrid(listSection("缩小字号", 6), { items: ["短"] });
    const shortNote = within(short.container).getByText("短");
    const shortPx = parseFloat(shortNote.style.fontSize);
    short.unmount();

    const long = renderGrid(listSection("缩小字号", 6), { items: [LONG_TEXT] });
    const longNote = within(long.container).getByText(LONG_TEXT);
    const longPx = parseFloat(longNote.style.fontSize);
    long.unmount();

    expect(longPx).toBeLessThan(shortPx);
  });

  it("「截断」模式下字号不额外按文字长度收缩——与「缩小字号」两个选项行为要长得不一样", () => {
    const long = renderGrid(listSection("截断", 6), { items: [LONG_TEXT] });
    const note = within(long.container).getByText(LONG_TEXT);
    const notePx = note.style.fontSize;
    long.unmount();

    const short = renderGrid(listSection("截断", 6), { items: ["短"] });
    const shortNote = within(short.container).getByText("短");
    const shortPx = shortNote.style.fontSize;
    short.unmount();

    expect(notePx).toBe(shortPx);
  });
});
