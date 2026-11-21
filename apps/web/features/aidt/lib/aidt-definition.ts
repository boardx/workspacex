import { z } from "zod";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

export const AIDT_DEFINITION_ITEM_LIMIT = 12;
export const AIDT_DEFINITION_EVIDENCE_LIMIT = 16;
const evidenceRevisionKey = "definitionEvidenceRevision";
const selectedHmwKey = "definitionHmwId";
const personaPrefix = "definitionPersona:";
const hmwPrefix = "definitionHmw:";
const surprisePrefix = "definitionSurprise:";
export const AIDT_PRIMARY_SURPRISE_ID = "primary-surprise";
const id = z.string().min(1).max(256);
const shortText = z.string().max(220);
const note = z.string().max(400);
const evidenceIds = z.array(id).max(AIDT_DEFINITION_EVIDENCE_LIMIT);
const personaIds = z.array(id).max(AIDT_DEFINITION_ITEM_LIMIT);
const base = z.object({ id, confirmed: z.boolean(), archived: z.boolean(), cardIds: evidenceIds });
const surpriseIds = z.array(id).max(AIDT_DEFINITION_ITEM_LIMIT + 1).optional();
const personaSchema = base.extend({ surpriseIds, name: shortText, situation: note, behavior: note, need: note, limits: note }).strict();
const hmwSchema = base.extend({ surpriseIds, text: shortText, personaIds, rationale: note }).strict();
const surpriseSchema = base.extend({ priorBelief: note, observation: note, interpretation: note, unknowns: note }).strict();
export type AidtDefinitionSurprise = z.infer<typeof surpriseSchema>;
export type AidtDefinitionPersona = z.infer<typeof personaSchema>;
export type AidtDefinitionHmw = z.infer<typeof hmwSchema>;

type Fields = Readonly<Record<string, string>>;
function readRecords<T extends { id: string }>(fields: Fields, prefix: string, schema: z.ZodType<T>) {
  const records: T[] = [];
  let invalid = false;
  for (const [key, text] of Object.entries(fields)) {
    if (!key.startsWith(prefix) || !text) continue;
    try {
      const result = schema.safeParse(JSON.parse(text));
      if (result.success && key === prefix + result.data.id) records.push(result.data);
      else invalid = true;
    } catch { invalid = true; }
  }
  return { records, invalid };
}

export function readAidtDefinition(fields: Fields) {
  const personas = readRecords(fields, personaPrefix, personaSchema);
  const hmws = readRecords(fields, hmwPrefix, hmwSchema);
  const surprises = readRecords(fields, surprisePrefix, surpriseSchema);
  const ids = [AIDT_PRIMARY_SURPRISE_ID, ...personas.records.map(record => record.id), ...hmws.records.map(record => record.id), ...surprises.records.map(record => record.id)];
  return { personas: personas.records, hmws: hmws.records, surprises: surprises.records, invalid: personas.invalid || hmws.invalid || surprises.invalid || new Set(ids).size !== ids.length };
}

export function readAidtDefinitionEvidenceRevision(fields: Fields): number | null {
  const value = fields[evidenceRevisionKey] ?? "";
  if (!/^[1-9]\d*$/.test(value)) return null;
  const revision = Number(value);
  return Number.isInteger(revision) && revision <= 2147483647 ? revision : null;
}

export function aidtDefinitionCards(cards: readonly AidtDiscoveryCardDraft[], fields: Fields) {
  return cards.filter(card => /^[\w-]{1,256}$/.test(card.id) && fields[`interviewConfirmed:${card.id}`] === "true" && fields[`interviewArchived:${card.id}`] !== "true");
}

export function readAidtDefinitionSelection(fields: Fields): { id: string; text: string } | null {
  const selectedId = fields[selectedHmwKey];
  if (!selectedId || !fields.hmw || !readAidtDefinitionEvidenceRevision(fields)) return null;
  const result = readAidtDefinition(fields);
  const selected = result.hmws.find(hmw => hmw.id === selectedId && hmw.confirmed && !hmw.archived);
  if (result.invalid || !selected || selected.text.trim() !== fields.hmw) return null;
  const surprises = new Set(confirmedAidtDefinitionSurprises(fields).map(record => record.id));
  if (!hasConfirmedSurprises(selected, surprises) || !selected.personaIds.length || !selected.personaIds.every(id => result.personas.some(persona => persona.id === id && persona.confirmed && !persona.archived && hasConfirmedSurprises(persona, surprises)))) return null;
  return { id: selectedId, text: fields.hmw };
}

export function confirmedAidtDefinitionSurprises(fields: Fields): { id: string; label: string }[] {
  const primary = fields.surprisingFinding?.trim();
  if (fields.surpriseStatus !== "found" || fields.surpriseConfirmed !== "true" || !primary) return [];
  const { surprises } = readAidtDefinition(fields);
  const confirmed = surprises.filter(item => item.confirmed && !item.archived && item.priorBelief.trim() && item.observation.trim() && item.cardIds.length).map(item => ({ id: item.id, label: item.observation.trim() }));
  return [{ id: AIDT_PRIMARY_SURPRISE_ID, label: primary }, ...confirmed];
}

function hasConfirmedSurprises(value: { surpriseIds?: string[] }, confirmed?: ReadonlySet<string>) {
  return (value.surpriseIds ?? []).every(id => confirmed?.has(id));
}

export function isAidtDefinitionSurpriseReady(record: AidtDefinitionSurprise, availableCardIds: ReadonlySet<string>): boolean {
  return !record.archived && Boolean(record.priorBelief.trim() && record.observation.trim()) && record.cardIds.length > 0 && record.cardIds.every(cardId => availableCardIds.has(cardId));
}

export function isAidtDefinitionPersonaReady(persona: AidtDefinitionPersona, availableCardIds: ReadonlySet<string>, confirmedSurprises?: ReadonlySet<string>): boolean {
  return hasConfirmedSurprises(persona, confirmedSurprises) && !persona.archived && Boolean(persona.name.trim() && persona.situation.trim() && persona.behavior.trim() && persona.need.trim()) && persona.cardIds.length > 0 && persona.cardIds.every(cardId => availableCardIds.has(cardId));
}

export function isAidtDefinitionHmwReady(hmw: AidtDefinitionHmw, personas: readonly AidtDefinitionPersona[], availableCardIds: ReadonlySet<string>, confirmedSurprises?: ReadonlySet<string>): boolean {
  return hasConfirmedSurprises(hmw, confirmedSurprises) && !hmw.archived && Boolean(hmw.text.trim()) && hmw.personaIds.length > 0 && hmw.personaIds.every(personaId => personas.some(persona => persona.id === personaId && persona.confirmed && isAidtDefinitionPersonaReady(persona, availableCardIds, confirmedSurprises))) && hmw.cardIds.every(cardId => availableCardIds.has(cardId));
}

function clearSelection(fields: Record<string, string>): void {
  if (!fields[selectedHmwKey]) return;
  delete fields[selectedHmwKey];
  delete fields.hmw;
  delete fields.personaBehavior;
}

function writeRecord<T extends { id: string }>(fields: Record<string, string>, prefix: string, record: T): boolean {
  const key = prefix + record.id;
  const value = JSON.stringify(record);
  if (value.length > 6000 || (!Object.hasOwn(fields, key) && Object.keys(fields).length >= 95)) return false;
  fields[key] = value;
  return true;
}

export function saveAidtDefinitionPersona(draft: AidtUiStageDraft, persona: AidtDefinitionPersona, revision: number | null): AidtUiStageDraft {
  if (!personaSchema.safeParse(persona).success) return draft;
  const fields = { ...draft.fields };
  if (!writeRecord(fields, personaPrefix, persona)) return draft;
  if (persona.cardIds.length && revision) fields[evidenceRevisionKey] = String(revision);
  for (const hmw of readAidtDefinition(draft.fields).hmws) {
    if (!hmw.personaIds.includes(persona.id)) continue;
    writeRecord(fields, hmwPrefix, { ...hmw, confirmed: false });
    if (fields[selectedHmwKey] === hmw.id) clearSelection(fields);
  }
  return { ...draft, fields };
}

export function saveAidtDefinitionHmw(draft: AidtUiStageDraft, hmw: AidtDefinitionHmw, revision: number | null): AidtUiStageDraft {
  if (!hmwSchema.safeParse(hmw).success) return draft;
  const fields = { ...draft.fields };
  if (!writeRecord(fields, hmwPrefix, hmw)) return draft;
  if (fields[selectedHmwKey] === hmw.id) clearSelection(fields);
  if (hmw.cardIds.length && revision) fields[evidenceRevisionKey] = String(revision);
  return { ...draft, fields };
}

export function chooseAidtDefinitionHmw(draft: AidtUiStageDraft, entityId: string, availableCardIds: ReadonlySet<string>): AidtUiStageDraft {
  const { personas, hmws, invalid } = readAidtDefinition(draft.fields);
  const hmw = hmws.find(item => item.id === entityId);
  const confirmed = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(item => item.id));
  if (invalid || !hmw || !readAidtDefinitionEvidenceRevision(draft.fields) || !hmw.confirmed || !isAidtDefinitionHmwReady(hmw, personas, availableCardIds, confirmed)) return draft;
  const selectedPersonas = personas.filter(persona => hmw.personaIds.includes(persona.id));
  return { ...draft, fields: { ...draft.fields, [selectedHmwKey]: hmw.id, hmw: hmw.text.trim(), personaBehavior: selectedPersonas.map(persona => `${persona.name.trim()} · ${persona.behavior.trim()}`).join("\n").slice(0, 6000) } };
}

/** A source switch starts a new review and leaves saved revisions accessible. */
export function rebaseAidtDefinitionEvidence(draft: AidtUiStageDraft): AidtUiStageDraft {
  const fields = { ...draft.fields };
  const { personas, hmws, surprises } = readAidtDefinition(fields);
  delete fields[evidenceRevisionKey];
  if (fields.surpriseStatus === "found" && fields.surpriseCardIds && fields.surpriseCardIds !== "[]") {
    fields.surpriseConfirmed = "";
    fields.surpriseSourceRevision = "";
  }
  clearSelection(fields);
  for (const surprise of surprises) {
    if (!surprise.archived) writeRecord(fields, surprisePrefix, { ...surprise, confirmed: false, cardIds: [] });
  }
  for (const persona of personas) {
    if (!persona.archived) writeRecord(fields, personaPrefix, { ...persona, confirmed: false, cardIds: [] });
  }
  for (const hmw of hmws) {
    if (!hmw.archived) writeRecord(fields, hmwPrefix, { ...hmw, confirmed: false, cardIds: [] });
  }
  return { ...draft, fields };
}

export function readAidtDefinitionEntities(fields: Fields) {
  const { personas, hmws } = readAidtDefinition(fields);
  return [
    ...personas.map(persona => ({ id: persona.id, title: persona.name.trim() || "未命名画像", archived: persona.archived, kind: "persona" as const })),
    ...hmws.map(hmw => ({ id: hmw.id, title: hmw.text.trim() || "未命名 HMW", archived: hmw.archived, kind: "hmw" as const })),
  ];
}

export function addAidtDefinitionEntity(draft: AidtUiStageDraft, kind: "persona" | "hmw", entityId: string): AidtUiStageDraft {
  const { personas, hmws, surprises, invalid } = readAidtDefinition(draft.fields);
  if (invalid || entityId === AIDT_PRIMARY_SURPRISE_ID || [...personas, ...hmws, ...surprises].some(entity => entity.id === entityId)) return draft;
  const common = { id: entityId, confirmed: false, archived: false, cardIds: [] };
  if (kind === "persona") return personas.length < AIDT_DEFINITION_ITEM_LIMIT ? saveAidtDefinitionPersona(draft, { ...common, name: "", situation: "", behavior: "", need: "", limits: "" }, null) : draft;
  return hmws.length < AIDT_DEFINITION_ITEM_LIMIT ? saveAidtDefinitionHmw(draft, { ...common, text: "", rationale: "", personaIds: [] }, null) : draft;
}

/** Stage-level summary for the existing group save and history surface. */
export function aidtDefinitionSummary(fields: Fields): string[] {
  const { personas, hmws, surprises, invalid } = readAidtDefinition(fields);
  const revision = readAidtDefinitionEvidenceRevision(fields);
  const selected = readAidtDefinitionSelection(fields);
  const lines: string[] = [];
  if (revision) lines.push(`共同证据来源：第 2 步 V${revision}`);
  for (const surprise of surprises) lines.push(`意外发现 · ${surprise.observation.trim() || "未填写"}（${surprise.archived ? "已归档" : surprise.confirmed ? "学生已确认" : "草稿"}）`);
  for (const persona of personas) lines.push(`画像 · ${persona.name.trim() || "未命名画像"}（${persona.archived ? "已归档" : persona.confirmed ? "学生已确认" : "草稿"}）`);
  for (const hmw of hmws) lines.push(`HMW · ${hmw.text.trim() || "未命名 HMW"}（${hmw.archived ? "已归档" : selected?.id === hmw.id ? "本轮选用" : hmw.confirmed ? "学生已确认" : "草稿"}）`);
  if (invalid) lines.push("部分综合产物格式无法读取，待核对。");
  return lines;
}

/** Editing an already linked finding makes the affected profile and HMW editable drafts again. */
export function invalidateAidtDefinitionSurpriseLinks(draft: AidtUiStageDraft, surpriseId: string): AidtUiStageDraft {
  const { personas, hmws } = readAidtDefinition(draft.fields);
  let result = draft;
  for (const persona of personas) {
    if (persona.surpriseIds?.includes(surpriseId)) result = saveAidtDefinitionPersona(result, { ...persona, confirmed: false }, null);
  }
  for (const hmw of hmws) {
    if (hmw.surpriseIds?.includes(surpriseId)) result = saveAidtDefinitionHmw(result, { ...hmw, confirmed: false }, null);
  }
  return result;
}

export function saveAidtDefinitionSurprise(draft: AidtUiStageDraft, record: AidtDefinitionSurprise, revision: number | null): AidtUiStageDraft {
  if (!surpriseSchema.safeParse(record).success) return draft;
  const fields = { ...draft.fields };
  const existed = Boolean(fields[surprisePrefix + record.id]);
  if (!writeRecord(fields, surprisePrefix, record)) return draft;
  if (record.cardIds.length && revision) fields[evidenceRevisionKey] = String(revision);
  const result = { ...draft, fields };
  return existed ? invalidateAidtDefinitionSurpriseLinks(result, record.id) : result;
}

export function addAidtDefinitionSurprise(draft: AidtUiStageDraft, recordId: string): AidtUiStageDraft {
  const { personas, hmws, surprises, invalid } = readAidtDefinition(draft.fields);
  if (invalid || recordId === AIDT_PRIMARY_SURPRISE_ID || draft.fields.surpriseStatus !== "found" || draft.fields.surpriseConfirmed !== "true"
    || surprises.length >= AIDT_DEFINITION_ITEM_LIMIT || [...personas, ...hmws, ...surprises].some(item => item.id === recordId)) return draft;
  return saveAidtDefinitionSurprise(draft, { id: recordId, priorBelief: "", observation: "", interpretation: "", unknowns: "", confirmed: false, archived: false, cardIds: [] }, null);
}
