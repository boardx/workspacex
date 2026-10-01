/**
 * issue #4360（S5）——「关于我」画像层的两处纯逻辑：
 *
 *   1. 召回时每一轮带上的**画像摘要**（`withProfileSummary`）：本人个人空间里属于「关于我」四组的条目
 *      （分组规则只有契约 `kgProfileSection` 一份），按 目标 → 偏好 → 约束与身份 → 在做的事、组内最新优先，
 *      取到条数上限或字数上限为止。北极星：新会话里用户不必再交代一遍已知背景。
 *      - **只进本人自己的个人对话**：调用方（recall-knowledge.ts）只在这一轮是本人个人对话时才调用；这里另外只认
 *        `scope === "personal"` 且没有 `originThreadId` 的候选——候选集（PgKnowledgeRecall.candidates）里这种条目
 *        只可能是发起人本人的个人空间（F12，scope_id = 发起人、RLS 只放本人）。别人的画像进不了候选集。
 *      - **有界**：`PROFILE_SUMMARY_LIMIT` 条、合计 `PROFILE_SUMMARY_MAX_CHARS` 字（约等于 token 上限：中文一字约一个
 *        token 量级）；已经被打分或强制召回带上的不重复算。
 *      - 与决定类 / 目标偏好的强制召回（recall.ts）同一个通道 `claim`：它们都记进 `kg_turn_recalls`，回答下方照常出引用。
 *   2. 模型提议「决定 / 待办挂到哪个目标下」时，多高把握才自动挂（`GOAL_LINK_MIN_CONFIDENCE`）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { KnowledgeRecall, RecallChannel, RecallClaim, RecallItem } from "./recall";

type FilterAction = RecallItem["retrievalReasons"][number];

/** 画像摘要每轮最多几条（在打分召回与决定 / 目标强制召回之外另计）。 */
export const PROFILE_SUMMARY_LIMIT = 4;
/** 画像摘要合计最多多少字（原文长度之和）：超出的那条不带，后面更短的也不再补（保持组的先后）。 */
export const PROFILE_SUMMARY_MAX_CHARS = 240;

/**
 * 模型提议「挂到哪个目标」的把握下限：低于它一律不自动挂（宁可漏挂，不要误挂——挂错了「在做的事」会跑到别的目标下，
 * 用户要自己去改），高于它才由系统挂上，本人随时可以在「关于我」里改挂 / 摘掉。
 */
export const GOAL_LINK_MIN_CONFIDENCE = 0.8;

const SECTION_RANK: Record<KG.KgProfileSection, number> = { goals: 0, preferences: 1, identity: 2, doing: 3 };

/** 候选里属于本人画像的条目，按组、组内最新优先排好。 */
export function profileClaims(claims: readonly RecallClaim[]): RecallClaim[] {
  return claims
    .flatMap((c) => {
      if (c.scope !== "personal" || c.originThreadId !== undefined) return [];
      const section = KG.kgProfileSection(c.kind, c.statement);
      return section === null ? [] : [{ c, rank: SECTION_RANK[section] }];
    })
    .sort((a, b) => a.rank - b.rank || (b.c.saidAt ?? "").localeCompare(a.c.saidAt ?? "") || a.c.id.localeCompare(b.c.id))
    .map((x) => x.c);
}

/** 在已有召回之外追加画像摘要（有界），并如实更新 `claim` 通道的命中数。 */
export function withProfileSummary(recall: KnowledgeRecall, claims: readonly RecallClaim[]): KnowledgeRecall {
  const present = new Set(recall.items.map((i) => i.claim.id));
  const picked: RecallClaim[] = [];
  let chars = 0;
  for (const c of profileClaims(claims)) {
    if (picked.length >= PROFILE_SUMMARY_LIMIT) break;
    if (present.has(c.id)) continue;
    const len = c.statement.length;
    if (chars + len > PROFILE_SUMMARY_MAX_CHARS) break;
    chars += len;
    picked.push(c);
  }
  if (picked.length === 0) return recall;
  const extra: RecallItem[] = picked.map((claim) => ({
    claim,
    channels: ["claim"] as RecallChannel[],
    retrievalReasons: ["recall"] as FilterAction[],
    score: 0,
    graphPath: null,
  }));
  return {
    ...recall,
    items: [...recall.items, ...extra],
    plan: recall.plan.map((p) => (p.channel === "claim" ? { ...p, hitCount: p.hitCount + extra.length } : p)),
  };
}
