import { z } from "zod";
import {
  AIDT_PRIMARY_SURPRISE_ID, confirmedAidtDefinitionSurprises, invalidateAidtDefinitionSurpriseLinks,
  isAidtDefinitionHmwReady, isAidtDefinitionPersonaReady, isAidtDefinitionSurpriseReady, readAidtDefinition, readAidtDefinitionSelection,
  saveAidtDefinitionHmw, saveAidtDefinitionPersona, saveAidtDefinitionSurprise,
} from "./aidt-definition";
import { isAidtSurpriseConfirmed, parseAidtSurpriseReflection } from "./aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

export type AidtDefinitionTurn = { id: string; role: string; content?: unknown };
export type AidtDefinitionKind = "surprise" | "persona" | "hmw";
const short = z.string().trim().max(220);
const note = z.string().trim().max(400);
const refs = z.array(z.string().min(1).max(256)).max(16);
const kind = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("surprise"), status: z.enum(["none", "found"]), priorBelief: note.optional(), observation: note.optional(), interpretation: note.optional(), unknowns: note.optional(), cardIds: refs.optional() }).strict(),
  z.object({ kind: z.literal("persona"), name: short, situation: note, behavior: note, need: note, limits: note.optional(), cardIds: refs.optional(), surpriseIds: refs.optional() }).strict(),
  z.object({ kind: z.literal("hmw"), text: short, rationale: note.optional(), cardIds: refs.optional(), personaIds: refs.optional(), surpriseIds: refs.optional() }).strict(),
]);
export type AidtDefinitionProposal = z.infer<typeof kind>;
export type AidtDefinitionCandidate = { messageId: string; proposal: AidtDefinitionProposal };
export const aidtDefinitionChatMessageKey = (entityId: string) => "definitionChatSource:" + entityId;
const primaryEntityKey = "definitionPrimaryEntity";

export function hasAidtPrimarySurpriseEntity(draft: AidtUiStageDraft) {
  return draft.fields[primaryEntityKey] === "true";
}

export function enableAidtPrimarySurpriseEntity(draft: AidtUiStageDraft) {
  return hasAidtPrimarySurpriseEntity(draft) || Object.keys(draft.fields).length >= 95
    ? draft : { ...draft, fields: { ...draft.fields, [primaryEntityKey]: "true" } };
}

export function aidtDefinitionEntityKind(draft: AidtUiStageDraft, entityId: string): AidtDefinitionKind | null {
  if (entityId === AIDT_PRIMARY_SURPRISE_ID) return hasAidtPrimarySurpriseEntity(draft) ? "surprise" : null;
  const value = readAidtDefinition(draft.fields);
  if (value.personas.some(item => item.id === entityId && !item.archived)) return "persona";
  if (value.hmws.some(item => item.id === entityId && !item.archived)) return "hmw";
  if (value.surprises.some(item => item.id === entityId && !item.archived)) return "surprise";
  return null;
}

const fence = /(?:^|\n)```aidt-definition\s*\n([\s\S]{1,4096}?)\n```(?=\n|$)/u;
const noSurprise = /^(?:暂无(?:意外发现)?|没有意外发现)[。！!]?$/u;

/** A proposal is scoped to this native conversation. Plain questions and other tools never become artifacts. */
export function latestAidtDefinitionCandidate(messages: readonly AidtDefinitionTurn[], entityKind: AidtDefinitionKind, allowNone = false): AidtDefinitionCandidate | null {
  let candidate: AidtDefinitionCandidate | null = null;
  let hasStudent = false;
  for (const message of messages) {
    if (typeof message.content !== "string" || !message.content.trim() || !message.id) continue;
    if (message.role === "user") {
      hasStudent = true;
      if (entityKind === "surprise" && allowNone && noSurprise.test(message.content.trim())) {
        candidate = { messageId: message.id, proposal: { kind: "surprise", status: "none" } };
      }
      continue;
    }
    if (message.role !== "assistant" || !hasStudent) continue;
    const block = fence.exec(message.content);
    if (!block) continue;
    try {
      const parsed = kind.safeParse(JSON.parse(block[1]!));
      if (parsed.success && parsed.data.kind === entityKind && (parsed.data.kind !== "surprise" || parsed.data.status !== "none" || candidate?.proposal.kind === "surprise" && candidate.proposal.status === "none")) {
        candidate = { messageId: message.id, proposal: parsed.data };
      }
    } catch { /* Other message text remains available in the conversation. */ }
  }
  return candidate;
}

function allowedIds(requested: readonly string[] | undefined, current: readonly string[], available: ReadonlySet<string>): string[] {
  return [...new Set((requested ?? current).filter(id => available.has(id)))];
}

export function applyAidtDefinitionCandidate(
  draft: AidtUiStageDraft, entityId: string, candidate: AidtDefinitionCandidate,
  cards: readonly AidtDiscoveryCardDraft[], revision: number | undefined,
): AidtUiStageDraft {
  const key = aidtDefinitionChatMessageKey(entityId);
  const value = candidate.proposal;
  if (draft.fields[key] === candidate.messageId || aidtDefinitionEntityKind(draft, entityId) !== value.kind
    || candidate.messageId.length > 256 || (!Object.hasOwn(draft.fields, key) && Object.keys(draft.fields).length >= 95)) return draft;
  const current = readAidtDefinition(draft.fields);
  const knownCards = new Set(cards.map(card => card.id));
  const surpriseIds = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(surprise => surprise.id));
  let next = draft;
  if (value.kind === "persona") {
    const existing = current.personas.find(item => item.id === entityId);
    if (existing) next = saveAidtDefinitionPersona(draft, {
      ...existing, name: value.name, situation: value.situation, behavior: value.behavior, need: value.need,
      limits: value.limits ?? existing.limits, cardIds: existing.cardIds.length ? existing.cardIds : allowedIds(value.cardIds, existing.cardIds, knownCards),
      surpriseIds: allowedIds(value.surpriseIds, existing.surpriseIds ?? [], surpriseIds), confirmed: false,
    }, revision ?? null);
  } else if (value.kind === "hmw") {
    const existing = current.hmws.find(item => item.id === entityId);
    if (existing) next = saveAidtDefinitionHmw(draft, {
      ...existing, text: value.text, rationale: value.rationale ?? existing.rationale,
      personaIds: allowedIds(value.personaIds, existing.personaIds, new Set(current.personas.filter(item => item.confirmed && !item.archived).map(item => item.id))).slice(0, 12),
      cardIds: existing.cardIds.length ? existing.cardIds : allowedIds(value.cardIds, existing.cardIds, knownCards),
      surpriseIds: allowedIds(value.surpriseIds, existing.surpriseIds ?? [], surpriseIds), confirmed: false,
    }, revision ?? null);
  } else if (entityId === AIDT_PRIMARY_SURPRISE_ID) {
    const old = parseAidtSurpriseReflection(draft, cards, revision);
    const ids = value.status === "found" ? allowedIds(value.cardIds, old.cardIds, knownCards) : [];
    next = { ...draft, fields: { ...draft.fields,
      surpriseStatus: value.status, priorBelief: value.priorBelief ?? "", surprisingFinding: value.observation ?? "",
      surpriseInterpretation: [value.interpretation, value.unknowns].filter(Boolean).join("\n"), surpriseSourceDetails: "",
      surpriseCardIds: JSON.stringify(ids), surpriseSourceRevision: ids.length && revision ? String(revision) : "", surpriseConfirmed: "",
    } };
    next = invalidateAidtDefinitionSurpriseLinks(next, entityId);
  } else if (value.status === "found") {
    const existing = current.surprises.find(item => item.id === entityId);
    if (existing) next = saveAidtDefinitionSurprise(draft, {
      ...existing, priorBelief: value.priorBelief ?? existing.priorBelief, observation: value.observation ?? existing.observation,
      interpretation: value.interpretation ?? existing.interpretation, unknowns: value.unknowns ?? existing.unknowns,
      cardIds: allowedIds(value.cardIds, existing.cardIds, knownCards), confirmed: false,
    }, revision ?? null);
  }
  return next === draft ? draft : { ...next, fields: { ...next.fields, [key]: candidate.messageId } };
}

export function aidtDefinitionEntityConfirmed(draft: AidtUiStageDraft | undefined, entityId: string, cards?: readonly AidtDiscoveryCardDraft[], revision?: number) {
  if (!draft) return false;
  if (entityId === AIDT_PRIMARY_SURPRISE_ID) return isAidtSurpriseConfirmed(draft, cards, revision);
  const { personas, hmws, surprises } = readAidtDefinition(draft.fields);
  return [...personas, ...hmws, ...surprises].some(item => item.id === entityId && item.confirmed && !item.archived);
}

export function confirmAidtDefinitionChatEntity(
  draft: AidtUiStageDraft, entityId: string, cards: readonly AidtDiscoveryCardDraft[], revision?: number,
): AidtUiStageDraft {
  const current = readAidtDefinition(draft.fields);
  if (current.invalid || !aidtDefinitionEntityKind(draft, entityId)) return draft;
  const cardIds = new Set(cards.map(card => card.id));
  const surpriseIds = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(item => item.id));
  if (entityId === AIDT_PRIMARY_SURPRISE_ID) {
    const primary = parseAidtSurpriseReflection(draft, cards, revision);
    if (!primary.ready || primary.confirmed || (primary.status === "found" && !primary.cardIds.length)) return draft;
    return { ...draft, fields: { ...draft.fields, surpriseConfirmed: "true" } };
  }
  if (!isAidtSurpriseConfirmed(draft, cards, revision)) return draft;
  const persona = current.personas.find(item => item.id === entityId);
  if (persona && !persona.confirmed && revision && isAidtDefinitionPersonaReady(persona, cardIds, surpriseIds)) {
    return saveAidtDefinitionPersona(draft, { ...persona, confirmed: true }, revision);
  }
  const hmw = current.hmws.find(item => item.id === entityId);
  if (hmw && !hmw.confirmed && revision && isAidtDefinitionHmwReady(hmw, current.personas, cardIds, surpriseIds)) {
    return saveAidtDefinitionHmw(draft, { ...hmw, confirmed: true }, revision);
  }
  const surprise = current.surprises.find(item => item.id === entityId);
  if (surprise && !surprise.confirmed && revision && isAidtDefinitionSurpriseReady(surprise, cardIds)) {
    return saveAidtDefinitionSurprise(draft, { ...surprise, confirmed: true }, revision);
  }
  return draft;
}

/** Empty or partially confirmed directories never unlock the handoff. */
export function allAidtDefinitionEntitiesConfirmed(draft: AidtUiStageDraft) {
  const { personas, hmws, surprises, invalid } = readAidtDefinition(draft.fields);
  if (invalid || draft.fields.surpriseConfirmed !== "true" || !readAidtDefinitionSelection(draft.fields)) return false;
  const primary = parseAidtSurpriseReflection(draft);
  if (primary.status !== "none" && (primary.status !== "found" || !primary.priorBelief.trim()
    || !primary.surprisingFinding.trim() || primary.invalidCardIds || (!primary.sourceDetails.trim() && !primary.sourceRevision))) return false;

  const activePersonas = personas.filter(item => !item.archived);
  const activeHmws = hmws.filter(item => !item.archived);
  const activeSurprises = surprises.filter(item => !item.archived);
  // The linked card state was checked when confirmation was written. The stage stores immutable
  // source coordinates, so advancing the current interview head does not revoke a prior confirmation.
  const recordedCards = new Set([...activePersonas, ...activeHmws, ...activeSurprises].flatMap(item => item.cardIds));
  const recordedSurprises = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(item => item.id));
  return activeSurprises.every(item => item.confirmed && isAidtDefinitionSurpriseReady(item, recordedCards))
    && activePersonas.every(item => item.confirmed && isAidtDefinitionPersonaReady(item, recordedCards, recordedSurprises))
    && activeHmws.every(item => item.confirmed && isAidtDefinitionHmwReady(item, activePersonas, recordedCards, recordedSurprises));
}
