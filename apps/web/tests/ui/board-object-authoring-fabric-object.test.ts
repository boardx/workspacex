// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Group, Textbox } from "fabric";
import {
  RESIZE_CAPTURE_BOUNDS,
  STICKY_TEXT_HORIZONTAL_PADDING,
  createAuthoringFabricObject,
  getAuthoringSceneObjects,
} from "@/components/whiteboard/authoring-preview/board-object-authoring-surface";

describe("board object authoring real Fabric projection", () => {
  it("wraps the auto-height CJK copy inside the sticky and before the property panel", () => {
    const model = getAuthoringSceneObjects("resize").find((object) => object.resizeMode === "auto-height");
    expect(model).toBeDefined();

    const projected = createAuthoringFabricObject(model!);
    expect(projected).toBeInstanceOf(Group);
    const children = (projected as Group).getObjects();
    const text = children.find((child) => child instanceof Textbox);
    expect(text).toBeInstanceOf(Textbox);
    expect((text as Textbox).splitByGrapheme).toBe(true);
    expect((text as Textbox).width).toBe(model!.width - STICKY_TEXT_HORIZONTAL_PADDING);

    const textBounds = text!.getBoundingRect();
    const groupBounds = projected.getBoundingRect();
    expect(textBounds.width).toBeLessThanOrEqual(model!.width - STICKY_TEXT_HORIZONTAL_PADDING + 1);
    expect(groupBounds.width).toBeLessThanOrEqual(model!.width + 1);
    expect(groupBounds.left + groupBounds.width).toBeLessThanOrEqual(930);
    expect(groupBounds.left + groupBounds.width).toBeLessThanOrEqual(RESIZE_CAPTURE_BOUNDS.right);
    expect(textBounds.height).toBeLessThan(model!.height);
  });

  it("keeps every short sticky projection inside its declared width", () => {
    for (const scene of ["default", "continuous"] as const) {
      for (const model of getAuthoringSceneObjects(scene).filter((object) => object.kind !== "text")) {
        const projected = createAuthoringFabricObject(model);
        expect(projected).toBeInstanceOf(Group);
        expect(projected.getBoundingRect().width).toBeLessThanOrEqual(model.width + 1);
        const text = (projected as Group).getObjects().find((child) => child instanceof Textbox) as Textbox;
        expect(text.splitByGrapheme).toBe(true);
        expect(text.width).toBe(model.width - STICKY_TEXT_HORIZONTAL_PADDING);
      }
    }
  });

  it("preserves standalone Text as a freely selectable Textbox rather than a sticky Group", () => {
    const model = getAuthoringSceneObjects("default").find((object) => object.kind === "text");
    expect(model).toBeDefined();
    const projected = createAuthoringFabricObject(model!);
    expect(projected).toBeInstanceOf(Textbox);
    expect(projected).not.toBeInstanceOf(Group);
    expect((projected as Textbox).width).toBe(model!.width);
  });
});
