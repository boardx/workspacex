/**
 * chat-knowledge-graph（Phase 18）UI 先行原型 mock 数据 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**（硬规则 ③）。真实的抽取、召回、权限传播、级联失效都在服务端。
 *
 * 单一事实源纪律：本文件**不重定义任何契约类型**（lint-contract-source §2）。
 * 形状类型全部从契约 zod schema `z.infer` 出来，值全部标注为契约类型——契约错了这里当场崩。
 *   - 领域形状 / 操作输出：`@repo/contracts/chat-knowledge-graph`
 *   - 三态文案 / 映射：`KG_TRI_STATE_LABEL_ZH` / `claimTriState`（不另建映射表）
 *   - 可见范围文案：`KG_VISIBILITY_LABEL_ZH`（不另建映射表）
 *   - 召回通道 / 引用锚点 / 丢弃：`@repo/contracts/context-pack` + `omission-reason` + `filter-action`
 *
 * 用词：界面上说的是「记忆」，说人话（requirements/06-user-experience.md 第五节用词表）。
 * 数据密度照真实会话（约 10 条 / 8 个人和事 / 多条关系），不是三行占位 —— 信息密度问题
 * 正是 sign-off 要看的（硬规则 ③）。场景：一次关于「v2 上线」的产品对话。
 */
import { z } from "zod";
import {
  knowledgeGraph,
  claimTriState,
  KG_TRI_STATE_LABEL_ZH,
  KG_VISIBILITY_LABEL_ZH,
  KG_GRAPH_VIEW_MAX_NODES,
  type KgObject,
  type KgClaim,
  type KgEdge,
  type KgClaimKind,
  type KgTriState,
  type KgScope,
  type KgVisibility,
  type KgTurnMemory,
  type KgMemoryCard,
  type KgConflictPrompt,
} from "@repo/contracts/chat-knowledge-graph";
import { RetrievalChannel as RetrievalChannelSchema } from "@repo/contracts/context-pack";
import type { ThreadKnowledge, ClaimSources, PromotionResults, PromotionNominations } from "@/lib/knowledge-graph-api";

type RetrievalChannel = z.infer<typeof RetrievalChannelSchema>;

/* 契约输出形状（从操作 schema 派生，不手写第二份） */
export type { ThreadKnowledge, ClaimSources, PromotionResults, PromotionNominations };
export type PersonalKnowledge = z.infer<typeof knowledgeGraph.getPersonalKnowledge.out>;
export type TurnMemory = KgTurnMemory;
export type MemoryCard = KgMemoryCard;
export type ConflictPrompt = KgConflictPrompt;

export {
  KG_TRI_STATE_LABEL_ZH,
  KG_VISIBILITY_LABEL_ZH,
  claimTriState,
  KG_GRAPH_VIEW_MAX_NODES,
};

/* 类型显示用词、分组 / 三态计数 / 禁用词：定义在非 mock 模块（产品路由也要用，不能够到 lib/mock），
 * 这里只 re-export，保持预览与既有单测的 import 不变。 */
export {
  KG_CLAIM_KIND_LABEL_ZH,
  KG_OBJECT_KIND_LABEL_ZH,
  KG_BANNED_USER_FACING_WORDS,
  groupClaimsByKind,
  countByTriState,
} from "@/lib/knowledge-graph-view";

const L0_SCOPE: KgScope = { kind: "chat_session", id: "thread-v2-launch" };
const L1_SCOPE: KgScope = { kind: "personal", id: "user-me" };

/* ── 人和事 ─────────────────────────────────────────────────────────── */
const objects: KgObject[] = [
  { id: "obj-zhangsan", scope: L0_SCOPE, kind: "person", name: "张三", aliases: ["三哥", "Z"], createdBy: "model", claimCount: 3 },
  { id: "obj-lisi", scope: L0_SCOPE, kind: "person", name: "李四", aliases: [], createdBy: "model", claimCount: 2 },
  { id: "obj-custa", scope: L0_SCOPE, kind: "organization", name: "客户 A", aliases: ["A 公司"], createdBy: "human", claimCount: 3 },
  { id: "obj-v2", scope: L0_SCOPE, kind: "product", name: "v2 版本", aliases: ["v2", "2.0"], createdBy: "model", claimCount: 4 },
  { id: "obj-launch", scope: L0_SCOPE, kind: "event", name: "下周一上线", aliases: ["9/29 上线"], createdBy: "model", claimCount: 2 },
  { id: "obj-slo", scope: L0_SCOPE, kind: "metric", name: "P95 延迟", aliases: ["p95"], createdBy: "model", claimCount: 1 },
  { id: "obj-migrate", scope: L0_SCOPE, kind: "concept", name: "数据迁移", aliases: [], createdBy: "model", claimCount: 2 },
  { id: "obj-rollback", scope: L0_SCOPE, kind: "concept", name: "回滚方案", aliases: [], createdBy: "model", claimCount: 1 },
];

/* ── 记下的每一条（覆盖三态 + 五种 kind + supersede + 矛盾对） ──────────── */
function claim(
  id: string,
  kind: KgClaimKind,
  statement: string,
  status: KgClaim["status"],
  opts: Partial<Omit<KgClaim, "id" | "kind" | "statement" | "status" | "triState" | "scope">> = {},
): KgClaim {
  const tri = claimTriState(status);
  return {
    id,
    scope: L0_SCOPE,
    kind,
    statement,
    status,
    // superseded 不下发，这里强制非 null 的调用方不会传 superseded
    triState: (tri ?? "pending") as KgTriState,
    confidence: opts.confidence ?? 0.8,
    createdBy: opts.createdBy ?? "model",
    reviewedBy: opts.reviewedBy ?? null,
    supersedesClaimId: opts.supersedesClaimId ?? null,
    derivedFromClaimId: opts.derivedFromClaimId ?? null,
    aboutObjectIds: opts.aboutObjectIds ?? [],
    supportingCount: opts.supportingCount ?? 1,
    contradictingCount: opts.contradictingCount ?? 0,
    createdAt: opts.createdAt ?? "2026-09-23T09:12:00Z",
  };
}

const claims: KgClaim[] = [
  claim("clm-decision-launch", "decision", "张三决定 v2 版本下周一（9/29）上线。", "accepted", {
    createdBy: "human", reviewedBy: "user-me", confidence: 0.95,
    aboutObjectIds: ["obj-zhangsan", "obj-v2", "obj-launch"], supportingCount: 2,
  }),
  claim("clm-fact-custa", "fact", "客户 A 要求 v2 必须在本季度内交付。", "accepted", {
    createdBy: "human", reviewedBy: "user-me", confidence: 0.9,
    aboutObjectIds: ["obj-custa", "obj-v2"], supportingCount: 3,
  }),
  claim("clm-todo-migrate", "todo", "李四负责在上线前完成数据迁移演练。", "proposed", {
    confidence: 0.72, aboutObjectIds: ["obj-lisi", "obj-migrate", "obj-launch"], supportingCount: 1,
  }),
  claim("clm-risk-slo", "risk", "迁移期间 P95 延迟可能超过 1.5 秒的目标。", "proposed", {
    confidence: 0.6, aboutObjectIds: ["obj-slo", "obj-migrate"], supportingCount: 1,
  }),
  claim("clm-hyp-rollback", "hypothesis", "若迁移失败，30 分钟内可回滚到 v1。", "reviewed", {
    confidence: 0.55, aboutObjectIds: ["obj-rollback", "obj-migrate"], supportingCount: 1,
  }),
  // 矛盾对（M3）：两条对上线日期各执一词，成对并存
  claim("clm-conflict-date-a", "fact", "上线日期定在下周一（9/29）。", "contested", {
    confidence: 0.7, aboutObjectIds: ["obj-launch", "obj-v2"], supportingCount: 2, contradictingCount: 1,
  }),
  claim("clm-conflict-date-b", "fact", "上线日期推迟到下周三（10/1），等迁移演练通过。", "contested", {
    confidence: 0.68, aboutObjectIds: ["obj-launch", "obj-v2"], supportingCount: 1, contradictingCount: 2,
  }),
  claim("clm-fact-owner", "fact", "客户 A 的对接人是王经理。", "accepted", {
    createdBy: "human", reviewedBy: "user-me", confidence: 0.88,
    aboutObjectIds: ["obj-custa"], supportingCount: 1,
  }),
  claim("clm-todo-notify", "todo", "上线后需要给客户 A 发一封确认邮件。", "proposed", {
    confidence: 0.65, aboutObjectIds: ["obj-custa", "obj-launch"], supportingCount: 1,
  }),
  claim("clm-risk-scope", "risk", "v2 的报表模块范围仍未冻结，存在延期风险。", "proposed", {
    confidence: 0.5, aboutObjectIds: ["obj-v2"], supportingCount: 1,
  }),
];

/* ── 关系（人事↔人事、记下的↔人事 about、记下的↔记下的 五类语义） ───────── */
const edges: KgEdge[] = [
  { id: "e1", src: { kind: "claim", id: "clm-decision-launch" }, dst: { kind: "object", id: "obj-v2" }, relation: "about", createdBy: "model" },
  { id: "e2", src: { kind: "claim", id: "clm-decision-launch" }, dst: { kind: "object", id: "obj-zhangsan" }, relation: "decided_by", createdBy: "model" },
  { id: "e3", src: { kind: "claim", id: "clm-fact-custa" }, dst: { kind: "object", id: "obj-custa" }, relation: "about", createdBy: "model" },
  { id: "e4", src: { kind: "claim", id: "clm-fact-custa" }, dst: { kind: "claim", id: "clm-decision-launch" }, relation: "hard_constraint", createdBy: "model" },
  { id: "e5", src: { kind: "claim", id: "clm-todo-migrate" }, dst: { kind: "claim", id: "clm-decision-launch" }, relation: "blocks", createdBy: "model" },
  { id: "e6", src: { kind: "claim", id: "clm-hyp-rollback" }, dst: { kind: "claim", id: "clm-risk-slo" }, relation: "may_shorten", createdBy: "model" },
  { id: "e7", src: { kind: "object", id: "obj-lisi" }, dst: { kind: "object", id: "obj-migrate" }, relation: "mentions", createdBy: "model" },
  { id: "e8", src: { kind: "claim", id: "clm-risk-slo" }, dst: { kind: "object", id: "obj-slo" }, relation: "about", createdBy: "model" },
];

/* ── 会话读模型：各态（visibility 常驻，U-6） ─────────────────────────── */

/** 正常态（所有者，可编辑、可记入长期记忆，整理健康，仅你可见） */
export const threadKnowledgeNormal: ThreadKnowledge = {
  scope: L0_SCOPE,
  revision: 42,
  objects,
  claims,
  edges,
  ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
  canEdit: true,
  canPromote: true,
  visibility: "owner_only",
};

/** 整理中（后台异步抽取尚未完成，R4 A2 / uc-18-1 R8） */
export const threadKnowledgeIngesting: ThreadKnowledge = {
  ...threadKnowledgeNormal,
  ingestion: { queued: 4, running: 2, failed: 0, failures: [] },
};

/** 部分失败（uc-18-1 E1：有 N 条未能整理，可单条重试） */
export const threadKnowledgePartialFailure: ThreadKnowledge = {
  ...threadKnowledgeNormal,
  ingestion: {
    queued: 0,
    running: 1,
    failed: 2,
    failures: [
      { sourceKind: "chat_message", sourceRef: "msg-8842", reason: "model_unavailable" },
      { sourceKind: "attachment", sourceRef: "att-1190", reason: "retries_exhausted" },
    ],
  },
};

/** 只读（非所有者：canEdit=false，canPromote=false；且是共享会话 → 会话成员可见，uc-18-3 R5） */
export const threadKnowledgeReadOnly: ThreadKnowledge = {
  ...threadKnowledgeNormal,
  canEdit: false,
  canPromote: false,
  visibility: "thread_members",
};

/** 空态（本会话还没记下任何东西，uc-18-3 A1） */
export const threadKnowledgeEmpty: ThreadKnowledge = {
  scope: L0_SCOPE,
  revision: 0,
  objects: [],
  claims: [],
  edges: [],
  ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
  canEdit: true,
  canPromote: true,
  visibility: "owner_only",
};

const BULK_KINDS = ["person", "concept", "term", "metric"] as const satisfies readonly KgObject["kind"][];

/** 图超限（> 200 节点 → 折叠为簇，uc-18-3 E4） */
export const threadKnowledgeOversize: ThreadKnowledge = (() => {
  const bigObjects: KgObject[] = [...objects];
  for (let i = 0; i < 260; i++) {
    bigObjects.push({
      id: `obj-bulk-${i}`,
      scope: L0_SCOPE,
      kind: BULK_KINDS[i % BULK_KINDS.length]!,
      name: `节点 ${i + 1}`,
      aliases: [],
      createdBy: "model",
      claimCount: 1,
    });
  }
  return { ...threadKnowledgeNormal, objects: bigObjects };
})();

/** 错误态：读取失败（前端渲染 err-* 用；用契约错误码之一 KG_THREAD_NOT_FOUND / KG_NOT_VISIBLE） */
export const threadKnowledgeErrorCode: (typeof knowledgeGraph.getThreadKnowledge.err)[number] = "KG_NOT_VISIBLE";

/* ── 来源抽屉（UC-KG-2） ───────────────────────────────────────────────── */
export const claimSourcesNormal: ClaimSources = {
  claim: claims[0]!,
  evidence: [
    {
      segmentId: "seg-1",
      stance: "supporting",
      sourceKind: "chat_message",
      sourceRef: "msg-8801",
      excerpt: "张三：那就这么定了，v2 下周一（9/29）上线，迁移演练这周内跑完。",
      locator: null,
      revoked: false,
    },
    {
      segmentId: "seg-2",
      stance: "supporting",
      sourceKind: "attachment",
      sourceRef: "att-1042",
      excerpt: "《v2 发布计划 v3.pdf》：里程碑 M4 — 生产上线，计划日期 9/29（周一）。",
      locator: { page: 4 },
      revoked: false,
    },
  ],
  provenance: [
    { at: "2026-09-23T09:12:00Z", actor: { kind: "system", id: "extractor" }, action: "AI 从对话里记下（decision）", pipelineVersion: "kg-extract@1.4.0" },
    { at: "2026-09-23T10:03:00Z", actor: { kind: "human", id: "user-me" }, action: "你确认过", pipelineVersion: null },
  ],
};

/** 来源已删除（uc-18-5 R8：抽屉打开时源被删） */
export const claimSourcesRevoked: ClaimSources = {
  claim: claims[2]!,
  evidence: [
    {
      segmentId: "seg-9",
      stance: "supporting",
      sourceKind: "chat_message",
      sourceRef: "msg-8842",
      excerpt: "（此来源已被删除）",
      locator: null,
      revoked: true,
    },
  ],
  provenance: [
    { at: "2026-09-23T09:20:00Z", actor: { kind: "system", id: "extractor" }, action: "AI 从对话里记下（todo）", pipelineVersion: "kg-extract@1.4.0" },
    { at: "2026-09-24T08:00:00Z", actor: { kind: "system", id: "cascade" }, action: "来源删除，这条不再被用到（source_deleted）", pipelineVersion: null },
  ],
};

/* ── 记到个人长期记忆（UC-KG-5）逐条结果 ─────────────────────────────────
 * U-3：「AI 记下的」也能记入长期记忆（人点按钮本身就算确认）。只有「有矛盾」和
 * 「来源已删」仍然拒绝——所以这里的拒绝码只剩这两种，不再有「需先确认」。 */
export const promotionResultsMixed: PromotionResults = {
  results: [
    { claimId: "clm-decision-launch", outcome: "promoted", personalClaimId: "p-clm-1" },
    // clm-todo-migrate 是「AI 记下的」（proposed）——U-3 下也能记入，点按钮即确认
    { claimId: "clm-todo-migrate", outcome: "promoted", personalClaimId: "p-clm-5" },
    { claimId: "clm-fact-custa", outcome: "merged_into_existing", personalClaimId: "p-clm-2" },
    { claimId: "clm-fact-owner", outcome: "needs_choice", existingPersonalClaimId: "p-clm-3" },
    { claimId: "clm-conflict-date-a", outcome: "rejected", code: "KG_CONTESTED_NEEDS_RESOLUTION" },
  ],
};

/** 全部成功（happy 变体，用于对照） */
export const promotionResultsAllOk: PromotionResults = {
  results: [
    { claimId: "clm-decision-launch", outcome: "promoted", personalClaimId: "p-clm-1" },
    { claimId: "clm-fact-custa", outcome: "promoted", personalClaimId: "p-clm-2" },
    { claimId: "clm-fact-owner", outcome: "coexisting", personalClaimId: "p-clm-4" },
  ],
};

/* ── AI 提名「值得记住」（UC-KG-6，只提名不执行） ─────────────────────────── */
export const nominationsNormal: PromotionNominations = {
  nominations: [
    { claimId: "clm-decision-launch", rationale: "这是本次对话的核心决定，之后的会话大概率会追问「上线是谁定的、什么时候」。" },
    { claimId: "clm-fact-custa", rationale: "客户 A 的硬性交付要求，跨会话都用得上。" },
    { claimId: "clm-fact-owner", rationale: "对接人信息，日常沟通高频引用。" },
  ],
};

/* ── 一轮回答的记忆摘要（U-1 已记下 N 条 + U-4/U-5 主动卡片，最多一张 E8） ──── */

/** U-4 记住卡（open）：AI 识别到「记住 …」，出一张确认卡，内容可改字 */
export const memoryCardRememberOpen: MemoryCard = {
  cardId: "card-remember-1",
  kind: "remember",
  items: [{ claimId: null, statement: "客户 A 的对接人是王经理，电话找他。" }],
  state: "open",
};

/** U-4 记住卡（done）：点过「记住」→「已记住 · 撤销」 */
export const memoryCardRememberDone: MemoryCard = {
  ...memoryCardRememberOpen,
  state: "done",
};

/** U-4 记住卡（stale）：期间该条已被改，点击返回 KG_REVISION_CHANGED */
export const memoryCardRememberStale: MemoryCard = {
  ...memoryCardRememberOpen,
  state: "stale",
};

/** U-4 忘掉卡（open）：匹配到多条，逐条列出，默认全选 */
export const memoryCardForgetOpen: MemoryCard = {
  cardId: "card-forget-1",
  kind: "forget",
  items: [
    { claimId: "clm-fact-owner", statement: "客户 A 的对接人是王经理。" },
    { claimId: "clm-todo-notify", statement: "上线后需要给客户 A 发一封确认邮件。" },
  ],
  state: "open",
};

/** U-5 矛盾提醒（uc-18-6 D）：新说法与「你确认过」的一条冲突 */
export const conflictPromptNormal: ConflictPrompt = {
  promptId: "prompt-conflict-1",
  newerClaim: { id: "clm-conflict-date-b", statement: "上线改到下周三（10/1）。" },
  olderClaim: { id: "clm-conflict-date-a", statement: "9/29 上线", saidAt: "2026-09-20T00:00:00Z" },
};

/** U-1：本轮记下了 2 条，带一张矛盾卡（一轮最多一张主动卡片） */
export const turnMemoryWithConflict: TurnMemory = {
  messageId: "msg-turn-1",
  captured: [
    { claimId: "clm-conflict-date-b", statement: "上线改到下周三（10/1）。" },
    { claimId: "clm-todo-migrate", statement: "李四负责上线前的迁移演练。" },
  ],
  pending: false,
  prompt: { type: "conflict", conflict: conflictPromptNormal },
};

/** U-1：本轮记下 3 条，带一张「记住」确认卡 */
export const turnMemoryWithRememberCard: TurnMemory = {
  messageId: "msg-turn-2",
  captured: [
    { claimId: "clm-fact-custa", statement: "客户 A 要求本季度交付。" },
    { claimId: "clm-fact-owner", statement: "客户 A 的对接人是王经理。" },
    { claimId: "clm-todo-notify", statement: "上线后给客户 A 发确认邮件。" },
  ],
  pending: false,
  prompt: { type: "memory_card", card: memoryCardRememberOpen },
};

/** U-1：只记下、没有主动卡片（最安静的一轮） */
export const turnMemoryCapturedOnly: TurnMemory = {
  messageId: "msg-turn-3",
  captured: [
    { claimId: "clm-decision-launch", statement: "张三决定 v2 下周一上线。" },
    { claimId: "clm-fact-custa", statement: "客户 A 要求本季度交付。" },
  ],
  pending: false,
  prompt: null,
};

/** U-1：仍在整理中 —— 界面显示「正在记…」，不阻塞正文 */
export const turnMemoryPending: TurnMemory = {
  messageId: "msg-turn-4",
  captured: [],
  pending: true,
  prompt: null,
};

/* ── 「你记得关于 X 的什么」回答（uc-18-6 C）：按「你确认过 / AI 记下的」分两组 ── */
export interface RecallItem {
  readonly claimId: string;
  readonly statement: string;
  readonly sourceRef: string;
  readonly sourceKind: "chat_message" | "attachment";
  /** 记下的日期（界面显示「来自你 {日期} 的对话」用） */
  readonly capturedDate: string;
}
export interface RecallGroup {
  readonly triState: KgTriState;
  readonly items: RecallItem[];
}

export const recallAnswerGroups: RecallGroup[] = [
  {
    triState: "confirmed",
    items: [
      { claimId: "clm-fact-custa", statement: "客户 A 要求 v2 本季度内交付。", sourceRef: "msg-8801", sourceKind: "chat_message", capturedDate: "9/20" },
      { claimId: "clm-fact-owner", statement: "客户 A 的对接人是王经理。", sourceRef: "msg-8809", sourceKind: "chat_message", capturedDate: "9/20" },
    ],
  },
  {
    triState: "pending",
    items: [
      { claimId: "clm-todo-notify", statement: "上线后要给客户 A 发一封确认邮件。", sourceRef: "msg-8842", sourceKind: "chat_message", capturedDate: "9/23" },
    ],
  },
];

/* ── 回答下方：引用 + 「为什么用到它」（UC-KG-2 / context-pack 通道） ──────────── */

/** 展示层：一条召回项。channels 用契约枚举；graphPath 是从 KgEdge/KgObject/KgClaim 组合出的
 *  可读路径字符串（图路径字段是签核待裁项 D-KG-2，见 contracts/chat-knowledge-graph/ui.md 缺口 G-1）。 */
export interface RecalledCitation {
  readonly citationId: string;
  readonly label: string;
  readonly sourceRef: string;
  readonly sourceKind: "chat_message" | "attachment";
  readonly channels: RetrievalChannel[];
  readonly score: number;
  /** FilterAction 留痕的展示名（lead=线索/paired=成对…）；取自 filter-action 单源 */
  readonly reasonLabels: string[];
  /** 图路径的可读渲染（由边组合，不是新契约字段） */
  readonly graphPath: string | null;
  /** 命中的是「AI 记下的」（未确认）时标注（uc-18-2 A2） */
  readonly unconfirmed: boolean;
  /** 命中的是你长期记忆里的一条（uc-18-4 R3-6）；有值时界面显示「来自你 {日期} 的对话」 */
  readonly fromPersonalDate: string | null;
}

export const answerCitationsNormal: RecalledCitation[] = [
  {
    citationId: "cite-1",
    label: "张三决定 v2 下周一上线",
    sourceRef: "msg-8801",
    sourceKind: "chat_message",
    channels: ["graph", "vector", "fts"],
    score: 0.91,
    reasonLabels: ["线索", "召回"],
    graphPath: "张三 → 决定 → v2 上线",
    unconfirmed: false,
    fromPersonalDate: null,
  },
  {
    citationId: "cite-2",
    label: "客户 A 要求本季度交付",
    sourceRef: "att-1042",
    sourceKind: "attachment",
    channels: ["vector", "claim"],
    score: 0.82,
    reasonLabels: ["召回", "成对"],
    graphPath: "客户 A → 硬性要求 → v2 上线",
    unconfirmed: false,
    fromPersonalDate: null,
  },
  {
    citationId: "cite-3",
    label: "李四负责迁移演练（AI 记下的）",
    sourceRef: "msg-8842",
    sourceKind: "chat_message",
    channels: ["fts"],
    score: 0.61,
    reasonLabels: ["召回"],
    graphPath: null,
    unconfirmed: true,
    fromPersonalDate: null,
  },
];

/** 跨会话召回：新会话里带「来自你 9/20 的对话」标签（uc-18-4 V1） */
export const answerCitationsPersonal: RecalledCitation[] = [
  {
    citationId: "cite-p1",
    label: "客户 A 要求 v2 本季度交付",
    sourceRef: "msg-8801",
    sourceKind: "chat_message",
    channels: ["vector", "graph"],
    score: 0.88,
    reasonLabels: ["召回", "线索"],
    graphPath: "客户 A → 硬性要求 → v2",
    unconfirmed: false,
    fromPersonalDate: "9/20",
  },
];

/** 通道健康：哪几路降级不可用（uc-18-2 E1/E2 的可见提示来源）。
 *  ⚠ 这是 UI 侧的占位表达，见 README 缺口清单。 */
export interface ChannelHealth {
  readonly channel: RetrievalChannel;
  readonly available: boolean;
}

export const channelHealthAllOk: ChannelHealth[] = [
  { channel: "fts", available: true },
  { channel: "vector", available: true },
  { channel: "graph", available: true },
  { channel: "claim", available: true },
  { channel: "metadata", available: true },
];

export const channelHealthGraphDown: ChannelHealth[] = channelHealthAllOk.map((c) =>
  c.channel === "graph" ? { ...c, available: false } : c,
);

export const channelHealthVectorDown: ChannelHealth[] = channelHealthAllOk.map((c) =>
  c.channel === "vector" ? { ...c, available: false } : c,
);

/** 关联查询是否可用（图 / 向量任一路降级都算「查不全」）。文案是用词表第五节的固定说法。 */
export function relatedQueryDegraded(health: ChannelHealth[]): boolean {
  return health.some((c) => (c.channel === "graph" || c.channel === "vector") && !c.available);
}

/** 「查不全」的固定文案（用词表：图检索 / 向量检索不可用 → 这句人话）。前端不另写第二份。 */
export const KG_RELATED_QUERY_DEGRADED_ZH =
  "这次没能查全你的记忆（关联查询暂不可用），回答可能不完整";

export const RETRIEVAL_CHANNEL_LABEL_ZH: Record<RetrievalChannel, string> = {
  fts: "全文",
  vector: "相似",
  graph: "关联",
  metadata: "元数据",
  claim: "记下的",
};
