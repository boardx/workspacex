import { describe, expect, it } from "vitest";
import type { GuidedResearchSession } from "@/lib/guided-research-api";
import { clampGuidedResearchStep, maxGuidedResearchStep } from "@/lib/guided-research-stage";

function session(resumeStage: GuidedResearchSession["resumeStage"]): GuidedResearchSession {
  return { resumeStage } as GuidedResearchSession;
}

describe("guided research stage gate", () => {
  it("maps each persisted server stage to its furthest accessible step", () => {
    expect(maxGuidedResearchStep(session("directions"))).toBe("directions");
  });

  it("clamps navigation requests beyond the persisted session stage", () => {
    expect(clampGuidedResearchStep("report", session("outline"))).toBe("outline");
    expect(clampGuidedResearchStep("brief", session("researching"))).toBe("brief");
    expect(clampGuidedResearchStep("search", session("researching"))).toBe("search");
    expect(clampGuidedResearchStep("report", session("report"))).toBe("report");
  });
});
