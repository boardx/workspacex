import { z } from "zod";
import { researchMaterialKey } from "./aidt-research-material-reference";

export const discoveryAiKey = (cardId: string) => `discoveryAi:${cardId}`;
export const discoverySourceKey = (cardId: string) => `discoverySource:${cardId}`;
const sourceId = z.string().min(1).max(256);
export const AidtDiscoverySourceSchema = z.object({ projectId: sourceId, threadId: sourceId, messageId: sourceId, authorId: sourceId, createdAt: z.string().datetime(), text: z.string().max(4000), truncated: z.boolean() }).strict();
export type AidtDiscoverySource = z.infer<typeof AidtDiscoverySourceSchema>;
export function readAidtDiscoverySource(fields: Readonly<Record<string, string>>, cardId: string): AidtDiscoverySource | null {
  try { const result = AidtDiscoverySourceSchema.safeParse(JSON.parse(fields[discoverySourceKey(cardId)] ?? "null")); return result.success ? result.data : null; } catch { return null; }
}
export function aidtDiscoverySourceLabel(source: AidtDiscoverySource): string {
  return `小组 ${source.projectId} · 对话 ${source.threadId} · 消息 ${source.messageId} · 提交者 ${source.authorId} · ${source.createdAt}`;
}
export function boundAidtDiscoverySource(source: AidtDiscoverySource): AidtDiscoverySource {
  // SharedStage limits serialized field characters, including escaped quotes/newlines.
  let result = source;
  while (JSON.stringify(result).length > 6000) result = { ...result, text: result.text.slice(0, Math.floor(result.text.length * 0.8)), truncated: true };
  return result;
}
export function removeAidtDiscoveryAssociations(fields: Readonly<Record<string, string>>, removed: readonly string[]): Record<string, string> {
  const next = { ...fields };
  for (const id of removed) { delete next[discoveryAiKey(id)]; delete next[discoverySourceKey(id)]; delete next[researchMaterialKey("source", id)]; delete next[researchMaterialKey("photo", id)]; }
  return next;
}
