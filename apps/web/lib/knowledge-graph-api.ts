/**
 * phase-18 F09 —— 会话「记忆」面板（chat-knowledge-graph 束）的前端取数口。
 *
 * 只读操作，全部对着契约 `knowledgeGraph`（`packages/contracts/src/chat-knowledge-graph.ts`）：
 *   · `getThreadKnowledge`    GET /knowledge-graph/threads/:threadId              —— 面板列表 + 图共用的读模型
 *   · `getClaimSources`       GET /knowledge-graph/claims/:claimId/sources        —— 来源抽屉
 *   · `getTurnMemory`         GET /knowledge-graph/threads/:threadId/messages/:messageId/memory —— 回答下「已记下 N 条」
 *   · `getMessageExtraction`  GET /knowledge-graph/threads/:threadId/messages/:messageId/extraction
 *     （issue #4180）—— 发送下方「已记下：{摘要}·撤销」，只认这一条消息自己的证据
 *
 * 返回值一律经契约 `out` schema 校验——形状只有契约一份，这里不另猜。校验失败不是
 * "空数据"，是协议违约：照样抛，让界面进错误态，不静默吞成一个空面板。
 *
 * 失败时抛 `KnowledgeGraphError`：`code` 是契约封闭错误码 `KgErrorCode` 的成员
 * （后端失败信封的 `reasonCode`），拿不到可识别的码（网络断、网关 HTML、路由尚未挂载）
 * 时为 `null`——调用方显示通用失败提示，不猜一个码（404 不等于「对话不存在」：路由
 * 没挂也是 404）。
 *
 * F10 加了第一个写口 `applyHumanAction`（POST /knowledge-graph/threads/:threadId/actions）：
 * 确认 / 批量确认 / 改写 / 忘掉 / 标矛盾 / 合并 / 拆分 / 改名。
 * F11 加「记到我的长期记忆」：`promoteToPersonal`（POST .../promote，逐条结果）与
 * `listPromotionNominations`（GET .../nominations，AI 只提名不执行）。F17 加 `actOnMemoryCard`
 * （POST /knowledge-graph/cards/:cardId，回答下的「记住 / 忘掉」确认卡）。「整理本会话」仍不在
 * 本文件（F13），不为了让按钮"看起来能点"先造一个调不通的调用。
 */
import type { z } from "zod";
import { knowledgeGraph, KgErrorCode, type KgHumanAction } from "@repo/contracts/chat-knowledge-graph";
import { ApiError, apiRequest } from "@/lib/api-client";

export type ThreadKnowledge = z.infer<typeof knowledgeGraph.getThreadKnowledge.out>;
export type ClaimSources = z.infer<typeof knowledgeGraph.getClaimSources.out>;
export type TurnMemory = z.infer<typeof knowledgeGraph.getTurnMemory.out>;
export type PromotionResults = z.infer<typeof knowledgeGraph.promoteToPersonal.out>;
export type PromotionNominations = z.infer<typeof knowledgeGraph.listPromotionNominations.out>;
/** `needs_choice` 条目的人的选择：「合并到已有的那条」/「两条都保留」。 */
export type PromotionChoice = NonNullable<z.infer<typeof knowledgeGraph.promoteToPersonal.in>["choices"]>[number];
export type KnowledgeGraphErrorCode = z.infer<typeof KgErrorCode>;

/** 面板错误态要区分的两个码（`getThreadKnowledge.err`）。 */
export type ThreadKnowledgeErrorCode = (typeof knowledgeGraph.getThreadKnowledge.err)[number];

export class KnowledgeGraphError extends Error {
  constructor(
    /** 契约错误码；`null` = 不是本束的可识别失败（网络 / 网关 / 路由未挂 / 响应形状不符）。 */
    readonly code: KnowledgeGraphErrorCode | null,
    /** HTTP 状态；非 HTTP 失败（fetch 抛错、响应形状不符）为 `null`。 */
    readonly status: number | null,
    /** 原始失败（`ApiError` / 网络错误 / zod 校验错误），排查用，不上屏。 */
    readonly original?: unknown,
  ) {
    super(code ?? (status === null ? "knowledge_graph_unavailable" : `http_${String(status)}`));
    this.name = "KnowledgeGraphError";
  }
}

function toKnowledgeGraphError(e: unknown): KnowledgeGraphError {
  if (e instanceof KnowledgeGraphError) return e;
  if (e instanceof ApiError) {
    const parsed = KgErrorCode.safeParse(e.reasonCode);
    return new KnowledgeGraphError(parsed.success ? parsed.data : null, e.status, e);
  }
  return new KnowledgeGraphError(null, null, e);
}

/** 把任意失败收窄成面板要的错误码；不是本束可识别的码时返回 `null`。 */
export function knowledgeGraphErrorCode(e: unknown): KnowledgeGraphErrorCode | null {
  return e instanceof KnowledgeGraphError ? e.code : toKnowledgeGraphError(e).code;
}

export async function getParsed<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  init?: { method: "POST"; body: unknown },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await apiRequest<unknown>(path, { signal, method: init?.method, body: init?.body });
  } catch (e) {
    throw toKnowledgeGraphError(e);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new KnowledgeGraphError(null, null, parsed.error);
  return parsed.data;
}

const seg = (v: string): string => encodeURIComponent(v);

/** 项目中枢 R8：项目大脑（项目记忆 L2）。非成员 403 `KG_NOT_VISIBLE`。 */
export type ProjectKnowledge = z.infer<typeof knowledgeGraph.getProjectKnowledge.out>;
export function fetchProjectKnowledge(projectId: string, signal?: AbortSignal): Promise<ProjectKnowledge> {
  return getParsed(`/knowledge-graph/projects/${seg(projectId)}`, knowledgeGraph.getProjectKnowledge.out, signal);
}

/** B2-S4：组织大脑（组织记忆 L3）。任何组织成员可读；外人 403 `KG_NOT_VISIBLE`。 */
export type OrgKnowledge = z.infer<typeof knowledgeGraph.getOrgKnowledge.out>;
export function fetchOrgKnowledge(signal?: AbortSignal): Promise<OrgKnowledge> {
  return getParsed("/knowledge-graph/org", knowledgeGraph.getOrgKnowledge.out, signal);
}

export function fetchThreadKnowledge(threadId: string, signal?: AbortSignal): Promise<ThreadKnowledge> {
  return getParsed(`/knowledge-graph/threads/${seg(threadId)}`, knowledgeGraph.getThreadKnowledge.out, signal);
}

export function fetchClaimSources(claimId: string, signal?: AbortSignal): Promise<ClaimSources> {
  return getParsed(`/knowledge-graph/claims/${seg(claimId)}/sources`, knowledgeGraph.getClaimSources.out, signal);
}

export function fetchTurnMemory(threadId: string, messageId: string, signal?: AbortSignal): Promise<TurnMemory> {
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/messages/${seg(messageId)}/memory`,
    knowledgeGraph.getTurnMemory.out,
    signal,
  );
}

export type MessageExtraction = z.infer<typeof knowledgeGraph.getMessageExtraction.out>;

/** issue #4180：这条消息自己是否刚被抽取出新结论——发送下方「已记下：{摘要}·撤销」。 */
export function fetchMessageExtraction(threadId: string, messageId: string, signal?: AbortSignal): Promise<MessageExtraction> {
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/messages/${seg(messageId)}/extraction`,
    knowledgeGraph.getMessageExtraction.out,
    signal,
  );
}

export type UndoAutoPersonalCopyResult = z.infer<typeof knowledgeGraph.undoAutoPersonalCopy.out>;

/**
 * UC-KG-14（issue #4283）：撤销系统自动记进本人个人空间的那一份决定。`claimId` 是会话里的原结论
 * （反馈条上那一条）。已经不在（撤过 / 已确认过）⇒ `KG_CLAIM_NOT_FOUND`，调用方按已撤销处理。
 */
export function undoAutoPersonalCopy(threadId: string, claimId: string): Promise<UndoAutoPersonalCopyResult> {
  const input = knowledgeGraph.undoAutoPersonalCopy.in.parse({ threadId, claimId });
  return getParsed(
    `/knowledge-graph/threads/${seg(input.threadId)}/claims/${seg(input.claimId)}/personal-copy/undo`,
    knowledgeGraph.undoAutoPersonalCopy.out,
    undefined,
    { method: "POST", body: {} },
  );
}

export type HumanActionResult = z.infer<typeof knowledgeGraph.applyHumanAction.out>;

/**
 * UC-KG-3：人的编辑动作。`basedOnRevision` 必须是调用方手里最新一次 `getThreadKnowledge`
 * 的 `revision`（乐观并发）；服务端已被别人改过时回 `KG_REVISION_CHANGED`，调用方应重读再决定。
 * 请求体先过契约 `in` schema（去掉 `threadId`，它在路径里）——形状错了在本地就抛，不发出去。
 */
export function applyHumanAction(
  threadId: string,
  basedOnRevision: number,
  action: KgHumanAction,
): Promise<HumanActionResult> {
  const input = knowledgeGraph.applyHumanAction.in.parse({ threadId, basedOnRevision, action });
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/actions`,
    knowledgeGraph.applyHumanAction.out,
    undefined,
    { method: "POST", body: { basedOnRevision: input.basedOnRevision, action: input.action } },
  );
}

/**
 * UC-KG-5：记到我的长期记忆。逐条返回结果（部分成功，不整批回滚，uc-18-4 E4）；
 * 未确认的条目由服务端在同一动作里先以本人确认（U-3）。`choices` 只在回答 `needs_choice` 时带。
 * 请求体先过契约 `in` schema（1..50 条）——超批在本地就抛，不发出去。
 */
export type ReindexResult = z.infer<typeof knowledgeGraph.requestReindex.out>;

/**
 * UC-KG-4 requestReindex（issue #4352）：「整理本会话」/「失败 · 重试」——把本会话的消息重新排进抽取队列。
 * 只有会话所有者可以（否则 `KG_NOT_OWNER`）；本会话还在整理 ⇒ `KG_REINDEX_ALREADY_RUNNING`。
 */
export function requestReindex(threadId: string, sourceRefs?: readonly string[]): Promise<ReindexResult> {
  const input = knowledgeGraph.requestReindex.in.parse({
    threadId, ...(sourceRefs !== undefined ? { sourceRefs: [...sourceRefs] } : {}),
  });
  return getParsed(
    `/knowledge-graph/threads/${seg(input.threadId)}/reindex`,
    knowledgeGraph.requestReindex.out,
    undefined,
    { method: "POST", body: input.sourceRefs !== undefined ? { sourceRefs: input.sourceRefs } : {} },
  );
}

export function promoteToPersonal(
  threadId: string,
  claimIds: readonly string[],
  choices?: readonly PromotionChoice[],
): Promise<PromotionResults> {
  const input = knowledgeGraph.promoteToPersonal.in.parse({
    threadId,
    claimIds: [...claimIds],
    ...(choices && choices.length > 0 ? { choices: [...choices] } : {}),
  });
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/promote`,
    knowledgeGraph.promoteToPersonal.out,
    undefined,
    { method: "POST", body: { claimIds: input.claimIds, ...(input.choices ? { choices: input.choices } : {}) } },
  );
}

/**
 * 项目中枢 R7：记到项目大脑（L0 → L2）。与 `promoteToPersonal` 同一套逐条结果形状；
 * 服务端只放行线程创建者或本项目引导师（`KG_NOT_OWNER`），个人线程 `KG_SCOPE_NOT_PROJECT`。
 */
export function promoteToProject(
  threadId: string,
  claimIds: readonly string[],
  choices?: readonly PromotionChoice[],
): Promise<PromotionResults> {
  const input = knowledgeGraph.promoteToProject.in.parse({
    threadId,
    claimIds: [...claimIds],
    ...(choices && choices.length > 0 ? { choices: [...choices] } : {}),
  });
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/promote-to-project`,
    knowledgeGraph.promoteToProject.out,
    undefined,
    { method: "POST", body: { claimIds: input.claimIds, ...(input.choices ? { choices: input.choices } : {}) } },
  );
}

/**
 * B2-S4：记到组织记忆（L2 → L3）。`claimIds` 是项目大脑（`getProjectKnowledge.claims`）里的 id；与 `promoteToProject`
 * 同一套逐条结果形状。服务端只放行本组织 lead / admin（`KG_NOT_OWNER`）。
 */
export function promoteToOrg(
  projectId: string,
  claimIds: readonly string[],
  choices?: readonly PromotionChoice[],
): Promise<PromotionResults> {
  const input = knowledgeGraph.promoteToOrg.in.parse({
    projectId,
    claimIds: [...claimIds],
    ...(choices && choices.length > 0 ? { choices: [...choices] } : {}),
  });
  return getParsed(
    `/knowledge-graph/projects/${seg(projectId)}/promote-to-org`,
    knowledgeGraph.promoteToOrg.out,
    undefined,
    { method: "POST", body: { claimIds: input.claimIds, ...(input.choices ? { choices: input.choices } : {}) } },
  );
}

/** UC-KG-6：AI 提名「值得记住」的条目。只读——提名本身不改任何东西，记不记由人点。 */
export function listPromotionNominations(threadId: string, signal?: AbortSignal): Promise<PromotionNominations> {
  return getParsed(
    `/knowledge-graph/threads/${seg(threadId)}/nominations`,
    knowledgeGraph.listPromotionNominations.out,
    signal,
  );
}

export type MemoryCardResult = z.infer<typeof knowledgeGraph.actOnMemoryCard.out>;
export type MemoryCardDecision = z.infer<typeof knowledgeGraph.actOnMemoryCard.in>["decision"];

/**
 * UC-KG-12（F17）：对回答下的「记住 / 忘掉」确认卡做决定。执行身份是点击的人（服务端只接受人类会话）。
 * `claimIds`：忘掉卡上还勾着的条目（省略 = 卡上全部）；`editedStatement`：记住卡改过的字（省略 = 卡上原文）。
 * 请求体先过契约 `in` schema——形状错了在本地就抛，不发出去。
 */
export function actOnMemoryCard(
  cardId: string,
  decision: MemoryCardDecision,
  opts: { readonly claimIds?: readonly string[]; readonly editedStatement?: string } = {},
): Promise<MemoryCardResult> {
  const input = knowledgeGraph.actOnMemoryCard.in.parse({
    cardId,
    decision,
    ...(opts.claimIds !== undefined ? { claimIds: [...opts.claimIds] } : {}),
    ...(opts.editedStatement !== undefined ? { editedStatement: opts.editedStatement } : {}),
  });
  return getParsed(`/knowledge-graph/cards/${seg(cardId)}`, knowledgeGraph.actOnMemoryCard.out, undefined, {
    method: "POST",
    body: {
      decision: input.decision,
      ...(input.claimIds !== undefined ? { claimIds: input.claimIds } : {}),
      ...(input.editedStatement !== undefined ? { editedStatement: input.editedStatement } : {}),
    },
  });
}

/**
 * UC-KG-12b（issue #4361）：撤销一张已生效的「忘掉」卡——这张卡忘掉的记忆恢复（连同长期记忆里的副本）。
 * 执行身份是点击的人；别人的卡 / 不存在的卡同一个 404（KG_CARD_NOT_FOUND）。
 */
export function undoMemoryCard(cardId: string): Promise<MemoryCardResult> {
  const input = knowledgeGraph.undoMemoryCard.in.parse({ cardId });
  return getParsed(`/knowledge-graph/cards/${seg(input.cardId)}/undo`, knowledgeGraph.undoMemoryCard.out, undefined, {
    method: "POST",
    body: {},
  });
}

/* ── 大脑页（/brain）：本人的长期记忆 + 各对话的记忆概况 ───────────────────────── */

export type PersonalKnowledge = z.infer<typeof knowledgeGraph.getPersonalKnowledge.out>;
export type BrainOverview = z.infer<typeof knowledgeGraph.getBrainOverview.out>;

/** UC-KG-7：本人个人空间（长期记忆）。只有本人读得到；别人的个人空间没有入口。 */
export function fetchPersonalKnowledge(signal?: AbortSignal): Promise<PersonalKnowledge> {
  return getParsed("/knowledge-graph/personal", knowledgeGraph.getPersonalKnowledge.out, signal);
}

/** 大脑页概况：本人记下了东西的对话（每个一行计数）+ 长期记忆里每条来自哪个对话。 */
export function fetchBrainOverview(signal?: AbortSignal): Promise<BrainOverview> {
  return getParsed("/knowledge-graph/me/overview", knowledgeGraph.getBrainOverview.out, signal);
}

/* ── S7（#4364）：回答下引用 chip 上的当场纠正 + 纠正率 ───────────────────────── */

export type CitationCorrection = z.infer<typeof knowledgeGraph.correctCitation.out>;
export type CitationCorrectionKind = z.infer<typeof knowledgeGraph.correctCitation.in>["kind"];
export type CitationMetrics = z.infer<typeof knowledgeGraph.getCitationMetrics.out>;

/**
 * 「这条不对」（`wrong`，可带新说法 ⇒ 取代）/「已过时」（`expired`）。只有对话所有者、且是这一轮的提问人能做；
 * 不是这一轮的引用 ⇒ `KG_CLAIM_NOT_FOUND`。
 */
export function correctCitation(
  threadId: string,
  messageId: string,
  claimId: string,
  kind: CitationCorrectionKind,
  replacement?: string,
): Promise<CitationCorrection> {
  const input = knowledgeGraph.correctCitation.in.parse({
    threadId, messageId, claimId, kind, ...(replacement !== undefined ? { replacement } : {}),
  });
  return getParsed(
    `/knowledge-graph/threads/${seg(input.threadId)}/messages/${seg(input.messageId)}/citations/${seg(input.claimId)}/correction`,
    knowledgeGraph.correctCitation.out,
    undefined,
    { method: "POST", body: { kind: input.kind, ...(input.replacement !== undefined ? { replacement: input.replacement } : {}) } },
  );
}

/** 本人的引用纠正率（质量信号）。 */
export function fetchCitationMetrics(signal?: AbortSignal): Promise<CitationMetrics> {
  return getParsed("/knowledge-graph/me/citation-metrics", knowledgeGraph.getCitationMetrics.out, signal);
}
