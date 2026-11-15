import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

export type AidtSurpriseReflectionState = Readonly<{
  status: "" | "none" | "found";
  priorBelief: string;
  surprisingFinding: string;
  sourceDetails: string;
  interpretation: string;
  cardIds: readonly string[];
  invalidCardIds: boolean;
  missingCardIds: readonly string[];
  unresolvedCardIds: readonly string[];
  sourceRevision: number | null;
  currentCardsRevision: number | null;
  sourceRevisionMismatch: boolean;
  requiresCardRevision: boolean;
  hasSource: boolean;
  ready: boolean;
  confirmed: boolean;
}>;
export function hasAidtSurpriseCardMaterial(card: AidtDiscoveryCardDraft): boolean {
  return Boolean(card.headline.trim() || card.context.trim() || card.quote.trim() || card.sourceRef.trim() || card.photoRef.trim() || card.photoAttachment);
}
function parseCardIds(value: string | undefined): { ids: string[]; invalid: boolean } {
  if (!value?.trim()) return { ids: [], invalid: false };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || !id.trim())) return { ids: [], invalid: true };
    return { ids: [...new Set(parsed as string[])], invalid: false };
  } catch { return { ids: [], invalid: true }; }
}
/** Only a positive safe integer is a saved stage revision; never infer one from a card ID. */
export function readAidtSurpriseSourceRevision(draft: AidtUiStageDraft): number | null {
  const raw = draft.fields.surpriseSourceRevision ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const revision = Number(raw); return Number.isSafeInteger(revision) ? revision : null;
}
/** No tool calls. Student confirmation is distinct from saving or verifying evidence.
 * Omitted cards are unknown, not an empty authorized list: an ID alone cannot prove a usable source.
 */
export function parseAidtSurpriseReflection(draft: AidtUiStageDraft, cards?: readonly AidtDiscoveryCardDraft[], cardsRevision?: number): AidtSurpriseReflectionState {
  const fields = draft.fields, selected = parseCardIds(fields.surpriseCardIds);
  const status = fields.surpriseStatus === "found" || fields.surpriseStatus === "none" ? fields.surpriseStatus : "";
  const available = cards === undefined ? undefined : new Map(cards.filter((card, index) => card.id.trim() && cards.findIndex((other) => other.id === card.id) === index).map((card) => [card.id, card]));
  const missingCardIds = available ? selected.ids.filter((id) => !available.has(id)) : [];
  const unresolvedCardIds = available ? [] : selected.ids;
  const hasCard = selected.ids.some((id) => { const card = available?.get(id); return card ? hasAidtSurpriseCardMaterial(card) : false; });
  const priorBelief = fields.priorBelief ?? "", surprisingFinding = fields.surprisingFinding ?? "", sourceDetails = fields.surpriseSourceDetails ?? "", interpretation = fields.surpriseInterpretation ?? "";
  const hasSource = hasCard || Boolean(sourceDetails.trim());
  const sourceRevision = readAidtSurpriseSourceRevision(draft);
  const currentCardsRevision = Number.isSafeInteger(cardsRevision) && cardsRevision! > 0 ? cardsRevision! : null;
  const requiresCardRevision = status === "found" && selected.ids.length > 0;
  const sourceRevisionMismatch = requiresCardRevision && sourceRevision !== null && currentCardsRevision !== null && sourceRevision !== currentCardsRevision;
  const ready = status === "none" || (status === "found" && Boolean(priorBelief.trim()) && Boolean(surprisingFinding.trim()) && hasSource && !selected.invalid && !missingCardIds.length && (!requiresCardRevision || currentCardsRevision !== null));
  const confirmed = fields.surpriseConfirmed === "true" && ready && (!requiresCardRevision || sourceRevision === currentCardsRevision);
  return { status, priorBelief, surprisingFinding, sourceDetails, interpretation, cardIds: selected.ids, invalidCardIds: selected.invalid, missingCardIds, unresolvedCardIds, sourceRevision, currentCardsRevision, sourceRevisionMismatch, requiresCardRevision, hasSource, ready, confirmed };
}
export function isAidtSurpriseConfirmed(draft: AidtUiStageDraft, cards?: readonly AidtDiscoveryCardDraft[], cardsRevision?: number): boolean {
  return parseAidtSurpriseReflection(draft, cards, cardsRevision).confirmed;
}
/** A report projection of student input; inactive found fields never leak into a none response. */
export function formatAidtSurpriseMarkdown(draft: AidtUiStageDraft, cards?: readonly AidtDiscoveryCardDraft[], cardsRevision?: number): string[] {
  const reflection = parseAidtSurpriseReflection(draft, cards, cardsRevision);
  if (reflection.status === "none") return [`意外发现：暂无（${reflection.confirmed ? "学生已确认这份记录" : "待学生确认"}）。`];
  if (reflection.status !== "found") return ["意外发现：尚未记录，待学生选择有发现或暂无。"];
  const lines = [
    `意外发现反思：${reflection.confirmed ? "学生已确认这份记录；不代表证据已核验" : reflection.ready ? "待学生确认；来源仍需核对" : "记录待补充；不能视为已确认或已核验证据"}。`,
    `原先的判断：${reflection.priorBelief.trim() || "待补充"}`,
    `实际看到或听到的内容：${reflection.surprisingFinding.trim() || "待补充"}`,
  ];
  if (reflection.requiresCardRevision) lines.push(`人物发现卡来源版本：${reflection.sourceRevision ? `第2步共享 V${reflection.sourceRevision}（学生引用）` : "尚未绑定共享版本，待核对"}`);
  if (reflection.requiresCardRevision && !reflection.currentCardsRevision) lines.push("当前人物发现卡共享版本未回读，历史引用待核对，不能视为本次已确认。");
  if (reflection.sourceRevisionMismatch) lines.push(`引用历史第2步 V${reflection.sourceRevision}，当前已读取 V${reflection.currentCardsRevision}；保留原记录，需核对再确认。`);
  if (reflection.cardIds.length) lines.push(`人物发现卡引用：${reflection.cardIds.join("、")}（学生记录引用，不代表已保存或核验）`);
  if (reflection.invalidCardIds) lines.push("人物发现卡引用：格式无法读取，待学生核对。");
  if (reflection.missingCardIds.length) lines.push("部分人物发现卡已不在当前材料中，需重新核对引用。");
  if (reflection.unresolvedCardIds.length) lines.push("本次未取得人物发现卡上下文，卡片引用尚待核对。");
  lines.push(`原始材料与定位：${reflection.sourceDetails.trim() || "未另填原始材料定位，请核对所关联发现卡。"}`);
  if (reflection.interpretation.trim()) lines.push(`学生解释（不是原话）：${reflection.interpretation.trim()}`);
  return lines;
}
