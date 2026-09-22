import { research as C } from "@repo/contracts";
import { z } from "zod";
import { ModelCallError, type ModelCallPort } from "../agent-run/ports";
import { guidedModelConfig } from "./guided-model-config";
import { extractJson } from "./guided-structured-json";
import { GUIDED_RESEARCH_DIRECTIONS_RESPONSE_SCHEMA } from "./guided-research-model";

type BriefNodeState = z.infer<typeof C.BriefNodeInputState>;
type GuidedResearchDirection = z.infer<typeof C.GuidedResearchDirection>;

export const GUIDED_RESEARCH_DIRECTION_GENERATOR = Symbol("GuidedResearchDirectionGenerator");

export const GUIDED_RESEARCH_DIRECTION_SCHEMA_VERSION = "guided-research-directions:v1";

export class GuidedResearchDirectionGenerationError extends Error {
  constructor(readonly reasonCode: "RESEARCH_WORKFLOW_UNAVAILABLE" | "RESEARCH_NODE_STATE_INVALID") {
    super(reasonCode);
  }
}

export interface GuidedResearchDirectionGeneration {
  readonly directions: readonly GuidedResearchDirection[];
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelInvocationId: string;
  readonly modelOutputSchemaVersion: typeof GUIDED_RESEARCH_DIRECTION_SCHEMA_VERSION;
}

export interface GuidedResearchDirectionGenerator {
  generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly brief: BriefNodeState;
  }): Promise<GuidedResearchDirectionGeneration>;
}

export class ModelGuidedResearchDirectionGenerator implements GuidedResearchDirectionGenerator {
  constructor(
    private readonly model: ModelCallPort,
    private readonly modelProvider = guidedModelConfig().provider,
    private readonly modelId = guidedModelConfig().id,
  ) {}

  async generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly brief: BriefNodeState;
  }): Promise<GuidedResearchDirectionGeneration> {
    let completion: { readonly text: string };
    try {
      completion = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: this.modelId,
        responseSchema: GUIDED_RESEARCH_DIRECTIONS_RESPONSE_SCHEMA,
        system: [
          "You generate Guided Research directions for BoardX.",
          "Return JSON only. Do not include markdown, prose, citations, or comments.",
          "The response schema is exactly: {\"directions\":[{\"id\":string,\"title\":string,\"description\":string,\"enabled\":boolean,\"order\":integer}]}",
          "Generate 3 to 5 concrete, non-overlapping directions. Every direction must be grounded in the user's brief.",
        ].join("\n"),
        user: JSON.stringify({
          sessionId: input.sessionId,
          brief: input.brief,
        }),
      });
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw new GuidedResearchDirectionGenerationError("RESEARCH_WORKFLOW_UNAVAILABLE");
      }
      throw error;
    }

    let parsed: z.infer<typeof C.GuidedResearchDirectionGenerationResponse>;
    try {
      parsed = C.GuidedResearchDirectionGenerationResponse.parse(extractJson(completion.text));
    } catch {
      throw new GuidedResearchDirectionGenerationError("RESEARCH_NODE_STATE_INVALID");
    }

    return {
      directions: parsed.directions.map((direction, order) => ({ ...direction, order })),
      modelProvider: this.modelProvider,
      modelId: this.modelId,
      modelInvocationId: `${input.sessionId}:${input.requestId}:qwen3.7-plus`,
      modelOutputSchemaVersion: GUIDED_RESEARCH_DIRECTION_SCHEMA_VERSION,
    };
  }
}
