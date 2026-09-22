/**
 * Guided Research 生成器调用模型时用的**结构化输出 schema**（#3749 B1.4）。
 *
 * ⚠ 用哪个模型 id 不在这里回答——唯一事实源是 `guided-model-config.ts` 的
 * `guidedModelConfig()`。本文件此前还有一份 `guidedResearchInvocationModelId()`，
 * 它存在的前提是「契约把 modelId 钉成 `qwen3.7-plus`、不能改」；该 `z.literal`
 * 已放宽为 `z.string().min(1)`，前提消失，那份副本随之删除（同一事实不得声明在两处）。
 */

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
