import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const phase = join(__dirname, "../../../../phases/phase-19-board-visual-workspace");
const proposal = join(phase, "design-deltas/board-object-authoring-proposal");

describe("unsigned Board object authoring proposal material", () => {
  it("references every real preview screenshot exactly once", () => {
    const ui = readFileSync(join(proposal, "ui.md"), "utf8");
    const refs = [...ui.matchAll(/\b([a-z-]+\.png)\b/g)].map((match) => match[1]);
    const actual = readdirSync(join(phase, "ui-preview/board-object-authoring")).filter((name) => name.endsWith(".png"));
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.sort()).toEqual(actual.sort());
  });

  it("keeps the unsigned proposal outside formal contracts and S01 confirmation", () => {
    expect(existsSync(join(phase, "contracts/board-object-authoring"))).toBe(false);
    const coherence = readFileSync(join(phase, "design-coherence.md"), "utf8");
    expect(coherence).toContain("covers_bundles: [board-fabric-surface]");
    expect(coherence).toContain("status: confirmed");
    for (const name of ["design-signoff.md", "design-coherence-review.md"]) {
      expect(readFileSync(join(proposal, name), "utf8")).toMatch(/^status: pending$/m);
    }
  });
});
