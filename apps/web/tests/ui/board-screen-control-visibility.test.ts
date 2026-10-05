import { describe, expect, it } from "vitest";
import { boardObjectControlsVisible, boardObjectPortsVisible } from "@/components/whiteboard/screen-control-visibility";
describe("screen-space object chrome", () => {
  it.each([[144,144],[180,180],[240,200]])("adapts a %sx%s note when zoom changes", (width,height) => {
    const geometry={width,height};
    expect(boardObjectControlsVisible(geometry,.22)).toBe(false);
    expect(boardObjectPortsVisible(geometry,.22)).toBe(false);
    expect(boardObjectControlsVisible(geometry,1)).toBe(true);
    expect(boardObjectPortsVisible(geometry,1)).toBe(true);
  });
  it("uses the shorter side and protects neighboring touch targets", () => {
    expect(boardObjectControlsVisible({width:400,height:48},1)).toBe(true);
    expect(boardObjectPortsVisible({width:400,height:95},1)).toBe(false);
    expect(boardObjectPortsVisible({width:400,height:96},1)).toBe(true);
    expect(boardObjectControlsVisible({width:400,height:400},Number.NaN)).toBe(false);
  });
});
