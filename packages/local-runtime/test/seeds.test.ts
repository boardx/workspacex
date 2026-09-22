import { describe, expect, it } from "vitest";
import { platformLibraryGaps } from "../src/seeds";

describe("platformLibraryGaps", () => {
  it("is empty when the platform org, its skills and its canvas templates are present", () => {
    expect(platformLibraryGaps({ platformOrg: true, officialSkills: 4, canvasTemplates: 19 })).toEqual([]);
  });

  it("names every missing part of a freshly created database", () => {
    const gaps = platformLibraryGaps({ platformOrg: false, officialSkills: 0, canvasTemplates: 0 });
    expect(gaps).toHaveLength(3);
    expect(gaps.join(" ")).toContain("org-platform");
    expect(gaps.join(" ")).toContain("canvas");
  });

  it("still reports a gap when only the org row exists (scripts exited 0 without writing)", () => {
    expect(platformLibraryGaps({ platformOrg: true, officialSkills: 0, canvasTemplates: 0 })).toHaveLength(2);
  });
});
