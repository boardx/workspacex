import type { z } from "zod";
import type { RetrievalChannel as RetrievalChannelSchema } from "@repo/contracts/context-pack";
import type { KgRelation } from "@repo/contracts/chat-knowledge-graph";

/** Dependency-free label fact shared by recall and UI dictionaries. */
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
  serves_goal: "为了",
};

/** Legacy channel labels remain one dependency-free fact for UI and recall consumers. */
export const RETRIEVAL_CHANNEL_LABEL_ZH: Record<z.infer<typeof RetrievalChannelSchema>, string> = {
  fts: "全文",
  vector: "相似",
  graph: "关联",
  metadata: "元数据",
  claim: "记下的",
};
