import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import {
  AIDT_PERSONA_CANVAS_FIELD_LENGTH, AIDT_PERSONA_CANVAS_MAX_TEMPLATE_PARTS, aidtPersonaCanvasKey,
  aidtPersonaCanvasCodeKey, aidtPersonaTemplatePartKey, readStoredAidtPersonaCanvas,
} from "@repo/contracts/aidt-persona-canvas";
import type { CanvasTemplate } from "@/lib/live-canvas";
import {
  addAidtDefinitionEntity, confirmedAidtDefinitionSurprises, readAidtDefinition,
  readAidtDefinitionEvidenceRevision, saveAidtDefinitionPersona,
} from "./aidt-definition";
import { parseAidtDefinitionProposal, type AidtDefinitionProposal, type AidtDefinitionTurn } from "./aidt-definition-chat";
import { isAidtSurpriseConfirmed } from "./aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

type PersonaProposal = Extract<AidtDefinitionProposal, { kind: "persona" }>;
export type AidtPersonaSource = {
  orgId: string; projectId: string; revision: number; definitionRevision?: number; cardIds: readonly string[]; syntheticCardIds?: readonly string[];
};
export type AidtPersonaCanvasCandidate = {
  id: string; threadId: string; messageId: string; source: AidtPersonaSource;
  template: CanvasTemplate; code: string; proposal: PersonaProposal;
};
export type AidtPersonaGenerationRequest = {
  kind: "persona" | "hmw"; source: AidtPersonaSource; template?: CanvasTemplate; prompt: string;
  cards?: readonly AidtDiscoveryCardDraft[]; personaIds?: readonly string[];
};
/** The host uses its ordinary, authorized S3 Chat; this port never lands an Artifact. */
export type AidtPersonaCandidateHost = {
  generate: (request: AidtPersonaGenerationRequest) => Promise<{ threadId: string; messages: readonly AidtDefinitionTurn[]; syntheticCardIds?: readonly string[] }>;
};
const partLength = AIDT_PERSONA_CANVAS_FIELD_LENGTH;
const maxParts = AIDT_PERSONA_CANVAS_MAX_TEMPLATE_PARTS;

/** Published organization templates take precedence over their platform originals. Never substitute a local default. */
export function selectAidtPersonaTemplate(rows: readonly CanvasTemplate[]): CanvasTemplate | null {
  const published = rows.filter(row => row.key === "persona" && row.status === "published" && row.sections.length > 0);
  const owned = published.filter(row => !row.platform);
  const choices = owned.length ? owned : published;
  return choices.reduce<CanvasTemplate | null>((latest, row) => !latest || row.version > latest.version ? row : latest, null);
}

export function aidtPersonaGenerationPrompt(template: CanvasTemplate, cards: readonly AidtDiscoveryCardDraft[], requested: number): string {
  const count = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
  return [
    AIDT_CANDIDATE_ACTIONS.persona,
    `请调用后台已发布的用户画像画布模板（模板key: ${template.key}，版本: ${template.version}），基于以下已授权访谈发现和本组讨论，综合最多${count}个有意义的候选画像。`,
    "证据只支持一个就只生成一个，不凑数，不把不同受访者互相矛盾的经历强行合成共性。学生会先预览，再自行选择一个加入正式产物；现在不要落地、发布或确认任何产物。",
    "未知年龄、动机和生活方式须写未知/待验证；保留例外。每个候选连续输出以下两个完整围栏，不要用文本卡、mindmap或其它模板代替画布：",
    '1. ```aidt-definition JSON围栏，kind为persona，字段沿用name、situation、behavior、need、limits、cardIds、surpriseIds；limits写仍待核实之处。',
    '2. ```canvas 围栏，首行“模板: persona”，依据真实模板的表头和分区逐项填写。',
    "真实模板字段与分区（不得自行新增或改名）：",
    ...[...template.sections].sort((a, b) => a.order - b.order).map(section => `${section.type === "短文本" ? "表头" : "分区"}：${section.name}`),
    "本轮已保存人物发现（学生解释不等于受访者原话）：",
    ...cards.map(card => JSON.stringify({ id: card.id, participantCode: card.participantCode, headline: card.headline,
      headlineKind: card.headlineKind, context: card.context, quote: card.quote, sourceRef: card.sourceRef })),
  ].join("\n");
}

/** Only completed native persona + actual canvas pairs become previews. No student text is promoted to an AI output. */
export async function collectAidtPersonaCandidates(input: {
  source: AidtPersonaSource; template: CanvasTemplate; threadId: string; messages: readonly AidtDefinitionTurn[];
}): Promise<AidtPersonaCanvasCandidate[]> {
  if (!input.threadId || input.template.key !== "persona" || input.template.status !== "published") return [];
  const candidates: AidtPersonaCanvasCandidate[] = [];
  const seen = new Set<string>();
  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.id || typeof message.content !== "string") continue;
    let proposal: PersonaProposal | null = null;
    let ordinal = 0;
    const blocks = message.content.matchAll(/(?:^|\n)```(aidt-definition|canvas|persona)[ \t]*\n([\s\S]*?)\n```(?=\n|$)/gu);
    for (const block of blocks) {
      if (block[1] === "aidt-definition") {
        proposal = null;
        try {
          const value = parseAidtDefinitionProposal(JSON.parse(block[2]!));
          if (value?.kind === "persona") proposal = value;
        } catch { /* Malformed prose remains in Chat and never enters the formal directory. */ }
        continue;
      }
      if (!proposal) continue;
      const code = block[2]!.trim();
      const templateLine = /^模板[:：]\s*(\S+)\s*$/mu.exec(code);
      if ((templateLine && templateLine[1] !== "persona") || (block[1] === "canvas" && !templateLine)) { proposal = null; continue; }
      const normalized = block[1] === "persona" && !templateLine ? `模板: persona\n${code}` : code;
      if (normalized.length > partLength) { proposal = null; continue; }
      // An unrelated template, missing sections, or invented headings is never advertised as a valid persona canvas.
      const headings = [...normalized.matchAll(/^##\s+(.+?)\s*$/gmu)].map(match => match[1]!);
      const bodyNames = input.template.sections.filter(section => section.type !== "短文本" && section.type !== "文本对象").map(section => section.name);
      if (!headings.length || headings.some(name => !bodyNames.includes(name)) || bodyNames.some(name => !headings.includes(name))) { proposal = null; continue; }
      const signature = JSON.stringify([normalized, proposal]);
      if (seen.has(signature)) { proposal = null; continue; }
      seen.add(signature);
      const identity = JSON.stringify([input.source.orgId, input.source.projectId, input.source.revision, input.source.definitionRevision, [...input.source.cardIds].sort(),
        input.threadId, message.id, ordinal++, input.template.key, input.template.version, normalized]);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const id = "ai-persona-" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      candidates.push({ id, threadId: input.threadId, messageId: message.id, source: input.source, template: input.template, code: normalized, proposal });
      proposal = null;
    }
  }
  return candidates;
}

export function addAidtPersonaCandidate(draft: AidtUiStageDraft, candidate: AidtPersonaCanvasCandidate, cards: readonly AidtDiscoveryCardDraft[], revision?: number): AidtUiStageDraft {
  if (parseAidtDefinitionProposal(candidate.proposal)?.kind !== "persona") return draft;
  if (candidate.source.revision !== revision || !revision || !isAidtSurpriseConfirmed(draft, cards, revision)) return draft;
  const pinned = readAidtDefinitionEvidenceRevision(draft.fields);
  if (pinned !== null && pinned !== revision) return draft;
  if (draft.fields[aidtPersonaCanvasKey(candidate.id)]) return draft;
  const sourceIds = [...new Set(candidate.source.cardIds)];
  const available = new Set(cards.map(card => card.id));
  if (!sourceIds.length || sourceIds.some(id => !available.has(id))) return draft;
  const template = JSON.stringify(candidate.template);
  const parts = Array.from({ length: Math.ceil(template.length / partLength) }, (_, index) => template.slice(index * partLength, (index + 1) * partLength));
  if (!parts.length || parts.length > maxParts || !candidate.code || candidate.code.length > partLength) return draft;
  let next = addAidtDefinitionEntity(draft, "persona", candidate.id, {
    name: candidate.proposal.name.slice(0, 80), source: { revision, cardIds: sourceIds, available },
  });
  if (next === draft) return draft;
  const entity = readAidtDefinition(next.fields).personas.find(persona => persona.id === candidate.id);
  if (!entity) return draft;
  const knownSurprises = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(item => item.id));
  next = saveAidtDefinitionPersona(next, { ...entity, name: candidate.proposal.name, situation: candidate.proposal.situation,
    behavior: candidate.proposal.behavior, need: candidate.proposal.need, limits: candidate.proposal.limits ?? "未知信息仍待核实。",
    surpriseIds: (candidate.proposal.surpriseIds ?? []).filter(id => knownSurprises.has(id)), confirmed: false,
  }, revision);
  const fields = { ...next.fields, [aidtPersonaCanvasKey(candidate.id)]: JSON.stringify({
    orgId: candidate.source.orgId, projectId: candidate.source.projectId, sourceRevision: revision, definitionRevision: candidate.source.definitionRevision, cardIds: sourceIds, syntheticCardIds: candidate.source.syntheticCardIds,
    threadId: candidate.threadId, messageId: candidate.messageId, templateKey: candidate.template.key,
    templateVersion: candidate.template.version, templateParts: parts.length,
  }), [aidtPersonaCanvasCodeKey(candidate.id)]: candidate.code };
  parts.forEach((part, index) => { fields[aidtPersonaTemplatePartKey(candidate.id, index)] = part; });
  // Keep the existing shared-stage envelope and its reserved field budget; never truncate a template to fit.
  return Object.keys(fields).length <= 95 && Object.values(fields).every(value => value.length <= partLength) ? { ...next, fields } : draft;
}

export function readAidtPersonaCanvas(draft: AidtUiStageDraft, entityId: string) {
  return readStoredAidtPersonaCanvas(draft.fields, entityId);
}
