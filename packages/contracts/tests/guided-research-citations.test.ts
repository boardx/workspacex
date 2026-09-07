import { describe, expect, it } from "vitest";
import { research as C } from "../src";
const id = "6182ec9d-c281-423e-ab13-cd8a253d5699";
describe("shared research citation grammar", () => {
  it("normalizes supported exact identifiers without guessing numeric footnotes", () => {
    const map = (value: string) => `<${value}>`;
    expect(C.mapGuidedResearchCitations(`[[source:${id}]] [[${id}]] [${id}] [[S1]] [S1] [1]`, map)).toBe(`<${id}> <${id}> <${id}> <S1> <S1> [1]`);
  });
  it.each(["[[S1]", "[[S1", "[[source:", "[[[S1]]", "[[S1][S2]]"])("never interprets malformed %s as an inner citation", (text) => {
    expect(() => C.mapGuidedResearchCitations(text, () => "VALID", () => { throw new Error("invalid"); })).toThrow("invalid");
  });
  it("leaves literal code examples unchanged and never reparses replacement output", () => {
    expect(C.mapGuidedResearchCitations("`[[S1]]`\n```text\n[[S2]]\n```\n[[S3]]", (id) => `[[source:${id}]]`, () => "BAD")).toBe("`[[S1]]`\n```text\n[[S2]]\n```\n[[source:S3]]");
  });
});
