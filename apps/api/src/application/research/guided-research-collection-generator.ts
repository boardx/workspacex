import { research as C } from "@repo/contracts";
import { z } from "zod";
import { ModelCallError, type ModelCallPort } from "../agent-run/ports";
import { extractJson } from "./guided-structured-json";

type BriefNodeState = z.infer<typeof C.BriefNodeInputState>;
type DirectionsNodeState = z.infer<typeof C.DirectionsNodeInputState>;
type OutlineNodeState = z.infer<typeof C.OutlineNodeInputState>;
type ResearchNodeState = z.infer<typeof C.ResearchNodeInputState>;

export const GUIDED_RESEARCH_COLLECTION_GENERATOR = Symbol("GuidedResearchCollectionGenerator");

export const GUIDED_RESEARCH_COLLECTION_MODEL_ID = "qwen3.7-plus";
export const GUIDED_RESEARCH_COLLECTION_SCHEMA_VERSION = "guided-research-collection:v1";

export class GuidedResearchCollectionGenerationError extends Error {
  constructor(readonly reasonCode: "RESEARCH_WORKFLOW_UNAVAILABLE" | "RESEARCH_NODE_STATE_INVALID") {
    super(reasonCode);
  }
}

export interface GuidedResearchCollectionGeneration {
  readonly state: ResearchNodeState;
  readonly modelProvider: string;
  readonly modelId: typeof GUIDED_RESEARCH_COLLECTION_MODEL_ID;
  readonly modelInvocationId: string;
  readonly modelOutputSchemaVersion: typeof GUIDED_RESEARCH_COLLECTION_SCHEMA_VERSION;
}

export interface GuidedResearchCollectionGenerator {
  generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly brief: BriefNodeState;
    readonly directions: DirectionsNodeState;
    readonly outline: OutlineNodeState;
  }): Promise<GuidedResearchCollectionGeneration>;
}

export class ModelGuidedResearchCollectionGenerator implements GuidedResearchCollectionGenerator {
  constructor(
    private readonly model: ModelCallPort,
    private readonly modelProvider = process.env.KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER
      ?? process.env.KERNEL_MODEL_PROVIDER
      ?? "",
  ) {}

  async generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly brief: BriefNodeState;
    readonly directions: DirectionsNodeState;
    readonly outline: OutlineNodeState;
  }): Promise<GuidedResearchCollectionGeneration> {
    let completion: { readonly text: string };
    try {
      completion = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: GUIDED_RESEARCH_COLLECTION_MODEL_ID,
        system: [
          "You prepare a BoardX deep_research Web Search execution snapshot.",
          "Return JSON only. Do not include markdown, prose, comments, or citations outside JSON.",
          "The response schema is exactly: {\"currentQuery\":string,\"tasks\":[{\"id\":string,\"sectionId\":string,\"label\":string,\"query\":string,\"status\":\"queued\"|\"running\"|\"completed\"|\"failed\",\"sourceIds\":string[]}],\"sources\":[{\"id\":string,\"domain\":string,\"title\":string,\"url\":string,\"kind\":string,\"confidence\":\"高\"|\"中\"|\"低\",\"summary\":string}]}",
          "Create one task per outline section. Mark tasks completed when sources are available.",
          "Sources must be plausible, non-duplicate, and tied to the brief and enabled directions. Prefer official, institutional, or industry-report sources.",
        ].join("\n"),
        user: JSON.stringify({
          workflowType: "deep_research",
          sessionId: input.sessionId,
          brief: input.brief,
          directions: input.directions.directions.filter((direction) => direction.enabled),
          outline: input.outline.sections,
        }),
      });
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw new GuidedResearchCollectionGenerationError("RESEARCH_WORKFLOW_UNAVAILABLE");
      }
      throw error;
    }

    let parsed: z.infer<typeof C.GuidedResearchCollectionGenerationResponse>;
    try {
      parsed = C.GuidedResearchCollectionGenerationResponse.parse(extractJson(completion.text));
    } catch {
      throw new GuidedResearchCollectionGenerationError("RESEARCH_NODE_STATE_INVALID");
    }

    const sourceIds = new Set(parsed.sources.map((source) => source.id));
    const acceptedSourceIds = parsed.sources.map((source) => source.id);
    const tasks = parsed.tasks.map((task) => ({
      ...task,
      sourceIds: task.sourceIds.filter((sourceId) => sourceIds.has(sourceId)),
      status: task.sourceIds.some((sourceId) => sourceIds.has(sourceId)) ? task.status : "queued" as const,
    }));

    return {
      state: C.ResearchNodeInputState.parse({
        currentQuery: parsed.currentQuery,
        tasks,
        sources: parsed.sources,
        acceptedSourceIds,
        excludedSourceIds: [],
      }),
      modelProvider: this.modelProvider,
      modelId: GUIDED_RESEARCH_COLLECTION_MODEL_ID,
      modelInvocationId: `${input.sessionId}:${input.requestId}:qwen3.7-plus`,
      modelOutputSchemaVersion: GUIDED_RESEARCH_COLLECTION_SCHEMA_VERSION,
    };
  }
}
