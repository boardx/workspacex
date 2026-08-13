import { research } from "@repo/contracts";
import type { z } from "zod";

type GuidedResearchBrief = z.infer<typeof research.GuidedResearchBrief>;
type GuidedResearchDirection = z.infer<typeof research.GuidedResearchDirection>;
type GuidedResearchOutlineSection = z.infer<typeof research.GuidedResearchOutlineSection>;

export interface GuidedResearchCheckpointGenerator {
  generateDirections(brief: GuidedResearchBrief): Promise<readonly GuidedResearchDirection[]>;
  generateOutline(directions: readonly GuidedResearchDirection[]): Promise<readonly GuidedResearchOutlineSection[]>;
}

export const GUIDED_RESEARCH_CHECKPOINT_GENERATOR = Symbol("GuidedResearchCheckpointGenerator");

export class DeterministicGuidedResearchCheckpointGenerator implements GuidedResearchCheckpointGenerator {
  async generateDirections(brief: GuidedResearchBrief): Promise<readonly GuidedResearchDirection[]> {
    return [
      { id: "direction-market", title: "市场规模与增长动能", description: `围绕「${brief.topic}」拆分市场规模、增长速度与增长质量。`, enabled: true, order: 0 },
      { id: "direction-policy", title: "政策与落地约束", description: `核对${brief.region || "目标区域"}的政策、准入与实际执行摩擦。`, enabled: true, order: 1 },
      { id: "direction-competition", title: "竞争格局与进入路径", description: `以「${brief.goal}」为目标比较自建、合作和渠道进入路径。`, enabled: true, order: 2 },
    ];
  }

  async generateOutline(directions: readonly GuidedResearchDirection[]): Promise<readonly GuidedResearchOutlineSection[]> {
    return directions.filter((item) => item.enabled).sort((a, b) => a.order - b.order).map((item, order) => ({
      id: `section-${item.id}`, title: item.title, questions: [item.description], enabled: true, order,
    }));
  }
}
