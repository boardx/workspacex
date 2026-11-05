import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";
import { KG_RELATION_LABEL_ZH, RETRIEVAL_CHANNEL_LABEL_ZH } from "./knowledge-graph-labels";
import { graphRelationLabel } from "./knowledge-graph-copy";
/**
 * phase-18 F13 —— 回答下「这次用到了哪些记忆、为什么」的展示用词与纯投影（uc-18-2 R8 / E1、uc-18-4 R3-6）。
 *
 * 数据只来自 `getTurnMemory` 的 `recalled` / `recallDegraded`（契约 `KgRecalledMemory` / `KgTurnMemory`），
 * 服务端已按查看者过滤；这里只把它翻成人话，不补任何东西。
 *
 * 单一事实源：
 *   - 召回通道用词 `RETRIEVAL_CHANNEL_LABEL_ZH`、「查不全」固定说法 `KG_RELATED_QUERY_DEGRADED_ZH`
 *     原本定义在 `lib/mock/knowledge-graph.ts`，产品路由不能够到 mock，于是搬到这里；mock 只 re-export。
 *   - 关系短标签 `KG_RELATION_LABEL_ZH` 只在 dependency-free `knowledge-graph-labels.ts` 定义；这里兼容 re-export。
 *   - 召回理由用 `lib/filter-action.ts`（契约 `filter-action` 单源）的展示名，这里不另建映射。
 *   - 三态用契约的 `KG_TRI_STATE_LABEL_ZH`。
 */
import type { z } from "zod";
import { sharedFromPersonalLabelZh, type KgRecalledMemory, type KgRelation } from "@repo/contracts/chat-knowledge-graph";
import type { RetrievalChannel as RetrievalChannelSchema } from "@repo/contracts/context-pack";
import { filterActionLabel, type FilterActionKey } from "@/lib/filter-action";

type RetrievalChannel = z.infer<typeof RetrievalChannelSchema>;

/** 召回通道的界面用词（说人话：不出现「向量 / 图检索」这类内部词）。 */
export { RETRIEVAL_CHANNEL_LABEL_ZH } from "./knowledge-graph-labels";

/**
 * 「查不全」的固定文案（用词表：关联查询不可用 → 这句人话）。前端不另写第二份。
 * 只由契约 `recallDegraded` 触发——**不看向量是否可用**：MVP 没部署向量，那不是降级。
 */
export const KG_RELATED_QUERY_DEGRADED_ZH = translate("zh-CN", "chatKnowledge.recall.degraded", {
  detail: translate("zh-CN", "chatKnowledge.recall.degradedDetail", { channels: RETRIEVAL_CHANNEL_LABEL_ZH.graph }),
});

/** 关系的中文短标签：「为什么用到它」里的关系路径用（张三 —拍板人→ 决定 v2…）。 */
export { KG_RELATION_LABEL_ZH } from "./knowledge-graph-labels";

/** 引用 chip 上的文字上限（超出截断加省略号；完整内容在「为什么用到它」与来源抽屉里）。 */
export const CITATION_CHIP_MAX_CHARS = 18;

export function truncateStatement(text: string, max: number = CITATION_CHIP_MAX_CHARS): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max).join("")}…`;
}

/**
 * 个人空间条目的出处标签（uc-18-4 R3-6）：「来自你 {M/D} 的对话」，日期按本地时区。
 * 不是个人空间的条目返回 null；个人空间但没有时间（或时间读不出来）时说「来自你的长期记忆」。
 */
export function personalOriginLabel(memory: Pick<KgRecalledMemory, "scope" | "saidAt">, locale: Locale = "zh-CN"): string | null {
  if (memory.scope !== "personal") return null;
  if (memory.saidAt === null) return translate(locale, "aboutMemory.origin.personal");
  const d = new Date(memory.saidAt);
  if (Number.isNaN(d.getTime())) return translate(locale, "aboutMemory.origin.personal");
  return translate(locale, "aboutMemory.origin.dated", { date: `${String(d.getMonth() + 1)}/${String(d.getDate())}` });
}

/**
 * S10（#4367）：项目记忆条目的出处标签。由成员从个人记忆分享来的 ⇒「由 X 分享自个人记忆」（契约单源文案）；
 * 其余项目记忆 ⇒「来自项目记忆」；不是项目记忆 ⇒ null。
 */
export function projectOriginLabel(memory: Pick<KgRecalledMemory, "scope" | "sharedByName">, locale: Locale = "zh-CN"): string | null {
  if (memory.scope !== "project") return null;
  if (memory.sharedByName === undefined || memory.sharedByName === null) return translate(locale, "chatKnowledge.recall.project");
  if (locale === "zh-CN") return sharedFromPersonalLabelZh(memory.sharedByName);
  return memory.sharedByName.trim() === ""
    ? translate(locale, "chatKnowledge.recall.sharedAnonymous")
    : translate(locale, "chatKnowledge.recall.shared", { name: memory.sharedByName });
}

/** 召回理由（FilterAction）→ 展示名，取自 filter-action 单源。 */
export function retrievalReasonLabels(reasons: readonly FilterActionKey[], locale: Locale = "zh-CN"): string[] {
  return reasons.map(r => locale === "zh-CN" ? filterActionLabel(r) : translate(locale, `chatKnowledge.recall.reason.${r}`));
}

export function retrievalChannelLabel(channel: RetrievalChannel, locale: Locale = "zh-CN"): string {
  return locale === "zh-CN" ? RETRIEVAL_CHANNEL_LABEL_ZH[channel] : translate(locale, `chatKnowledge.recall.channel.${channel}`);
}

/**
 * 关系路径 → 一行人话：「张三 —拍板人→ 决定 v2 下周一上线」。
 * 首尾相接的边连成一条链；接不上的那段另起一截（用「；」隔开），不自作主张补边。
 * 没有路径（`null` 或空）返回 null。
 */
export function graphPathText(path: KgRecalledMemory["graphPath"], locale: Locale = "zh-CN"): string | null {
  if (path === null || path.length === 0) return null;
  let text = "";
  let tail: string | null = null;
  for (const e of path) {
    if (tail !== e.from) text += `${tail === null ? "" : "；"}${e.from}`;
    text += ` —${locale === "zh-CN" ? KG_RELATION_LABEL_ZH[e.relation] : graphRelationLabel(e.relation, locale)}→ ${e.to}`;
    tail = e.to;
  }
  return text;
}

/** Older records cannot identify the failed channel, so their notice stays generic. */
export function recallDegradedNotice(channels?: readonly ("graph" | "vector")[], locale: Locale = "zh-CN"): string {
  const names = [...new Set(channels ?? [])].map(c => retrievalChannelLabel(c, locale));
  const detail = names.length ? translate(locale, "chatKnowledge.recall.degradedDetail", { channels: names.join(locale === "zh-CN" ? "、" : ", ") }) : "";
  return translate(locale, "chatKnowledge.recall.degraded", { detail });
}
