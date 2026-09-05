import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { GuidedResearchCheckpointGenerator } from "../../domain/research/guided-research-checkpoint-generator";
import type { ModelCallPort } from "../agent-run/ports";
import { guidedModelConfig } from "./guided-model-config";
import { extractJson } from "./guided-structured-json";
import { ResearchRuntimeError } from "./guided-runtime-ports";
// Compatibility endpoints also call the model; no production endpoint returns deterministic templates.
export class ModelGuidedResearchCheckpointGenerator implements GuidedResearchCheckpointGenerator {
  constructor(private readonly model: ModelCallPort) {}
  private async generate(node: "directions" | "outline", context: unknown, shape: string) {
    const config = guidedModelConfig();
    try {
      const response = await this.model.complete({ modelProvider: config.provider, modelId: config.id,
        system: `Generate the research ${node}. Return JSON only, in the user's language, exactly ${shape}. Use unique IDs and zero-based contiguous order. Ground all items in the provided context.`, user: JSON.stringify(context) });
      const draft = C.GuidedResearchRuntimeDraft.parse({ node, value: extractJson(response.text) });
      return draft;
    } catch { throw new ResearchRuntimeError("RESEARCH_WORKFLOW_UNAVAILABLE"); }
  }
  async generateDirections(brief: z.infer<typeof C.GuidedResearchBrief>): Promise<readonly z.infer<typeof C.GuidedResearchDirection>[]> {
    const draft = await this.generate("directions", brief, '[{"id":string,"title":string,"description":string,"enabled":boolean,"order":integer}]');
    if (draft.node !== "directions") throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
    return draft.value;
  }
  async generateOutline(directions: readonly z.infer<typeof C.GuidedResearchDirection>[]): Promise<readonly z.infer<typeof C.GuidedResearchOutlineSection>[]> {
    const draft = await this.generate("outline", directions.filter((item) => item.enabled), '[{"id":string,"title":string,"questions":string[],"enabled":boolean,"order":integer}]');
    if (draft.node !== "outline") throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
    return draft.value;
  }
}
