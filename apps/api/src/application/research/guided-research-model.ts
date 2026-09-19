/**
 * Which model the Guided Research generators actually CALL.
 *
 * The contract pins the *reported* `modelId` of directions/outline nodes to the literal
 * `qwen3.7-plus` (`packages/contracts/src/research.ts`), and `packages/contracts` is not ours
 * to change here. WorkspaceX Local has no such model: every call went to Ollama with an id it
 * does not serve and failed as RESEARCH_WORKFLOW_UNAVAILABLE (#3749 B1.5). This resolves the
 * id used for the invocation only; what is recorded on the node stays the contract literal.
 */
export const GUIDED_RESEARCH_REPORTED_MODEL_ID = "qwen3.7-plus";

export function guidedResearchInvocationModelId(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.KERNEL_GUIDED_RESEARCH_MODEL_ID ?? "").trim();
  return override || GUIDED_RESEARCH_REPORTED_MODEL_ID;
}

const ITEMS = { type: "array", items: { type: "string" }, maxItems: 12 } as const;

/** Mirrors `research.GuidedResearchDirectionGenerationResponse` (#3749 B1.4). */
export const GUIDED_RESEARCH_DIRECTIONS_RESPONSE_SCHEMA = {
  name: "guided_research_directions",
  schema: {
    type: "object",
    properties: { directions: { type: "array", minItems: 1, items: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" },
        decisionQuestions: ITEMS, hypotheses: ITEMS, comparisonDimensions: ITEMS, evidenceNeeds: ITEMS,
        enabled: { type: "boolean" }, order: { type: "integer", minimum: 0 } },
      required: ["id", "title", "description", "enabled", "order"], additionalProperties: false } } },
    required: ["directions"], additionalProperties: false,
  },
} as const;

/** Mirrors `research.GuidedResearchOutlineGenerationResponse` (#3749 B1.4). */
export const GUIDED_RESEARCH_OUTLINE_RESPONSE_SCHEMA = {
  name: "guided_research_outline",
  schema: {
    type: "object",
    properties: { sections: { type: "array", minItems: 1, items: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" },
        questions: { type: "array", items: { type: "string" }, minItems: 1 },
        objective: { type: "string" }, analysisApproach: { type: "string" }, expectedOutput: { type: "string" },
        subsections: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id", "title"], additionalProperties: false } },
        enabled: { type: "boolean" }, order: { type: "integer", minimum: 0 } },
      required: ["id", "title", "questions", "enabled", "order"], additionalProperties: false } } },
    required: ["sections"], additionalProperties: false,
  },
} as const;
