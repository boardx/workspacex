import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";
import { readStoredAidtPersonaCanvas } from "@repo/contracts/aidt-persona-canvas";
import { aidtHmwCandidateSourceKey } from "./aidt-hmw-candidates";

type Fields = Readonly<Record<string, string>>;
export const AIDT_DEFINITION_SYNTHETIC_NOTICE = "合成音频软件 QA 来源 · 非真人访谈或真实用户证据；画像和 HMW 仍待真实研究验证。";
export function aidtDefinitionSyntheticCardIds(cardIds: readonly string[], ...sources: readonly Fields[]) {
  return [...new Set(cardIds)].filter(id => sources.some(fields => Object.hasOwn(fields, AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + id))).sort();
}
export function sameAidtDefinitionSyntheticSources(expected: readonly string[] | undefined, actual: readonly string[]) {
  return JSON.stringify([...(expected ?? [])].sort()) === JSON.stringify([...actual].sort());
}
/** Pure projection: persisted nature stays visible without loading a network adapter. */
export function aidtSavedDefinitionSyntheticCardIds(fields: Fields, entityId: string, cardIds: readonly string[]) {
  const persona = readStoredAidtPersonaCanvas(fields, entityId)?.source.syntheticCardIds;
  if (persona?.length) return persona.filter(id => cardIds.includes(id));
  try {
    const value: unknown = JSON.parse(fields[aidtHmwCandidateSourceKey(entityId)] ?? "null");
    return value && typeof value === "object" && "syntheticCardIds" in value && Array.isArray(value.syntheticCardIds)
      ? value.syntheticCardIds.filter((id: unknown): id is string => typeof id === "string" && cardIds.includes(id)) : [];
  } catch { return []; }
}
