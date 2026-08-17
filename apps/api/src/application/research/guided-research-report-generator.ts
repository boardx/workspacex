import { research as C } from "@repo/contracts";
import { z } from "zod";
import { ModelCallError, type ModelCallPort } from "../agent-run/ports";
import { extractJson } from "./guided-structured-json";

type BriefNodeState = z.infer<typeof C.BriefNodeInputState>;
type OutlineNodeState = z.infer<typeof C.OutlineNodeInputState>;
type ResearchNodeState = z.infer<typeof C.ResearchNodeInputState>;
type ReportNodeState = z.infer<typeof C.ReportNodeInputState>;

export const GUIDED_RESEARCH_REPORT_GENERATOR = Symbol("GuidedResearchReportGenerator");

export const GUIDED_RESEARCH_REPORT_MODEL_ID = "qwen3.7-plus";
export const GUIDED_RESEARCH_REPORT_SCHEMA_VERSION = "guided-research-report:v1";

export class GuidedResearchReportGenerationError extends Error {
  constructor(readonly reasonCode: "RESEARCH_WORKFLOW_UNAVAILABLE" | "RESEARCH_NODE_STATE_INVALID") {
    super(reasonCode);
  }
}

export interface GuidedResearchReportGeneration {
  readonly state: ReportNodeState;
  readonly modelProvider: string;
  readonly modelId: typeof GUIDED_RESEARCH_REPORT_MODEL_ID;
  readonly modelInvocationId: string;
  readonly modelOutputSchemaVersion: typeof GUIDED_RESEARCH_REPORT_SCHEMA_VERSION;
}

export interface GuidedResearchReportGenerator {
  generate(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly brief: BriefNodeState;
    readonly outline: OutlineNodeState;
    readonly research: ResearchNodeState;
    readonly revisionInstruction: string;
  }): Promise<GuidedResearchReportGeneration>;
}

export class ModelGuidedResearchReportGenerator implements GuidedResearchReportGenerator {
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
    readonly outline: OutlineNodeState;
    readonly research: ResearchNodeState;
    readonly revisionInstruction: string;
  }): Promise<GuidedResearchReportGeneration> {
    const acceptedSources = input.research.sources.filter((source) => input.research.acceptedSourceIds.includes(source.id));
    let completion: { readonly text: string };
    try {
      completion = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: GUIDED_RESEARCH_REPORT_MODEL_ID,
        system: [
          "You write a BoardX deep_research final report from a confirmed brief, outline, and retained sources.",
          "Return JSON only. Do not include markdown, prose, comments, or citations outside JSON.",
          "The response schema is exactly: {\"title\":string,\"summary\":string,\"sections\":[{\"id\":string,\"title\":string,\"body\":string,\"citationSourceIds\":string[],\"order\":integer}]}",
          "Every section must map to an outline section. Cite only source ids present in retainedSources.",
          "Be explicit when evidence is insufficient; do not invent URLs or source ids.",
        ].join("\n"),
        user: JSON.stringify({
          workflowType: "deep_research",
          sessionId: input.sessionId,
          brief: input.brief,
          outline: input.outline.sections,
          retainedSources: acceptedSources,
          revisionInstruction: input.revisionInstruction,
        }),
      });
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw new GuidedResearchReportGenerationError("RESEARCH_WORKFLOW_UNAVAILABLE");
      }
      throw error;
    }

    let parsed: z.infer<typeof C.GuidedResearchReportGenerationResponse>;
    try {
      parsed = C.GuidedResearchReportGenerationResponse.parse(extractJson(completion.text));
    } catch {
      throw new GuidedResearchReportGenerationError("RESEARCH_NODE_STATE_INVALID");
    }

    const sourceIds = new Set(acceptedSources.map((source) => source.id));
    return {
      state: C.ReportNodeInputState.parse({
        title: parsed.title,
        revisionInstruction: input.revisionInstruction,
        summary: parsed.summary,
        sections: parsed.sections.map((section) => ({
          ...section,
          citationSourceIds: section.citationSourceIds.filter((sourceId) => sourceIds.has(sourceId)),
        })),
        citations: acceptedSources,
      }),
      modelProvider: this.modelProvider,
      modelId: GUIDED_RESEARCH_REPORT_MODEL_ID,
      modelInvocationId: `${input.sessionId}:${input.requestId}:qwen3.7-plus`,
      modelOutputSchemaVersion: GUIDED_RESEARCH_REPORT_SCHEMA_VERSION,
    };
  }
}
