import { research as C } from "@repo/contracts";
import { z } from "zod";
import { ModelCallError, type ModelCallPort } from "../agent-run/ports";
import { extractJson } from "./guided-structured-json";

type DirectionsNodeState = z.infer<typeof C.DirectionsNodeInputState>;
type GuidedResearchWorkflowOutlineSection = z.infer<typeof C.GuidedResearchWorkflowOutlineSection>;

export const GUIDED_RESEARCH_OUTLINE_GENERATOR = Symbol("GuidedResearchOutlineGenerator");

export const GUIDED_RESEARCH_OUTLINE_MODEL_ID = "qwen3.7-plus";
export const GUIDED_RESEARCH_OUTLINE_SCHEMA_VERSION = "guided-research-outline:v1";

export class GuidedResearchOutlineGenerationError extends Error {
  constructor(readonly reasonCode: "RESEARCH_WORKFLOW_UNAVAILABLE" | "RESEARCH_NODE_STATE_INVALID") {
    super(reasonCode);
  }
}

export interface GuidedResearchOutlineGeneration {
  readonly sections: readonly GuidedResearchWorkflowOutlineSection[];
  readonly modelProvider: string;
  readonly modelId: typeof GUIDED_RESEARCH_OUTLINE_MODEL_ID;
  readonly modelInvocationId: string;
  readonly modelOutputSchemaVersion: typeof GUIDED_RESEARCH_OUTLINE_SCHEMA_VERSION;
}

export interface GuidedResearchOutlineGenerator {
  generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly directions: DirectionsNodeState;
  }): Promise<GuidedResearchOutlineGeneration>;
}

const OutlineGenerationResponse = z.object({
  sections: z.array(C.GuidedResearchWorkflowOutlineSection).min(1),
}).strict();

export class ModelGuidedResearchOutlineGenerator implements GuidedResearchOutlineGenerator {
  constructor(
    private readonly model: ModelCallPort,
    private readonly modelProvider = process.env.KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER
      ?? process.env.KERNEL_MODEL_PROVIDER
      ?? "",
  ) {}

  async generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly directions: DirectionsNodeState;
  }): Promise<GuidedResearchOutlineGeneration> {
    let completion: { readonly text: string };
    try {
      completion = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: GUIDED_RESEARCH_OUTLINE_MODEL_ID,
        system: [
          "You generate Guided Research report outlines for BoardX.",
          "Return JSON only. Do not include markdown, prose, citations, or comments.",
          "The response schema is exactly: {\"sections\":[{\"id\":string,\"title\":string,\"description\":string,\"researchQuestions\":string[],\"order\":integer}]}",
          "Generate 3 to 6 ordered sections. Each section must be grounded in the enabled research directions.",
        ].join("\n"),
        user: JSON.stringify({
          sessionId: input.sessionId,
          directions: input.directions.directions.filter((direction) => direction.enabled),
        }),
      });
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw new GuidedResearchOutlineGenerationError("RESEARCH_WORKFLOW_UNAVAILABLE");
      }
      throw error;
    }

    let parsed: z.infer<typeof OutlineGenerationResponse>;
    try {
      parsed = OutlineGenerationResponse.parse(extractJson(completion.text));
    } catch {
      throw new GuidedResearchOutlineGenerationError("RESEARCH_NODE_STATE_INVALID");
    }

    return {
      sections: parsed.sections.map((section, order) => ({ ...section, order })),
      modelProvider: this.modelProvider,
      modelId: GUIDED_RESEARCH_OUTLINE_MODEL_ID,
      modelInvocationId: `${input.sessionId}:${input.requestId}:qwen3.7-plus`,
      modelOutputSchemaVersion: GUIDED_RESEARCH_OUTLINE_SCHEMA_VERSION,
    };
  }
}
