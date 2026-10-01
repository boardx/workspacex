// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ActiveSelection, Group, Rect, Textbox, util } from "fabric";
import { applyCanonicalObject, createFabricObject, setProjectedTextEditingVisibility } from "@/components/whiteboard/fabric/board-fabric-surface";
import { BOARD_FABRIC_VISUAL } from "@/components/whiteboard/fabric/board-fabric-visual";
import { representableWorldGeometry } from "@/components/whiteboard/fabric/fabric-transform";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const texts = ["研究标题", "这是较长的中文内容，用于验证白板缩窄后自动换行并保持文字的正常比例。", "Long English content wraps without squeezing letters, including averylongwordwithoutspaces."];

describe("real Fabric text keeps font metrics independent of its container", () => {
  it.each(["sticky", "text"] as const)("hides only the %s glyphs while its transparent DOM editor is active", (kind) => {
    const record: BoardFabricObject = {
      id: `${kind}-edit`, kind, revision: 1, orderKey: "a",
      geometry: { x: 10, y: 20, width: 180, height: 120, rotation: 8 },
      style: { fill: "#F8D76E", textColor: "#29261E" }, content: { text: "直接编辑" },
    };
    const projected = createFabricObject(record);
    const label = projected instanceof Group ? projected.getObjects()[1]! : projected;
    const paper = projected instanceof Group ? projected.getObjects()[0]! : undefined;
    setProjectedTextEditingVisibility(projected, record, true);
    expect(label.opacity).toBe(0);
    expect(paper?.opacity).not.toBe(0);
    setProjectedTextEditingVisibility(projected, record, false);
    expect(label.opacity).toBe(1);
  });

  it.each(["text", "sticky", "shape", "ellipse"] as const)("preserves %s glyph proportions through resize, selection and undo", (kind) => {
    const original: BoardFabricObject = {
      id: "text-container", kind, revision: 1, orderKey: "a",
      geometry: { x: 560, y: 402, width: 320, height: 96, rotation: 0 },
      style: { fill: "#f8d76e", textColor: "#222222", fontSize: 18 }, content: { text: texts[0]! },
      ...(kind === "shape" ? { boardContent: { version: 1 as const, type: "shape" as const, variant: "diamond" as const, fill: "#FFFFFF", borderColor: "#111111", borderWidth: 1, borderStyle: "solid" as const, opacity: 1, radius: 0, textColor: "#111111", horizontalAlign: "center" as const, verticalAlign: "middle" as const } } : {}),
    };
    const projected = createFabricObject(original);
    const label = projected instanceof Group ? projected.getObjects()[1] as Textbox : projected as Textbox;
    const assertText = (record: BoardFabricObject) => {
      const glyphTransform = util.qrDecompose(label.calcTransformMatrix());
      expect(glyphTransform.scaleX).toBeCloseTo(1, 7);
      expect(glyphTransform.scaleY).toBeCloseTo(1, 7);
      expect(glyphTransform.skewX).toBeCloseTo(0, 7);
      expect(label.fontSize).toBe(18);
      expect(representableWorldGeometry(projected)).toEqual(record.geometry);
      expect(label.width).toBeCloseTo(record.geometry.width - (kind === "text" ? 0 : kind === "sticky" ? BOARD_FABRIC_VISUAL.sticky.padding * 2 : 32));
    };
    applyCanonicalObject(projected, original, false);
    assertText(original);
    for (const text of texts) {
      const wide = { ...original, revision: 2, content: { text } };
      applyCanonicalObject(projected, wide, false);
      const wideLines = label.textLines.length;
      const narrow = { ...wide, revision: 3, geometry: { ...wide.geometry, width: 120, height: 220, rotation: 27 } };
      const companion = new Rect({ left: 1100, top: 400, width: 80, height: 80 });
      const selection = new ActiveSelection([projected, companion]);
      selection.set({ angle: 17, scaleX: 1.4, scaleY: 0.8 });
      selection.setCoords();
      for (let revision = 3; revision < 7; revision++) {
        applyCanonicalObject(projected, { ...narrow, revision }, false);
        expect(projected.group).toBe(selection);
        assertText(narrow);
      }
      if (text !== texts[0]) expect(label.textLines.length).toBeGreaterThan(wideLines);
      selection.onDeselect();
      assertText(narrow);
      applyCanonicalObject(projected, wide, false);
      assertText(wide);
      expect(label.textLines.length).toBe(wideLines);
    }
  });
});
