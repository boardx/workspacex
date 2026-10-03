import type { DraftClaim, ResearchMaterial } from "../../domain/work-content/research-brief";

/** Shared boundary parsing for the standalone runner and checkpointed stage graph. */
export function researchMaterials(value: unknown): ResearchMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ResearchMaterial =>
    typeof item?.ref === "string" && typeof item?.text === "string");
}

export function researchClaims(value: unknown): DraftClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item?.text === "string" && Array.isArray(item?.evidenceRefs))
    .map((item) => ({
      text: item.text as string,
      evidenceRefs: (item.evidenceRefs as unknown[]).filter((ref): ref is string => typeof ref === "string"),
      confidence: item.confidence === "high" || item.confidence === "low" ? item.confidence : "medium",
    }));
}
