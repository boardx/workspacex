import { describe, expect, it } from "vitest";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { toBoardFabricObjects } from "@/components/whiteboard/whiteboard-fabric-projection";

const canonical = (id: string, kind: WhiteboardObject["kind"]): WhiteboardObject => ({
  id,
  schemaVersion: 1,
  kind,
  geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 },
  text: `${kind} content`,
  style: {},
  parentId: null,
  orderKey: id,
  ...(kind === "connector" ? { connector: { from: "a", to: "b" } } : {}),
});

describe("Board canonical-to-Fabric projection adapter", () => {
  it("projects square, rectangle, and circle stickies as distinct renderer data", () => {
    const variants = ["square", "rectangle", "circle"] as const;
    const source = variants.map((variant, index) => ({
      ...canonical(`sticky-${variant}`, "sticky"),
      extensionData: {
        thinkingInput: {
          sticky: {
            variant,
            sizing: (["auto-height", "fixed", "auto-size"] as const)[index],
            color: (["#F8D76E", "#12ab34", "#FFFFFF"] as const)[index],
          },
        },
      },
    }));

    const projected = toBoardFabricObjects(source);

    expect(projected.map((object) => object.sticky)).toEqual([
      { variant: "square", sizingMode: "auto-height" },
      { variant: "rectangle", sizingMode: "fixed" },
      { variant: "circle", sizingMode: "auto-size" },
    ]);
    expect(projected.map((object) => object.style.fill)).toEqual(["#F8D76E", "#12AB34", "#FFFFFF"]);
    expect(new Set(projected.map((object) => object.revision)).size).toBe(3);
  });

  it("preserves every validated text style in the renderer projection", () => {
    const source: WhiteboardObject = {
      ...canonical("styled-text", "text"),
      extensionData: {
        thinkingInput: {
          text: {
            preset: "heading",
            fontFamily: "Noto Serif SC",
            fontSize: 36,
            bold: true,
            italic: true,
            underline: true,
            color: "#12ab34",
            alignment: "right",
            lineHeight: 1.75,
            list: "number",
            link: "https://example.com/board",
          },
        },
      },
    };

    expect(toBoardFabricObjects([source])[0]!.style).toMatchObject({
      textPreset: "heading",
      fontFamily: "Noto Serif SC",
      fontSize: 36,
      bold: true,
      italic: true,
      underline: true,
      textColor: "#12AB34",
      alignment: "right",
      lineHeight: 1.75,
      list: "number",
      link: "https://example.com/board",
    });
  });

  it("ignores unknown extension fields, falls back from invalid thinking styles, and never mutates canonical input", () => {
    const source = {
      ...canonical("safe-fallback", "sticky"),
      style: { fill: "#ABCDEF", color: "#123456", fontSize: 27 },
      extensionData: {
        futurePlugin: { payload: [1, 2, 3] },
        thinkingInput: {
          future: { enabled: true },
          sticky: { variant: "star", sizing: "elastic", color: "javascript:bad" },
          text: { preset: "body", fontSize: Number.POSITIVE_INFINITY, color: "not-a-color" },
        },
      },
    } as unknown as WhiteboardObject;
    const before = structuredClone(source);

    const projected = toBoardFabricObjects([source])[0]!;

    expect(projected).toMatchObject({
      sticky: { variant: "square", sizingMode: "auto-height" },
      style: { fill: "#ABCDEF", textColor: "#123456", fontSize: 27 },
    });
    expect(projected.style).not.toHaveProperty("textPreset");
    expect(source).toEqual(before);
  });

  it("keeps unsupported canonical objects visible as locked placeholders with the same identity", () => {
    const source = [canonical("supported", "sticky"), canonical("future", "frame")];

    const projected = toBoardFabricObjects(source);

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ id: "supported", kind: "sticky" });
    expect(projected[1]).toMatchObject({
      id: "future",
      kind: "placeholder",
      locked: true,
      geometry: source[1]!.geometry,
      projectionIssue: { code: "BOARD_OBJECT_UNSUPPORTED", sourceKind: "frame" },
    });
    expect(projected[1]!.content.text).toContain("暂不支持“frame”对象");
    expect(source[1]).toMatchObject({ id: "future", kind: "frame", text: "frame content" });
  });

  it("projects every currently unsupported canonical kind instead of silently filtering records", () => {
    const kinds = ["frame", "group", "connector", "image", "drawing", "extension"] as const;
    const projected = toBoardFabricObjects(kinds.map((kind) => canonical(`object-${kind}`, kind)));

    expect(projected.map((object) => object.id)).toEqual(kinds.map((kind) => `object-${kind}`));
    expect(projected.every((object) => object.kind === "placeholder" && object.locked)).toBe(true);
    expect(projected.map((object) => object.projectionIssue?.sourceKind)).toEqual(kinds);
  });

  it("projects validated content extensions into dedicated Fabric renderer kinds", () => {
    const content = [
      { objectKind: "extension", boardContent: { version: 1, type: "shape", variant: "diamond", fill: "#FFFFFF", borderColor: "#111111", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#111111", horizontalAlign: "center", verticalAlign: "middle" }, expected: "shape" },
      { objectKind: "drawing", boardContent: { version: 1, type: "drawing", strokes: [{ id: "stroke", tool: "pen", points: [{ x: 1, y: 2, pressure: .2 }, { x: 4, y: 6, pressure: .9 }], color: "#111111", width: 3, opacity: 1 }] }, expected: "drawing" },
      { objectKind: "image", boardContent: { version: 1, type: "image", status: "ready", assetId: "asset-1", sourceUrl: "https://example.com/sample.png", mimeType: "image/png", intrinsicWidth: 10, intrinsicHeight: 10, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: "#FFFFFF", borderWidth: 0, cornerRadius: 0, fileName: "sample.png", replacementOf: null, failureCode: null }, expected: "image" },
      { objectKind: "extension", boardContent: { version: 1, type: "tile", tileType: "document", title: "访谈", description: "研究材料", icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] }, expected: "card" },
    ] as const;
    const projected = toBoardFabricObjects(content.map((item, index) => ({ ...canonical(`content-${index}`, item.objectKind), extensionData: { contentObject: item.boardContent } })));
    expect(projected.map((item) => item.kind)).toEqual(content.map((item) => item.expected));
    expect(projected.map((item) => item.boardContent?.type)).toEqual(["shape", "drawing", "image", "tile"]);
    expect(projected[0]?.style).toMatchObject({ fill: "#FFFFFF", stroke: "#111111", borderStyle: "solid", opacity: 1, radius: 0, alignment: "center", verticalAlignment: "middle" });
  });
});
