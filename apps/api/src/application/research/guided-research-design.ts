import type { ResearchRuntime } from "./guided-runtime-ports";
import { ResearchRuntimeError } from "./guided-runtime-ports";
import { research as C } from "@repo/contracts";

export const researchDesignShapes = {
  directions: '[{"id":string,"title":string,"description":string,"decisionQuestions":string[],"hypotheses":string[],"comparisonDimensions":string[],"evidenceNeeds":string[],"enabled":boolean,"order":integer}]',
  outline: '[{"id":string,"title":string,"questions":string[],"objective":string,"analysisApproach":string,"expectedOutput":string,"subsections":[{"id":string,"title":string,"questions":string[]}],"enabled":boolean,"order":integer}]',
};
export function researchDesignInstruction(node: string): string {
  if (node === "brief") return `Identify the actual research subject from the user's goal and focus and write a concise topic in the user's language. Preserve an explicitly supplied real topic, geography and time horizon. A session display name is not a research subject: when topic is ${JSON.stringify(C.DEFAULT_RESEARCH_NAME)}, replace that placeholder with the actual subject grounded in the supplied requirements. Preserve the full goal and focus; do not truncate the requirements into a title or invent a subject or scope.`;
  if (node === "directions") return "Design a decision-oriented research agenda grounded in the brief's geography, time horizon and objectives. Keep descriptions to one concise sentence and metadata lists to 1–2 distinct concise items each; cover the requested scope without repeating the brief or the same rationale in every field. Choose distinct directions that together cover the user's decision, not generic topic labels. For every direction provide decisionQuestions, hypotheses explicitly described as unverified, comparisonDimensions with consistent units/criteria where applicable, and evidenceNeeds naming the type and scope of evidence required. Each list must be nonempty. Explain the direction's relevance in description; do not pretend these hypotheses are findings. Prefer 4–7 substantial directions where the scope warrants it; avoid redundant directions or padding a narrow question.";
  if (node === "outline") return "Turn the enabled research directions into a coherent analytical report outline, preserving their decision questions, hypotheses and evidence needs. Keep output concise: use short single-sentence metadata, 3 distinct subsections per chapter, and omit repeated explanations. Write chapter and subsection titles in the same language as the user's brief; do not fall back to generic English labels such as Evidence, Analysis or Recommendations when the brief is Chinese. For every chapter provide objective, analysisApproach, expectedOutput and 3–5 distinct subsections with stable unique IDs, exact titles and explicit research questions. Chapter questions are overarching questions; subsections operationalize them with comparison criteria, causal mechanisms, alternatives, risks and decision implications where relevant. Plan how to test hypotheses, not predetermined conclusions. expectedOutput describes the analysis/deliverable, not invented findings. Cover every enabled direction and avoid repeating the same questions across chapters. Prefer 5–9 chapters only where justified by scope; do not inflate narrow topics. All metadata is editable and will guide evidence selection and chapter writing.";
  return "";
}
// Legacy/manual drafts remain valid. Newly generated designs must carry the promised depth.
export function validateGeneratedResearchDesign(node: string, value: unknown): void {
  const fail = () => { throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID"); };
  if (node === "brief" && (value as ResearchRuntime["brief"]).topic.trim() === C.DEFAULT_RESEARCH_NAME) fail();
  if (node === "directions") {
    for (const item of value as ResearchRuntime["directions"]) {
      if ([item.decisionQuestions, item.hypotheses, item.comparisonDimensions, item.evidenceNeeds].some((list) => !list?.length)) fail();
    }
  }
  if (node === "outline") {
    for (const item of value as ResearchRuntime["outline"]) {
      if (!item.objective || !item.analysisApproach || !item.expectedOutput || !item.subsections || item.subsections.length < 3
        || new Set(item.subsections.map((part) => part.title.trim())).size !== item.subsections.length) fail();
    }
  }
}

export function preserveResearchDesign(node: string, value: unknown, previous: unknown): unknown {
  if (node === "report" && value && typeof value === "object" && !Array.isArray(value) && previous && typeof previous === "object" && !Array.isArray(previous)) {
    const prior = previous as Record<string, unknown>;
    const retained = Object.fromEntries(["introduction", "conclusion"].filter((field) => !(field in value) && prior[field] !== undefined).map((field) => [field, prior[field]]));
    return { ...retained, ...value };
  }
  if ((node !== "directions" && node !== "outline") || !Array.isArray(value) || !Array.isArray(previous)) return value;
  const fields = node === "directions" ? ["decisionQuestions", "hypotheses", "comparisonDimensions", "evidenceNeeds"] : ["objective", "analysisApproach", "expectedOutput", "subsections"];
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("id" in item)) return item;
    const prior = previous.find((candidate) => candidate && typeof candidate === "object" && candidate.id === item.id);
    if (!prior) return item;
    const retained = Object.fromEntries(fields.filter((field) => !(field in item) && prior[field] !== undefined).map((field) => [field, prior[field]]));
    return { ...retained, ...item };
  });
}
