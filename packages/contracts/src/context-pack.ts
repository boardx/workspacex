/**
 * 契约束 `context-pack` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据          ←── 这条是关键
 *
 * 覆盖 feature：F09 F10 F11 F12 F13（phase-00，合计 21 点）
 * 依据 UC：`00-core/uc-0-2 Studio 打开时带上项目上下文`
 * 领域模型见 `phases/phase-00-shared-kernel/contracts/context-pack/domain.md`
 * 用例接口见 同目录 `usecases.md`
 *
 * ⚠ 结构与 `docs/architecture/context-engine.md` 第四节**逐字对齐**：
 *   Context Pack 不是字符串数组，而是三段结构 `items[]` / `claims[]` / `omissions[]`。
 */
import { z } from "zod";
// ⚠ `omissions[].reason` 的七类封闭枚举**单一事实源在 `./omission-reason.ts`**（同包，2026-07-28 由 apps/web 迁入）（裁决 D-U4）。
//   这里**引用**它，不另起一套——否则就是第六次「同一事实声明在两处」（ADR-020）。
//   新增类别必须走 ADR。
import { OMISSION_REASON_KEYS } from "./omission-reason";
import type { OmissionReason } from "./omission-reason";
// ⚠ 五种筛选动作同理：**单一事实源在 `./filter-action.ts`**（2026-07-29 由 F11 收敛）。
//   收敛前这里是 `recall/downweight/exclude/paired/lead`，而 `apps/web/lib/mock/brain.ts`
//   是 `recall/downweight/exclude/pair/clue` —— 两份键对不上，且两边都不会报错。
import { FILTER_ACTION_KEYS } from "./filter-action";
import type { FilterActionKey } from "./filter-action";

/* ─────────────────────── 枚举（与 domain.md 一一对应）─────────────────────── */

/**
 * ⚠ `omissions[].reason` 的封闭枚举，**值来自单一事实源** `./omission-reason.ts`。
 * 命名刻意用 `...Schema` 后缀避开与该文件 `export type OmissionReason` 的重名
 * （否则 `lint-contract-source` 会把那份 type 误判成契约副本）。
 * `withdrawn` / `expired` / `unauthorized` 属**合规性丢弃，必须始终可见**——见 `compliance` 标记。
 */
export const OmissionReasonSchema = z.enum(
  OMISSION_REASON_KEYS as [OmissionReason, ...OmissionReason[]],
);

/** 上下文条目的来源类型（八来源，对应 context-engine.md 第二节的物化规则） */
export const ContextSourceType = z.enum([
  "file", "survey", "interview", "workshop",
  "photo", "conversation", "deep-research", "ai-generated",
]);

/**
 * **五路召回通道**（query-planned hybrid，**推翻** graph-first）。
 * ⚠ 这是**一个装配操作内部并行跑的五路**，不是五个 API——RRF 融合要求五路同跑同融，
 *   拆成五个操作会把融合逻辑推给调用方。见 `usecases.md` 的 `AssembleContextPack`。
 * `graph` 只给固定加成，不单独决定结果；`fts` 是**一等通道**（精确原话/编号/姓名/术语）。
 */
export const RetrievalChannel = z.enum([
  "fts", "vector", "graph", "metadata", "claim",
]);

/**
 * 五种筛选动作（R3），**值来自单一事实源** `./filter-action.ts`（含展示名与解释）。
 *
 * ⚠ 一条可命中多个。**但不是五种都能落在 `items[].retrievalReasons`**：
 * `exclude` 的结果就是「这条不在 items[] 里」，它的痕迹只能在 `omissions[]`——
 * 见 `KNOWN_CONTRACT_GAPS.G1` 与 `filter-action.ts` 的 `tracedIn`。
 */
export const FilterAction = z.enum(
  FILTER_ACTION_KEYS as [FilterActionKey, ...FilterActionKey[]],
);

/** Claim 五态（与 context-engine.md `claims.status` 一致） */
export const ClaimStatus = z.enum([
  "proposed", "reviewed", "accepted", "contested", "superseded",
]);

/** 查询任务类型（决定各通道权重的「query-planned」输入） */
export const QueryTask = z.enum(["search", "answer", "research", "decision-support"]);

/** 任务类型的取值，供 `thresholds.ts` 按任务类型配相关度阈值（O-36）时引用，不另列一份 */
export type QueryTaskName = z.infer<typeof QueryTask>;

/** 证据策略（QueryContext.evidencePolicy） */
export const EvidencePolicy = z.enum(["primary-only", "reviewed", "all"]);

/**
 * 机密约束来源——**复用 `identity` 束 `ConstraintSource` 的同一套语义**（跨束，见 coverage 缺口）。
 * 在这里重列是为让 context-pack 的 `resolvePackModelConstraint` 自洽；
 * 一致性复核须确认它与 `identity.ConstraintSource` 是同一枚举，不得漂移。
 */
export const ModelConstraintSource = z.enum(["promise", "policy", "none"]);

/**
 * context-pack 的失败模式全集——**「失败长什么样」是契约的一半**，界面的异常态全靠它。
 * 已有原型（大脑「AI 读到了什么」屏）是 happy path 演示、零异常态，不要继承这个缺陷。
 */
export const ContextPackReason = z.enum([
  "EMPTY_CANDIDATE_SET",             // E1：新项目无材料→真实空态，AI 被阻断（不得伪造上下文）
  "RETRIEVAL_UNAVAILABLE",           // E3/V6：检索依赖失败→阻断 AI，**不得降级为「无上下文直接生成」**
  "BUDGET_EXCEEDS_MANUAL",           // E2：预算装不下全部**人工指定**项→报错让人取舍，不静默丢弃
  "PERMISSION_REVOKED_MIDWAY",       // E4：装配中权限被撤→立即终止，前端清空，不残留越权内容
  "EVIDENCE_WITHDRAWN_MIDWAY",       // E5：使用期间上游证据被撤→标「证据已撤回」并阻断依赖它的定版
  "CITATION_OUT_OF_PACK",            // V1：AI 引用了不在本 Pack 中的证据→拒绝并记录
  "CONFIDENTIAL_REQUIRES_LOCAL_MODEL", // V9/D-U1：含机密条目但无可用本地模型→阻断，云端整轮不可用
  "MANUAL_ITEM_UNAUTHORIZED",        // 手动增补的 segment 不在调用者可见范围→拒绝
  "RUN_NOT_FOUND",                   // 重放/固化/审计：runId 不存在
  "PIN_REQUIRES_SNAPSHOT",           // 固化时目标不是固定快照版本
  "ANCHOR_MISSING",                  // 候选 segment 无任何锚点→**不合格，不得纳入 items[]**（I-1）
]);

/* ─────────────────────────────── 值对象 ─────────────────────────────── */

/**
 * **引用锚点**——回到原件的定位信息。
 * ⚠ **全项目硬不变量**：无锚点的引用视为不合格（I-1）。至少命中一种字段，**缺一不可**。
 * 该「至少命中一种」是跨字段约束，不写成 zod refine（会污染 mock 生成），
 * 由 domain I-1 的断言与 application 层强制。
 */
/**
 * 引用锚点。
 *
 * ⚠ **修订 E-1（2026-07-29，按推论采纳）**：补 `imageRegion`。
 * 原定义的六个字段覆盖不了 `artifact.Anchor` 的 `image-region` 一种，
 * 而 `photo` 是八种 `ContextSourceType` 之一 ⇒ **每个照片派生的 segment 都被 I-1
 * 结构性地挡在所有 Context Pack 之外，且悄无声息**（读起来像「相关性低」）。
 * 那是产品少了一整类内容，而没有任何东西会报。
 *
 * ⚠ **修订 E-2**：`endMs` 此前不可达——引用面有跨度，而存储侧的 locator 只有时间点。
 * 修法是给**存储侧**支持 timespan（`SegmentKind` 本就有 `audio-span`），
 * 而不是从引用面删掉 `endMs`：后者是向下妥协，会让「引用到一段话」永远做不到。
 */
export const Anchor = z.object({
  page: z.number().int().optional(),
  bbox: z.array(z.number()).optional(),
  startMs: z.number().int().optional(),
  endMs: z.number().int().optional(),
  messageId: z.string().optional(),
  surveyQuestionId: z.string().optional(),
  /** 图像区域（归一化 0–1，左上原点）。photo / 扫描件的锚点落在这里 */
  imageRegion: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .strict()
    .optional(),
}).strict();

/** 查询上下文（context-engine.md 第四节 `QueryContext` 逐字对齐） */
export const QueryContext = z.object({
  tenantId: z.string(),
  principalId: z.string(),
  projectIds: z.array(z.string()),
  task: QueryTask,
  query: z.string(),
  timeRange: z.object({ from: z.string().nullable(), to: z.string().nullable() }).strict().nullable(),
  allowedSensitivity: z.array(z.string()),
  /** ⚠ 不写死 120k：随模型窗口推导，超限按相关度截断（裁决 O-36） */
  tokenBudget: z.number().int().positive(),
  freshnessRequirement: z.string().nullable(),
  evidencePolicy: EvidencePolicy,
}).strict();

/**
 * 一条上下文条目 —— **八字段六元组，无一为空**（R6 AC2 / R12 V2 / V10）。
 * 六元组映射：资源 ID→`artifactVersionId`+`segmentId`；版本→`artifactVersionId`；
 * 来源→`sourceType`+`anchor`；可见范围→`permissionDecisionId`；相关度→`score`；筛选动作→`retrievalReasons`。
 */
export const ContextItem = z.object({
  segmentId: z.string(),
  content: z.string(),
  sourceType: ContextSourceType,
  /** 指向不可变版本（`artifact` 束 F05 的固定快照）——跨束引用 */
  artifactVersionId: z.string(),
  anchor: Anchor,
  /** 本条为什么进来 / 被怎么处理——五种筛选动作的留痕载体（至少一个） */
  retrievalReasons: z.array(FilterAction),
  /** 命中了哪几路召回（可解释性；FTS 一等通道的可断言证据，见 V11） */
  channels: z.array(RetrievalChannel),
  score: z.number(),
  /** 「为什么这条能给你看」可回溯——指向 `identity` 束一次真实的 PermissionDecision（跨束） */
  permissionDecisionId: z.string(),
}).strict();

/** Claim 引用——**反对证据强制保留**（R7）：`contradictingSegmentIds` 不得被筛除 */
export const ClaimRef = z.object({
  statement: z.string(),
  status: ClaimStatus,
  supportingSegmentIds: z.array(z.string()),
  contradictingSegmentIds: z.array(z.string()),
}).strict();

/**
 * 一条丢弃记录 —— **被丢弃不等于不存在**（R7）。
 * `reason` 用七类封闭枚举；`compliance` 为 true 的（withdrawn/expired/unauthorized）**必须始终可见**，
 * 不因「只显示前 N 条」的折叠或截断从界面消失。
 */
export const Omission = z.object({
  /** 被丢弃内容的标识：优先 segmentId；召回前就被挡的候选用 candidateId */
  ref: z.string(),
  reason: OmissionReasonSchema,
  /** 是否合规性丢弃（由单一事实源 `OMISSION_REASONS[r].compliance` 推出，**不另存**） */
  compliance: z.boolean(),
  /** 面向被解释的人的一句话（取自单一事实源的 explain，可带上下文补充） */
  explain: z.string(),
}).strict();

/** 一路召回在本次装配里的计划与权重（query-planned 的可审查投影） */
export const RetrievalChannelPlan = z.object({
  channel: RetrievalChannel,
  weight: z.number(),
  hitCount: z.number().int().nonnegative(),
}).strict();

/* ─────────────────────────────── 聚合 ─────────────────────────────── */

/**
 * Context Pack —— 三段结构。**同 `runId` 可重放得到同一 `items[]`**（I-5，纯函数断言）。
 * 一经用于产出定版即随快照固化，此后上游变化不改写它（I-7）。
 */
export const ContextPack = z.object({
  packId: z.string(),
  /** 可重放的稳定标识：同 runId 重放 ⇒ 同 items[]（context-engine 首批门槛第 ⑥ 条） */
  runId: z.string(),
  query: QueryContext,
  retrievalPlan: z.array(RetrievalChannelPlan),
  items: z.array(ContextItem),
  claims: z.array(ClaimRef),
  omissions: z.array(Omission),
  /** 预算占用（如 14.9k / 120k）；tokenBudget 随模型窗口推导（O-36） */
  tokensUsed: z.number().int().nonnegative(),
  /** 已固化为定版快照时非 null——固化后本对象内容按 contentHash 不可变（I-7） */
  pinnedSnapshotId: z.string().nullable(),
}).strict();

export const Citation = z.object({
  segmentId: z.string(),
  artifactVersionId: z.string(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

/**
 * 每个操作 = { method, path, in, out, err }。
 * `err` 穷举失败模式——界面的异常态逐个覆盖，别只写 happy path。
 */
export const operations = {
  /**
   * F09 + F10：装配 Context Pack。
   * **五路并行召回在此操作内部完成**（不是五个 API）：权限/租户过滤（SQL/RLS 层）→ query 分类 →
   * 五路并行召回（fts/vector/graph/metadata/claim）→ RRF 融合 → rerank → 去重/来源多样性/支持反驳平衡
   * → 按 tokenBudget 压缩 → 返回 items[] + claims[] + omissions[]。
   */
  assembleContextPack: {
    method: "POST", path: "/context-packs",
    in: z.object({
      runId: z.string(),
      orgId: z.string(),
      projectId: z.string().nullable(),
      principalId: z.string(),
      task: QueryTask,
      query: z.string(),
      tokenBudget: z.number().int().positive().optional(),
      evidencePolicy: EvidencePolicy,
      freshnessRequirement: z.string().nullable(),
      /** A4 手动增补：人工指定项**不受相关度阈值裁剪**（E2 时报错不静默丢弃） */
      manualItemSegmentIds: z.array(z.string()),
    }).strict(),
    out: ContextPack,
    err: [
      "RETRIEVAL_UNAVAILABLE",
      "BUDGET_EXCEEDS_MANUAL",
      "PERMISSION_REVOKED_MIDWAY",
      "CONFIDENTIAL_REQUIRES_LOCAL_MODEL",
    ] as const,
  },

  /**
   * F13：按 runId 重放。**纯函数断言**：同 runId ⇒ 同 items[]（context-engine 首批门槛 ⑥）。
   * 已固化的定版还原「这条结论当时看了什么」（V8 审计态）。
   */
  replayContextPack: {
    method: "GET", path: "/context-packs/:runId",
    in: z.object({ runId: z.string() }).strict(),
    out: ContextPack,
    err: ["RUN_NOT_FOUND"] as const,
  },

  /**
   * F11：丢弃清单可审查（V3/V13）。**合规性丢弃始终全量返回**，不受分页/折叠影响。
   */
  listOmissions: {
    method: "GET", path: "/context-packs/:runId/omissions",
    in: z.object({
      runId: z.string(),
      reasonFilter: OmissionReasonSchema.optional(),
    }).strict(),
    out: z.object({
      omissions: z.array(Omission),
      /** 被丢弃数量（原型「被丢弃 · 14 条低相关」） */
      droppedCount: z.number().int().nonnegative(),
      /** 所用相关度阈值（原型 0.45；按任务类型可配，O-36） */
      thresholdUsed: z.number(),
      /** ⚠ 合规性丢弃（withdrawn/expired/unauthorized）**必被此列表全量包含**，永不折叠 */
      complianceAlwaysShown: z.array(Omission),
    }).strict(),
    err: ["RUN_NOT_FOUND"] as const,
  },

  /**
   * F12：AI 调用前置闸门——空态 / 依赖失败 / 机密无本地模型时**阻断**，不得「无上下文直接生成」。
   */
  gateAiCall: {
    method: "POST", path: "/context-packs/:runId/ai-gate",
    in: z.object({ runId: z.string() }).strict(),
    out: z.object({
      allowed: z.boolean(),
      /** allowed=false 时给出分层原因（EMPTY_CANDIDATE_SET / RETRIEVAL_UNAVAILABLE / CONFIDENTIAL_...） */
      blockReason: ContextPackReason.nullable(),
    }).strict(),
    err: ["RUN_NOT_FOUND"] as const,
  },

  /**
   * F12：引用完整性校验（V1 / AC1 / context-engine 首批门槛 ①）。
   * AI 产出引用的每条证据都必须在本次 Pack 的 items[] 中，否则拒绝并记录。
   */
  verifyCitation: {
    method: "POST", path: "/context-packs/:runId/verify-citation",
    in: z.object({
      runId: z.string(),
      citedSegmentIds: z.array(z.string()),
    }).strict(),
    out: z.object({
      allowed: z.boolean(),
      /** 越界引用的 segmentId 清单（空数组=全部在包内） */
      offendingSegmentIds: z.array(z.string()),
    }).strict(),
    err: ["RUN_NOT_FOUND", "CITATION_OUT_OF_PACK"] as const,
  },

  /**
   * F13：随定版固化。把本次 Pack 引用清单随固定快照一同固化，此后上游变化不改写它（I-7）。
   */
  pinContextPack: {
    method: "POST", path: "/context-packs/:runId/pin",
    in: z.object({
      runId: z.string(),
      /** 目标必须是**固定快照**版本（`artifact` 束 F06），否则 PIN_REQUIRES_SNAPSHOT */
      artifactVersionId: z.string(),
    }).strict(),
    out: z.object({
      snapshotId: z.string(),
      /** 固化内容的内容哈希——固化后按此哈希断言不可变 */
      contentHash: z.string(),
      frozenItemCount: z.number().int().nonnegative(),
    }).strict(),
    err: ["RUN_NOT_FOUND", "PIN_REQUIRES_SNAPSHOT"] as const,
  },

  /**
   * F13：机密材料本地模型路由（V9 / D-U1）。**含任何机密条目 ⇒ 本轮所有模型调用走本地，
   * 云端整轮不可用**（不是分流）。语义委托 `identity.resolveModelConstraint`，此处按本 Pack 的
   * items 机密性求值——**跨束**，一致性复核须确认两者判定一致。
   */
  /**
   * resolvePackModelConstraint —— **委托给 `identity.resolveModelConstraint`，不重新判定**
   * （一致性复核 B-3 / X-5）。
   *
   * 本操作只做两件事：① 从 runId 解出本 Pack 的 dataScope（哪些 item 含机密）；
   * ② 拿着它调 identity 的判定，原样返回其 `localOnly` / `source` / `reason`，
   * 另附 `confidentialItemCount` 供界面显示「有几条机密」。
   *
   * ⚠ **不得在此处重新实现判定逻辑**——`source` 一旦分叉，
   * 「产品承诺」与「组织策略」的区别就会被抹平，而两者可否关闭完全不同。
   */
  resolvePackModelConstraint: {
    method: "POST", path: "/context-packs/:runId/model-constraint",
    in: z.object({ runId: z.string() }).strict(),
    out: z.object({
      localOnly: z.boolean(),
      source: ModelConstraintSource,
      reason: z.string(),
      confidentialItemCount: z.number().int().nonnegative(),
    }).strict(),
    err: ["RUN_NOT_FOUND"] as const,
  },

  /**
   * A4 手动增补：把某条材料加入 Pack，标「人工指定」，**不受相关度阈值裁剪**。
   * 越权 segment 拒绝（MANUAL_ITEM_UNAUTHORIZED）；预算装不下报错（BUDGET_EXCEEDS_MANUAL）。
   */
  addManualItem: {
    method: "POST", path: "/context-packs/:runId/items",
    in: z.object({
      runId: z.string(),
      segmentId: z.string(),
      actorId: z.string(),
    }).strict(),
    out: ContextPack,
    err: ["RUN_NOT_FOUND", "BUDGET_EXCEEDS_MANUAL", "MANUAL_ITEM_UNAUTHORIZED"] as const,
  },

  /**
   * A3 调整检索权重后重新装配。**每次调整留痕，不可静默生效**（新 packId，同 runId 沿革）。
   */
  adjustRetrievalWeights: {
    method: "POST", path: "/context-packs/:runId/reassemble",
    in: z.object({
      runId: z.string(),
      /** 各通道权重覆盖（键为 RetrievalChannel） */
      weights: z.record(z.number()),
    }).strict(),
    out: ContextPack,
    err: ["RUN_NOT_FOUND", "RETRIEVAL_UNAVAILABLE"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/**
 * 实现期查出、**尚未修的**契约缺口 —— 如实登记，不自行发明字段或原因码
 * （写法同 `auth.ts` 的 `KNOWN_CONTRACT_GAPS`；ADR-020 签核的契约只有人类能改）。
 *
 * ⚠ 这些是 **F11 实现时撞到的**，不是评审看出来的：每一条都是「按契约写下去，
 * 会写出一个自洽但答不出问题的实现」。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`exclude` 永远不可能出现在 `items[].retrievalReasons` 里。**
   *
   * 契约原文（本文件 `FilterAction` 的注释）与 F11 的验收（`user_visible_behavior`）
   * 都写着「五种筛选动作**逐条留痕于 `items[].retrievalReasons`**」。
   * 但 `exclude` 的定义是「已撤销条目**永久排除**」——被排除的候选按定义不在 `items[]` 里，
   * 于是这条痕迹**结构性地无处可落**。
   *
   * 后果如果不登记：实现者面前只有两条路，都坏——
   *   ① 给某条留下来的 item 打上 `exclude`（**说谎**，它没被排除）；
   *   ② 干脆不留痕（验收那句话变成四种动作，而没有任何东西会红）。
   *
   * F11 的处理：`exclude` 的痕迹落在 `omissions[]`（reason=`withdrawn`），
   * 并把「哪种动作留在哪一段」写进 `filter-action.ts` 的 `tracedIn` 让它可被断言。
   * **没有改契约的字段，也没有给 item 打假标记。**
   */
  G1: "`exclude` can never appear in items[].retrievalReasons -- an excluded candidate is by definition not an item; its only possible trace is omissions[]",
  /**
   * `usecases.md` 的 `ListOmissions` 输出写的是
   * `{ omissions, droppedCount, thresholdUsed, tokenBudget, complianceAlwaysShown }`，
   * 而本文件的 `listOmissions.out` **没有 `tokenBudget`**。
   *
   * 影响不是少一个字段：`budget` 类丢弃的解释是「预算用尽被截断」，
   * 而读的人拿不到本次预算是多少，**这句解释就无法核对**。
   */
  G2: "usecases.md's ListOmissions returns tokenBudget; the operation's out schema omits it, so a `budget` discard cannot be checked against the budget it blames",
  /**
   * **I-4 的前提在契约里不存在。** I-4 说合规性丢弃「在任何折叠/截断/**分页**下都出现在返回中」，
   * 但 `listOmissions` 的 `in` 里**没有任何分页/截断参数**——服务端不可能分页，
   * 于是「折叠」只发生在前端，I-4 在 API 层是**无法被证伪的**。
   *
   * F11 的处理：把 I-4 的断言放在**它真正能失效的那一层**（前端把长尾折叠起来的那段代码），
   * 同时在 API 层断言 `complianceAlwaysShown` 不受 `reasonFilter` 影响（那是契约里唯一
   * 真实存在的收窄手段）。
   */
  G3: "listOmissions has no pagination/limit input, so I-4's 「分页下合规项仍返回」 cannot fail at the API layer; the fold only exists in the frontend",
  /**
   * `Omission` 只有 `ref`（segmentId 或 candidateId），**没有任何人类可读的标识**。
   * 「被丢弃不等于不存在」要成立，读的人得知道被丢弃的是**什么**；
   * 原型那一栏渲染的是标题（「波兰储能补贴细则 2023」），而契约给不出标题。
   * 前端只能拿到一串 id ⇒ 要么另发一次请求（契约没有这个操作），要么编一个展示名。
   */
  G4: "Omission carries only a ref id -- no title/snippet -- so a discard list rendered strictly from the contract shows the reader a list of opaque ids",
  /**
   * Pack 有 `tokensUsed`，但**没有任何一条 item 或 omission 带自己的 token 体积**。
   * 于是「为什么裁掉的是这条而不是那条」在 Pack 内不可重建——
   * `budget` 类丢弃的可审查性只到「它被预算裁了」为止。
   */
  G5: "no per-item token size anywhere in the pack, so a `budget` discard cannot be shown to be the right one to drop",
  /**
   * **相关度阈值 0.45 今天没有可施加的对象。**
   *
   * O-36 的阈值是 [0,1] 上的相关度，而 phase-00 的流水线里**没有任何东西产出这样一个数**：
   * `ContextItem.score` 装的是 RRF 融合分（`domain/retrieval/rrf.ts` 明写它不是概率、
   * 不是相似度，`1/(60+1)` 已经是 0.016），`RerankPort` 返回的是**顺序不是分数**，
   * 而模型网关不在本阶段。
   *
   * 后果如果不登记：实现者会把 RRF 分喂进 0.45（**几乎全被丢弃**，且丢弃清单会煞有介事地
   * 写「相关度 0.016 < 0.45」），或者随手归一化一个看起来合理的数——
   * 那个数会被渲染、被截图，从此变成事实标准（`thresholds.ts` 开头那段事故）。
   *
   * F11 的处理：阈值**规则**实现并断言，相关度数值由调用方显式提供，且被 `Relevance`
   * 品牌类型挡住（`domain/context-pack/screening.ts`）——想把融合分当相关度用，
   * 必须自己写一句话说明它的来源。
   */
  G6: "nothing in phase-00 produces a [0,1] relevance figure for O-36's threshold to act on; ContextItem.score is an RRF score and RerankPort returns an order, not scores",
} as const;
