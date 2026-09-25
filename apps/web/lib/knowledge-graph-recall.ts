/**
 * phase-18 F13 —— 回答下「这次用到了哪些记忆、为什么」的展示用词与纯投影（uc-18-2 R8 / E1、uc-18-4 R3-6）。
 *
 * 数据只来自 `getTurnMemory` 的 `recalled` / `recallDegraded`（契约 `KgRecalledMemory` / `KgTurnMemory`），
 * 服务端已按查看者过滤；这里只把它翻成人话，不补任何东西。
 *
 * 单一事实源：
 *   - 召回通道用词 `RETRIEVAL_CHANNEL_LABEL_ZH`、「查不全」固定说法 `KG_RELATED_QUERY_DEGRADED_ZH`
 *     原本定义在 `lib/mock/knowledge-graph.ts`，产品路由不能够到 mock，于是搬到这里；mock 只 re-export。
 *   - 关系短标签 `KG_RELATION_LABEL_ZH` 只在这里定义一份。
 *   - 召回理由用 `lib/filter-action.ts`（契约 `filter-action` 单源）的展示名，这里不另建映射。
 *   - 三态用契约的 `KG_TRI_STATE_LABEL_ZH`。
 */
import type { z } from "zod";
import type { KgRecalledMemory, KgRelation } from "@repo/contracts/chat-knowledge-graph";
import type { RetrievalChannel as RetrievalChannelSchema } from "@repo/contracts/context-pack";
import { filterActionLabel, type FilterActionKey } from "@/lib/filter-action";

type RetrievalChannel = z.infer<typeof RetrievalChannelSchema>;

/** 召回通道的界面用词（说人话：不出现「向量 / 图检索」这类内部词）。 */
export const RETRIEVAL_CHANNEL_LABEL_ZH: Record<RetrievalChannel, string> = {
  fts: "全文",
  vector: "相似",
  graph: "关联",
  metadata: "元数据",
  claim: "记下的",
};

/**
 * 「查不全」的固定文案（用词表：关联查询不可用 → 这句人话）。前端不另写第二份。
 * 只由契约 `recallDegraded` 触发——**不看向量是否可用**：MVP 没部署向量，那不是降级。
 */
export const KG_RELATED_QUERY_DEGRADED_ZH =
  "这次没能查全你的记忆（关联查询暂不可用），回答可能不完整";

/** 关系的中文短标签：「为什么用到它」里的关系路径用（张三 —拍板人→ 决定 v2…）。 */
export const KG_RELATION_LABEL_ZH: Record<KgRelation, string> = {
  about: "关于",
  decided_by: "拍板人",
  mentions: "提到",
  derived_from: "来自",
  supersedes: "取代",
  belongs_to: "属于",
  supported_by: "依据",
  may_shorten: "可能缩短",
  blocks: "阻碍",
  hard_constraint: "硬约束",
  candidate_for: "候选",
};

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
export function personalOriginLabel(memory: Pick<KgRecalledMemory, "scope" | "saidAt">): string | null {
  if (memory.scope !== "personal") return null;
  if (memory.saidAt === null) return "来自你的长期记忆";
  const d = new Date(memory.saidAt);
  if (Number.isNaN(d.getTime())) return "来自你的长期记忆";
  return `来自你 ${String(d.getMonth() + 1)}/${String(d.getDate())} 的对话`;
}

/** 召回理由（FilterAction）→ 展示名，取自 filter-action 单源。 */
export function retrievalReasonLabels(reasons: readonly FilterActionKey[]): string[] {
  return reasons.map((r) => filterActionLabel(r));
}

/**
 * 关系路径 → 一行人话：「张三 —拍板人→ 决定 v2 下周一上线」。
 * 首尾相接的边连成一条链；接不上的那段另起一截（用「；」隔开），不自作主张补边。
 * 没有路径（`null` 或空）返回 null。
 */
export function graphPathText(path: KgRecalledMemory["graphPath"]): string | null {
  if (path === null || path.length === 0) return null;
  let text = "";
  let tail: string | null = null;
  for (const e of path) {
    if (tail !== e.from) text += `${tail === null ? "" : "；"}${e.from}`;
    text += ` —${KG_RELATION_LABEL_ZH[e.relation]}→ ${e.to}`;
    tail = e.to;
  }
  return text;
}
