import { research as C } from "@repo/contracts";
import type { z } from "zod";
import { ModelCallError, type ModelCallPort } from "../agent-run/ports";
import { extractJson } from "./guided-structured-json";

type SkillTurnInput = z.infer<typeof C.operations.runGuidedResearchSkillTurn.in>;
type SkillTurnOutput = z.infer<typeof C.operations.runGuidedResearchSkillTurn.out>;

export const GUIDED_RESEARCH_SKILL = Symbol("GuidedResearchSkill");
export const GUIDED_RESEARCH_SKILL_MODEL_ID = "qwen3.7-plus";

export class GuidedResearchSkillError extends Error {
  constructor(readonly reasonCode: "RESEARCH_WORKFLOW_UNAVAILABLE" | "RESEARCH_NODE_STATE_INVALID") {
    super(reasonCode);
  }
}

export interface GuidedResearchSkill {
  turn(input: SkillTurnInput): Promise<SkillTurnOutput>;
}

export class ModelGuidedResearchSkill implements GuidedResearchSkill {
  constructor(
    private readonly model: ModelCallPort,
    private readonly modelProvider = process.env.KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER
      ?? process.env.KERNEL_MODEL_PROVIDER
      ?? "",
  ) {}

  async turn(input: SkillTurnInput): Promise<SkillTurnOutput> {
    let completion: { readonly text: string };
    try {
      completion = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: GUIDED_RESEARCH_SKILL_MODEL_ID,
        system: [
          "You are BoardX's conversational research skill.",
          "Help the user complete the current step of a five-step research workflow.",
          "Return JSON only, with exactly assistantMessage and proposal.",
          "proposal must be {node,value}; node must equal the input draft node and value must be the complete revised draft.",
          "Never claim that a source was searched or verified when no source is present in the draft.",
          "Preserve useful user-authored content unless the user explicitly asks to remove it.",
        ].join("\n"),
        user: JSON.stringify({ message: input.message, draft: input.draft }),
      });
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw new GuidedResearchSkillError("RESEARCH_WORKFLOW_UNAVAILABLE");
      }
      throw error;
    }

    try {
      const parsed = C.GuidedResearchSkillTurnResponse.omit({ modelId: true, modelInvocationId: true })
        .parse(extractJson(completion.text));
      if (parsed.proposal.node !== input.draft.node) {
        throw new GuidedResearchSkillError("RESEARCH_NODE_STATE_INVALID");
      }
      return {
        ...parsed,
        modelId: GUIDED_RESEARCH_SKILL_MODEL_ID,
        modelInvocationId: `${input.requestId}:${GUIDED_RESEARCH_SKILL_MODEL_ID}`,
      };
    } catch (error) {
      if (error instanceof GuidedResearchSkillError) throw error;
      throw new GuidedResearchSkillError("RESEARCH_NODE_STATE_INVALID");
    }
  }
}
