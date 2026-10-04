import { describe, expect, it } from "vitest";
import { supplementQuery } from "../../src/application/research/guided-supplement-query";

describe("supplemental query capacity", () => {
  it("reuses short components' unused capacity", () => {
    const value = supplementQuery("Grid EU", "x".repeat(1000), "primary source");
    expect(value).toHaveLength(1000);
    expect(value).toBe(`Grid EU ${"x".repeat(977)} primary source`);
  });
  it("retains short components regardless of their position", () => {
    const value = supplementQuery("x".repeat(1000), "Grid EU", "primary source");
    expect(value).toHaveLength(1000);
    expect(value.endsWith(" Grid EU primary source")).toBe(true);
  });
  it("preserves all content when it fits", () => {
    expect(supplementQuery(" Grid EU ", " task ", " primary source ")).toBe("Grid EU task primary source");
  });
  it("shares capacity across oversized components", () => {
    const value = supplementQuery("a".repeat(1000), "b".repeat(1000));
    expect(value).toHaveLength(1000);
    expect(value.split(" ").map((part) => part.length)).toEqual([499, 500]);
  });
});
