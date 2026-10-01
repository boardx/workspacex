/**
 * issue #4362 开场简报的纯投影：服务端给的条目按三段排好、每条的「出处」与「引用」文案。
 * 段名只取契约 `KG_BRIEFING_SECTION_LABEL_ZH`，类型名只取 `KG_CLAIM_KIND_LABEL_ZH`，这里不另写一份。
 */
import { KG_BRIEFING_SECTION_LABEL_ZH, type KgBriefingSection } from "@repo/contracts/chat-knowledge-graph";
import type { BriefingItem } from "@/lib/knowledge-graph-api";
import { personalOriginLabel } from "@/lib/knowledge-graph-recall";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";

const SECTION_ORDER: readonly KgBriefingSection[] = ["recent", "open_todos", "unresolved"];

export function briefingSections(items: readonly BriefingItem[]): { section: KgBriefingSection; label: string; items: BriefingItem[] }[] {
  return SECTION_ORDER
    .map((section) => ({ section, label: KG_BRIEFING_SECTION_LABEL_ZH[section], items: items.filter((i) => i.section === section) }))
    .filter((s) => s.items.length > 0);
}

/** 条目的类型标签：矛盾 / 可能改口卡另有说法，其余按结论类型。 */
export function briefingKindLabel(item: Pick<BriefingItem, "kind" | "cardKind">): string {
  if (item.cardKind === "conflict") return "有矛盾";
  if (item.cardKind === "possible_change") return "可能改口";
  return KG_CLAIM_KIND_LABEL_ZH[item.kind];
}

/** 「来自你 M/D 的对话」；没有时间 ⇒ 「来自你的对话」。 */
export function briefingOriginLabel(item: Pick<BriefingItem, "saidAt">): string {
  if (item.saidAt === null) return "来自你的对话";
  return personalOriginLabel({ scope: "personal", saidAt: item.saidAt }) ?? "来自你的对话";
}

/** 续上之后在简报里留的一行：预填的首问依据的是哪一条记忆（引用）。 */
export function briefingCitationText(item: Pick<BriefingItem, "kind" | "cardKind" | "statement">): string {
  return `${briefingKindLabel(item)}：${item.statement}`;
}
