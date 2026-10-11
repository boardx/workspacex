import { describe, expect, it } from "vitest";
import { discardInvalidReportCitations } from "../../src/application/research/guided-report-citation-discard";
import { aliasResolver } from "../../src/application/research/guided-report-checkpoint";
const resolve = aliasResolver([{ alias: "S1", sourceId: "own-source" }, { alias: "S2", sourceId: "other-source" }]);
const discard = (body: string) => discardInvalidReportCitations(body, new Set(["own-source"]), resolve);
describe("non-blocking generated citation discard", () => {
  it("keeps exact valid identities and never guesses a replacement for bad references", () => {
    expect(discard("A [[source:S1]] B [[source:S2]] C [[source:S999]] D [[source:own-source]]")).toBe("A [[source:own-source]] B  C  D [[source:own-source]]");
  });
  it.each(["[[source:S999]", "[[source:S999", "[[S999]", "[[source:"])("discards only the malformed token %s and preserves following prose and a good citation", marker => {
    expect(discard(`Before ${marker} Preserve the original gap explanation. [[source:S1]] After`)).toBe("Before  Preserve the original gap explanation. [[source:own-source]] After");
  });
  it("preserves ordinary user prose, numeric footnotes, links and citation examples in code", () => {
    const body = "Keep [1] and [the study](https://example.org/study). `[[source:S999]]`\n\n```text\n[[source:S999\n```\n\nOriginal observations and uncertainty.";
    expect(discard(body)).toBe(body);
  });
  it("allows all references to be discarded without inventing any source", () => {
    expect(discard("The requested outcome was not measured. [[source:S999]]")).toBe("The requested outcome was not measured.");
  });
  it("handles repeated incomplete markers without deleting following substantive prose", () => {
    expect(discard("[[source:".repeat(1000) + " Preserve this conclusion. [[source:S1]]")).toBe("Preserve this conclusion. [[source:own-source]]");
  });
  it("preserves Chinese prose immediately following an incomplete ASCII source identity", () => {
    expect(discard("Before [[source:S999后面的证据缺口说明。 [[source:S1]]")).toBe("Before 后面的证据缺口说明。 [[source:own-source]]");
  });
  it.each(["[[[S1]", "[[[S1]]"])("discards malformed nested brackets without manufacturing a valid reference: %s", marker => {
    expect(discard(`Before ${marker} Keep prose. [[source:S1]]`)).toBe("Before  Keep prose. [[source:own-source]]");
  });
  it("discards a malformed composite reference without leaving broken bracket tokens", () => {
    expect(discard("Before [[S1][S2]] Keep prose. [[source:S1]]")).toBe("Before  Keep prose. [[source:own-source]]");
    expect(discard("Before [[source:S999[[source:S1]] Keep prose.")).toBe("Before [[source:own-source]] Keep prose.");
    expect(discard("Before [[source:S999[1] Keep prose.")).toBe("Before [1] Keep prose.");
  });
});
