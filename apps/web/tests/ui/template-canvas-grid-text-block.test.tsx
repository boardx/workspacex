/**
 * 两项用户直接交办的新功能（2026-09-08）的组件级反证：
 *  · 「文本对象」——拖到画布上像标题元素一样落位，渲染时套用它自己的颜色/字号/粗细，
 *    不带 `{{key}}`/列数这些数据绑定字段才有的提示。
 *  · 「隐藏字段名」——数据绑定字段（列表型）设了这个开关后，区块标题/`{{key}}` 提示行
 *    不渲染，内容（贴纸）照常渲染。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TemplateCanvasGrid } from "@/components/canvas/template-canvas-grid";
import type { SectionDraft } from "@/components/canvas/template-editor-model";

function textSection(over: Partial<SectionDraft> = {}): SectionDraft {
  return {
    sectionId: "t1", key: "t1", name: "文本", type: "文本对象", aiHint: null,
    order: 0, required: false, capacity: null,
    layout: { col: 1, row: 1, w: 6, h: 1, cols: 3, max: 6, tone: 0, overflow: "缩小字号" },
    content: "画布大标题", color: "#FF0000", fontSize: 30, fontWeight: "bold",
    hideFieldTitle: false,
    ...over,
  };
}

function listSection(over: Partial<SectionDraft> = {}): SectionDraft {
  return {
    sectionId: "s1", key: "actions", name: "行为", type: "便利贴列表", aiHint: null,
    order: 0, required: false, capacity: null,
    layout: { col: 1, row: 1, w: 6, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" },
    content: "", color: null, fontSize: 24, fontWeight: "normal",
    hideFieldTitle: false,
    ...over,
  };
}

describe("TemplateCanvasGrid —— 「文本对象」画布瓦片", () => {
  it("渲染文字内容，套用自己的颜色/字号/粗细，不出现 {{key}} 提示行", () => {
    const { getByTestId, queryByText } = render(
      <TemplateCanvasGrid
        sections={[textSection()]}
        gridCols={12}
        showSample={false}
        runData={null}
        selectedId={null}
        editable
        title=""
        footer=""
        onSelect={() => {}}
        onPlace={() => {}}
        onMove={() => {}}
      />,
    );
    const content = getByTestId("tpladmin-editor-text-content-t1");
    expect(content.textContent).toBe("画布大标题");
    expect(content.style.color).toBe("rgb(255, 0, 0)");
    expect(content.style.fontSize).toBe("30px");
    expect(content.style.fontWeight).toBe("700");
    // 数据字段才有的 `{{key}}` 徽章不该出现在文本对象上。
    expect(queryByText("{{t1}}")).toBeNull();
  });

  it("就地编辑：失焦时把最新文字写回 onEditText 回调", () => {
    let saved: string | null = null;
    const { getByTestId } = render(
      <TemplateCanvasGrid
        sections={[textSection()]}
        gridCols={12}
        showSample={false}
        runData={null}
        selectedId="t1"
        editable
        title=""
        footer=""
        onSelect={() => {}}
        onPlace={() => {}}
        onMove={() => {}}
        onEditText={(id, content) => { saved = `${id}:${content}`; }}
      />,
    );
    const content = getByTestId("tpladmin-editor-text-content-t1");
    content.textContent = "改过的标题";
    // React 的 onBlur 监听的是原生 `focusout`（冒泡）事件，不是 `blur`（不冒泡）。
    content.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(saved).toBe("t1:改过的标题");
  });
});

describe("TemplateCanvasGrid —— 「隐藏字段名」（用户直接交办，2026-09-08）", () => {
  it("hideFieldTitle=false（默认）：标题/{{key}} 提示行照常渲染", () => {
    const { getByTestId } = render(
      <TemplateCanvasGrid
        sections={[listSection()]}
        gridCols={12}
        showSample
        runData={null}
        selectedId={null}
        editable={false}
        title=""
        footer=""
        onSelect={() => {}}
        onPlace={() => {}}
        onMove={() => {}}
      />,
    );
    expect(getByTestId("tpladmin-editor-block-title-s1")).toBeInTheDocument();
  });

  it("hideFieldTitle=true：标题/{{key}} 提示行不渲染，贴纸内容仍然渲染", () => {
    const { queryByTestId, getByTestId } = render(
      <TemplateCanvasGrid
        sections={[listSection({ hideFieldTitle: true })]}
        gridCols={12}
        showSample
        runData={null}
        selectedId={null}
        editable={false}
        title=""
        footer=""
        onSelect={() => {}}
        onPlace={() => {}}
        onMove={() => {}}
      />,
    );
    expect(queryByTestId("tpladmin-editor-block-title-s1")).toBeNull();
    // 区块本身与贴纸内容照常渲染——只是没有标题。
    expect(getByTestId("tpladmin-editor-block-s1")).toBeInTheDocument();
    expect(getByTestId("tpladmin-editor-block-s1").textContent).toContain("示例");
  });
});
