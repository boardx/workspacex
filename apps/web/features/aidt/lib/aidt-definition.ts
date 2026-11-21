import { z } from "zod";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

export const AIDT_DEFINITION_ITEM_LIMIT = 12;
export const AIDT_DEFINITION_EVIDENCE_LIMIT = 16;
const evidenceRevisionKey = "definitionEvidenceRevision";
const selectedHmwKey = "definitionHmwId";
const personaPrefix = "definitionPersona:";
const hmwPrefix = "definitionHmw:";
const id = z.string().min(1).max(256);
const shortText = z.string().max(220);
const note = z.string().max(400);
const evidenceIds = z.array(id).max(AIDT_DEFINITION_EVIDENCE_LIMIT);
const personaIds = z.array(id).max(AIDT_DEFINITION_ITEM_LIMIT);
const base = z.object({ id, confirmed: z.boolean(), archived: z.boolean(), cardIds: evidenceIds });
const personaSchema = base.extend({ name: shortText, situation: note, behavior: note, need: note, limits: note }).strict();
const hmwSchema = base.extend({ text: shortText, personaIds, rationale: note }).strict();
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
  const ids = [...personas.records, ...hmws.records].map(record => record.id);
  return { personas: personas.records, hmws: hmws.records, invalid: personas.invalid || hmws.invalid || new Set(ids).size !== ids.length };
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
  if (!selected.personaIds.length || !selected.personaIds.every(id => result.personas.some(persona => persona.id === id && persona.confirmed && !persona.archived))) return null;
  return { id: selectedId, text: fields.hmw };
}

export function isAidtDefinitionPersonaReady(persona: AidtDefinitionPersona, availableCardIds: ReadonlySet<string>): boolean {
  return !persona.archived && Boolean(persona.name.trim() && persona.situation.trim() && persona.behavior.trim() && persona.need.trim()) && persona.cardIds.length > 0 && persona.cardIds.every(cardId => availableCardIds.has(cardId));
}

export function isAidtDefinitionHmwReady(hmw: AidtDefinitionHmw, personas: readonly AidtDefinitionPersona[], availableCardIds: ReadonlySet<string>): boolean {
  return !hmw.archived && Boolean(hmw.text.trim()) && hmw.personaIds.length > 0 && hmw.personaIds.every(personaId => personas.some(persona => persona.id === personaId && persona.confirmed && isAidtDefinitionPersonaReady(persona, availableCardIds))) && hmw.cardIds.every(cardId => availableCardIds.has(cardId));
}

function clearSelection(fields: Record<string, string>): void {
  if (!fields[selectedHmwKey]) return;
  delete fields[selectedHmwKey];
  delete fields.hmw;
  delete fields.personaBehavior;
}

function writeRecord(fields: Record<string, string>, prefix: string, record: { id: string }): boolean {
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
  if (invalid || !hmw || !readAidtDefinitionEvidenceRevision(draft.fields) || !hmw.confirmed || !isAidtDefinitionHmwReady(hmw, personas, availableCardIds)) return draft;
  const selectedPersonas = personas.filter(persona => hmw.personaIds.includes(persona.id));
  return { ...draft, fields: { ...draft.fields, [selectedHmwKey]: hmw.id, hmw: hmw.text.trim(), personaBehavior: selectedPersonas.map(persona => `${persona.name.trim()} · ${persona.behavior.trim()}`).join("\n").slice(0, 6000) } };
}

/** A source switch starts a new review and leaves saved revisions accessible. */
export function rebaseAidtDefinitionEvidence(draft: AidtUiStageDraft): AidtUiStageDraft {
  const fields = { ...draft.fields };
  const { personas, hmws } = readAidtDefinition(fields);
  delete fields[evidenceRevisionKey];
  if (fields.surpriseStatus === "found" && fields.surpriseCardIds && fields.surpriseCardIds !== "[]") {
    fields.surpriseConfirmed = "";
    fields.surpriseSourceRevision = "";
  }
  clearSelection(fields);
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
  const { personas, hmws, invalid } = readAidtDefinition(draft.fields);
  if (invalid || [...personas, ...hmws].some(entity => entity.id === entityId)) return draft;
  const common = { id: entityId, confirmed: false, archived: false, cardIds: [] };
  if (kind === "persona") return personas.length < AIDT_DEFINITION_ITEM_LIMIT ? saveAidtDefinitionPersona(draft, { ...common, name: "", situation: "", behavior: "", need: "", limits: "" }, null) : draft;
  return hmws.length < AIDT_DEFINITION_ITEM_LIMIT ? saveAidtDefinitionHmw(draft, { ...common, text: "", rationale: "", personaIds: [] }, null) : draft;
}

/** Stage-level summary for the existing group save and history surface. */
export function aidtDefinitionSummary(fields: Fields): string[] {
  const { personas, hmws, invalid } = readAidtDefinition(fields);
  const revision = readAidtDefinitionEvidenceRevision(fields);
  const selected = readAidtDefinitionSelection(fields);
  const lines: string[] = [];
  if (revision) lines.push(`共同证据来源：第 2 步 V${revision}`);
  for (const persona of personas) lines.push(`画像 · ${persona.name.trim() || "未命名画像"}（${persona.archived ? "已归档" : persona.confirmed ? "学生已确认" : "草稿"}）`);
  for (const hmw of hmws) lines.push(`HMW · ${hmw.text.trim() || "未命名 HMW"}（${hmw.archived ? "已归档" : selected?.id === hmw.id ? "本轮选用" : hmw.confirmed ? "学生已确认" : "草稿"}）`);
  if (invalid) lines.push("部分综合产物格式无法读取，待核对。");
  return lines;
}
