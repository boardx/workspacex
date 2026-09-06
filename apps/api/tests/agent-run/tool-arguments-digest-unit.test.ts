import { expect, it } from "vitest";
import { toolArgumentsDigest } from "../../src/application/agent-run/tool-arguments-digest";
it("canonicalizes nested JSON objects without changing arrays, values or Unicode", () => {
  expect(toolArgumentsDigest({b: {z: 2, a: "私密"}, a: [1, 2]})).toBe(toolArgumentsDigest({a: [1, 2], b: {a: "私密", z: 2}}));
  expect(toolArgumentsDigest({a: [1, 2]})).not.toBe(toolArgumentsDigest({a: [2, 1]}));
  expect(toolArgumentsDigest({a: "1"})).not.toBe(toolArgumentsDigest({a: 1}));
  expect(toolArgumentsDigest({a: undefined})).toBeNull();
  expect(toolArgumentsDigest({a: Infinity})).toBeNull();
});
