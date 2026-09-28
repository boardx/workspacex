/**
 * Phase 18 F08 —— 对话一轮开始前，召回本会话记下的相关知识（uc-18-2）。
 *
 * 失败**降级**、不 fail run（同 L3 文件检索的纪律）：候选集读不到 ⇒ 这轮不带记忆；图路读不到 ⇒
 * 只用字面召回，并在计划里记 graph.available = false，给模型的材料里带上降级说明（R4-E1）。
 * S9（#4366）：向量通道与图路并行、有时限（KG_VECTOR_RECALL_TIMEOUT_MS）；没配置嵌入模型 ⇒ 未启用（不提醒）；
 * 配置了但失败 / 超时 ⇒ 这一轮降级为字面 + 图，同样如实说明。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { detectMemoryIntent, forgetMatches, MEMORY_CARD_MAX_ITEMS } from "../../domain/knowledge-graph/memory-intent";
import {
  buildKnowledgeContextMessage, fuseRecall, graphSeeds, recallable, recallDegraded, VECTOR_RECALL_TOP_K, type KnowledgeRecall, type RecallClaim, type VectorHit,
} from "../../domain/knowledge-graph/recall";
import { withProfileSummary } from "../../domain/knowledge-graph/profile";
import { changeOfMindFor, type ChangeMindPorts } from "./change-mind";
import { newKgId } from "./ids";
import type { KnowledgeRecallPort, MemoryCardPort } from "./ports";

/** 一轮最多放进上下文的记忆条数：够回答「谁定的 / 为什么」，又不挤占对话本身。 */
export const KG_RECALL_LIMIT = 8;

export async function recallThreadKnowledge(
  port: KnowledgeRecallPort,
  input: {
    readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly query: string;
    /** issue #4360：这一轮在发起人本人的个人对话里 ⇒ 另带画像摘要（有界，见 domain/knowledge-graph/profile.ts）。 */
    readonly personalThread?: boolean;
  },
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<KnowledgeRecall> {
  // S9（#4366）：候选集一开始读，向量通道就开始嵌入问题（两者并行）；SQL 仍只在候选 id 里找。
  const candidates = port.candidates(input.orgId, input.userId, input.threadId);
  // issue #4363（S6）：过期 / 不做了的不交给向量通道——否则它们会占掉 top-k 的名额，把还算数的挤出去。
  const now = new Date();
  const ids = candidates.then((c) => c.claims.filter((x) => recallable(x, now)).map((x) => x.id));
  const vectorP = vectorChannel(port, input, ids, log);
  // 候选集读失败时这两个派生的 Promise 也会失败：它们的结果不再有人等，吞掉以免成为未处理的拒绝
  //（召回整体失败由 await candidates 抛出、调用方降级）。
  ids.catch(() => undefined);
  vectorP.catch(() => undefined);
  const { claims, objects } = await candidates;
  const seeds = graphSeeds(input.query, objects);
  const graphChannel = async (): Promise<Awaited<ReturnType<KnowledgeRecallPort["graphNeighbors"]>> | null> => {
    if (seeds.length === 0) return [];
    try {
      return await port.graphNeighbors(input.orgId, seeds.map((id) => `object:${id}`));
    } catch (e) {
      log("knowledge recall graph channel unavailable, continuing without it", {
        threadId: input.threadId, detail: e instanceof Error ? e.message : "unexpected graph failure",
      });
      return null;
    }
  };
  // S9（#4366）：两路并行，一轮的等待是较慢的那一路，不是两路相加。
  const [graph, vector] = await Promise.all([graphChannel(), vectorP]);
  const recall = fuseRecall({ query: input.query, claims, objects, graph, ...(vector === undefined ? {} : { vector }), limit: KG_RECALL_LIMIT, now });
  // issue #4360 / S6：画像摘要同样只看「这一轮还算数」的（没过期、不是不做了的待办）——与召回候选同一个 recallable 判定。
  return input.personalThread === true ? withProfileSummary(recall, claims.filter((c) => recallable(c, now))) : recall;
}

/**
 * 向量通道一轮的时间上限（嵌入问题 + HNSW 查询）。超过就按故障降级：这一轮只用字面 + 图，并告诉用户可能不完整——
 * 记忆不能拖住回答的首字（06-UX R3-8 / E10）。
 */
export const KG_VECTOR_RECALL_TIMEOUT_MS = 400;

/**
 * S9（#4366）向量通道：没实现 / 没配置 ⇒ undefined（未启用，不提醒）；成功 ⇒ 命中；失败或超时 ⇒ null（故障，降级）。
 * 失败只记固定形状的原因码，不记问题原文。
 */
async function vectorChannel(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly query: string },
  claimIds: Promise<readonly string[]>,
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<readonly VectorHit[] | null | undefined> {
  if (port.vectorNeighbors === undefined) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  // 时限从候选集读完算起（向量通道比字面 / 图多出来的等待不超过它）；读候选集本身的时间不算在向量头上。
  const timeout = claimIds.then(() => new Promise<never>((_, reject) => {
    if (!settled) timer = setTimeout(() => reject(new Error("kg_vector_recall_timeout")), KG_VECTOR_RECALL_TIMEOUT_MS);
  }));
  timeout.catch(() => undefined);
  try {
    const hits = await Promise.race([
      port.vectorNeighbors(input.orgId, input.userId, input.query, claimIds, VECTOR_RECALL_TOP_K),
      timeout,
    ]);
    return hits === null ? undefined : hits;
  } catch (e) {
    // 错误自带的 code（如 VectorDimensionMismatchError 的 vector_query_dimension_mismatch）优先，其次是固定形状的 message。
    const own = (e as { code?: unknown } | null)?.code;
    const m = typeof own === "string" && /^vector_[a-z_]+$/.test(own) ? own : e instanceof Error ? e.message : "";
    log("knowledge recall vector channel unavailable, continuing with text and graph only", {
      threadId: input.threadId,
      code: /^(?:embedding_[a-z_]+|kg_vector_[a-z_]+|vector_[a-z_]+)$/.test(m) ? m : "kg_vector_recall_failed",
    });
    return null;
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

/**
 * 对话一轮开始前交给模型的那段【记忆】参考材料；没有命中 ⇒ null。
 * 与 L3 文件检索同一条降级纪律：召回整个失败 ⇒ 记一条日志、这轮不带记忆，绝不 fail run；
 * 只有图路失败 ⇒ 只用字面召回，材料里带一句「可能不完整」让模型如实告诉用户（R4-E1）。
 */
export async function knowledgeMemoryFor(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly query: string; readonly runId: string; readonly personalThread?: boolean },
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<string | null> {
  try {
    const recall = await recallThreadKnowledge(port, input, log);
    if (await recordTurn(port, input, recall, log)) return buildKnowledgeContextMessage(recall);
    // round 7（#4284 收口）：抽取那一侧靠这条记录判断「这一轮的回答用没用个人记忆」（项目会话里用过的回答不抽）。
    // 记录没写成 ⇒ 那道闸看不见 ⇒ 这一轮就不用个人空间的条目（fail closed）；本会话的照用。
    const personal = recall.items.filter((i) => i.claim.scope === "personal").length;
    if (personal === 0) return buildKnowledgeContextMessage(recall);
    log("knowledge recall not recorded, dropping personal-space items from this turn", { runId: input.runId, dropped: personal });
    return buildKnowledgeContextMessage({ ...recall, items: recall.items.filter((i) => i.claim.scope !== "personal") });
  } catch (e) {
    log("agent run knowledge recall failed, continuing without memory", {
      runId: input.runId,
      detail: e instanceof Error ? e.message : "unexpected knowledge recall failure",
    });
    return null;
  }
}

/**
 * F13：把这一轮用到的记忆记下来，回答下方的引用 chip 与「为什么用到它」从这里读。
 * 记录失败只记日志、返回 false——回答照常带着本会话的记忆，只是下方不显示引用（不拖累对话，06-UX R3-8）；
 * 个人空间的条目这一轮不用（见 knowledgeMemoryFor，round 7）。
 */
async function recordTurn(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly runId: string },
  recall: KnowledgeRecall,
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<boolean> {
  // S9（#4366）：列名沿用 F13 的 graph_degraded，读侧早已按「这一轮召回降级」（recallDegraded）解释——
  // 图路或向量通道任一**故障**都记 true（没配置向量不算），回答下方那一行「这次没能查全你的记忆」照常出现。
  const graphDegraded = recallDegraded(recall);
  if (recall.items.length === 0 && !graphDegraded) return true;
  try {
    await port.recordTurn(input.orgId, {
      runId: input.runId, threadId: input.threadId, userId: input.userId, graphDegraded,
      items: recall.items.map((i) => ({
        claimId: i.claim.id, channels: i.channels, retrievalReasons: i.retrievalReasons, score: i.score, graphPath: i.graphPath,
      })),
    });
    return true;
  } catch (e) {
    log("knowledge recall could not be recorded for this turn", {
      runId: input.runId, detail: e instanceof Error ? e.message : "unexpected record failure",
    });
    return false;
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * F17（uc-18-6 A / B）：这一轮用户明确说了「记住：…」「忘掉 …」⇒ 开一张确认卡，挂在这一轮的回答下面。
 *
 * **Agent 只出卡，不执行**（R7-1、I-17）：这里只开 open 的卡，不碰任何一条记忆；记不记、忘不忘由人点
 * （actOnMemoryCard，执行身份是点击的人）。意图识别是确定的前缀规则（domain/knowledge-graph/memory-intent.ts），
 * 不确定就不出卡（A1）。
 *
 * #4361（phase-18 S4）：
 *   - 忘掉卡的候选 = 本人个人空间里召回得到的全部（本会话 + 长期记忆 + 本人别的个人对话里记下的，F15 同一个口径），
 *     不再只限本会话与长期记忆；只在本人的个人对话里开（项目会话 ⇒ 不出卡、如实说明，不碰项目层的记忆）；
 *     点了「忘掉」之后可以撤销（undoMemoryCard）。
 *   - 「你记得我什么」⇒ 一张清单卡（kind = overview，按种类分组、每条带来源对话），给模型的是同一份分组清单；
 *   - 「我改主意了，改成 Y」⇒ R8 的改口取代，确定地走一遍（change-mind.ts；需要 `change` 端口，没接 ⇒ 不做）。
 *
 * 返回给模型的一句说明（放在上下文里）：卡已经出了、还没生效，别说「已经记住 / 忘掉了」；
 * 忘掉却一条也没找到 ⇒ 一句**有条件的**说明（A2，见 no_items 分支）。没有意图 / 不是所有者 ⇒ null。
 * 与召回同一条降级纪律：出错只记日志、这轮不出卡，绝不 fail run。
 */
export async function memoryCardFor(
  knowledge: KnowledgeRecallPort,
  cards: MemoryCardPort,
  input: {
    readonly orgId: OrgId; readonly userId: string; readonly threadId: string;
    readonly runId: string; readonly messageId: string; readonly text: string;
  },
  log: (message: string, detail: Record<string, unknown>) => void,
  change?: ChangeMindPorts,
): Promise<string | null> {
  const intent = detectMemoryIntent(input.text);
  if (intent === null) return null;
  const base = {
    cardId: newKgId("card"), threadId: input.threadId, runId: input.runId,
    messageId: input.messageId, requesterUserId: input.userId,
  };
  try {
    if (intent.kind === "remember") {
      const r = await cards.open(input.orgId, { ...base, kind: "remember", statement: intent.statement });
      if (r.outcome === "opened") {
        return `【记忆卡片】用户请你记住：「${oneLine(intent.statement)}」。系统已在这条回答下方放了一张确认卡，用户点「记住」之后才会记到长期记忆——现在还没有记，不要说「已经记住了」，可以提醒用户点卡片确认。`;
      }
      if (r.outcome === "not_personal") {
        return "【记忆卡片】用户想让你记住一件事，但长期记忆只能在用户自己的个人对话里记；请如实告诉用户，这次没有记下。";
      }
      return null;
    }
    if (intent.kind === "change") {
      if (change === undefined) return null;
      return await changeOfMindFor(cards, change, {
        orgId: input.orgId, userId: input.userId, threadId: input.threadId, messageId: input.messageId,
        text: input.text, statement: intent.statement,
      }, async () => (await knowledge.candidates(input.orgId, input.userId, input.threadId)).claims);
    }
    const { claims } = await knowledge.candidates(input.orgId, input.userId, input.threadId);
    if (intent.kind === "overview") return await overviewCardFor(cards, base, input.orgId, claims);
    // 忘掉卡列本人个人空间里召回得到的全部（本会话 + 长期记忆 + 本人别的个人对话）；数据库逐条复核它们都在本人个人空间里。
    const matches = forgetMatches(intent.target, claims);
    // 0 条也交给数据库：不是所有者 ⇒ not_owner（什么都不说），是所有者 ⇒ no_items（照实说没找到）。
    const r = await cards.open(input.orgId, { ...base, kind: "forget", target: intent.target, claimIds: matches.map((c) => c.id) });
    if (r.outcome === "opened") {
      return `【记忆卡片】用户想让你忘掉「${oneLine(intent.target)}」。系统已在这条回答下方列出相关的记忆（默认全选），用户点「忘掉」之后才会生效——现在还没有忘，不要说「已经忘掉了」。`;
    }
    if (r.outcome === "not_personal") {
      return "【记忆卡片】用户想让你忘掉某条记忆，但管理长期记忆只能在用户自己的个人对话里做（这里是项目对话，项目里的记忆不在这里改）；请如实告诉用户，这次没有忘掉任何东西。";
    }
    // uc-18-6 R4-A2：「忘掉」匹配到 0 条 ⇒ 回答「没找到相关的记忆」，不出卡片。但前缀规则挡不尽「忘掉之前聊的」
    // 「忘掉格式要求」这类说的是这次对话 / 要求本身的话——所以不下命令，只给一句有条件的说明：真是在让忘掉记忆，
    // 就照 A2 说没找到；只是在说这次对话或别的事，照常回答、不提记忆。卡片照样不出。
    if (r.outcome === "no_items") {
      return `【记忆卡片】用户可能是想让你忘掉某条记忆，但没找到与「${oneLine(intent.target)}」相关的记忆。如果用户确实是在让你忘掉记忆，请告诉他没找到相关的记忆；如果只是在说这次对话或别的事，照常回答，不要提记忆。`;
    }
    return null;
  } catch (e) {
    log("memory card could not be opened for this turn, continuing without it", {
      runId: input.runId, detail: e instanceof Error ? e.message : "unexpected memory card failure",
    });
    return null;
  }
}

/**
 * #4361「你记得我什么」：本人个人空间里召回得到的记忆，按种类（契约 `KG_CLAIM_KIND_DISPLAY_ORDER`）排好，前 20 条上卡；
 * 给模型的是同一份按种类分组的清单（全部，最多 60 条），让它照着分组回答、每组点出来自哪里。
 */
export const OVERVIEW_CONTEXT_MAX = 60;

async function overviewCardFor(
  cards: MemoryCardPort,
  base: { readonly cardId: string; readonly threadId: string; readonly runId: string; readonly messageId: string; readonly requesterUserId: string },
  orgId: OrgId,
  claims: readonly RecallClaim[],
): Promise<string | null> {
  const rank = (k: RecallClaim["kind"]) => KG.KG_CLAIM_KIND_DISPLAY_ORDER.indexOf(k);
  const ordered = [...claims].sort((a, b) => rank(a.kind) - rank(b.kind) || (b.saidAt ?? "").localeCompare(a.saidAt ?? "") || a.id.localeCompare(b.id));
  const r = await cards.open(orgId, { ...base, kind: "overview", claimIds: ordered.slice(0, MEMORY_CARD_MAX_ITEMS).map((c) => c.id) });
  if (r.outcome === "not_personal") {
    return "【记忆卡片】用户在问你记得他什么。长期记忆只能在用户自己的个人对话里查看（这里是项目对话，别的成员也看得到回答）；请如实告诉用户去个人对话或「大脑」页查看，不要在这里列出他的个人记忆。";
  }
  if (r.outcome === "no_items") {
    return "【记忆卡片】用户在问你记得他什么。长期记忆里现在没有关于他的内容；请如实告诉他还没有记住任何事，可以说「记住：…」让你记下来。";
  }
  if (r.outcome !== "opened") return null;
  const groups = KG.KG_CLAIM_KIND_DISPLAY_ORDER
    .map((kind) => ({ kind, items: ordered.slice(0, OVERVIEW_CONTEXT_MAX).filter((c) => c.kind === kind) }))
    .filter((g) => g.items.length > 0)
    .map((g) => `${KG.KG_CLAIM_KIND_LABEL_ZH[g.kind]}：\n${g.items.map((c) => `- ${oneLine(c.statement)}（${sourceOf(c)}）`).join("\n")}`);
  return `【记忆卡片】用户在问你记得他什么。系统已在这条回答下方放了一张按种类分组的清单，每条都能跳到原来的对话。请按下面的分组如实概括，不要编造清单以外的内容：\n${groups.join("\n")}`;
}

/** 给模型看的出处：本对话 / 长期记忆 / 本人另一个对话（链接在卡上，这里只说在哪）。 */
const sourceOf = (c: RecallClaim): string =>
  c.originThreadId !== undefined ? "你的另一个对话" : c.scope === "personal" ? "长期记忆" : "本对话";

/**
 * 执行器里与记忆有关的依赖：execute-run.ts 的 `ExecuteAgentRunDeps` 继承它，定义只在这一处（执行器保持薄网关）。
 * 都**可选**，与 `files` 同一条既有理由：既有测试与不需要记忆的执行路径不必都改，生产合成
 * （`kernel.module.ts` → `AgentRunExecutor`）必定注入。
 */
export interface TurnKnowledgeDeps {
  /** Phase 18 F08 —— 会话知识召回（uc-18-2）。缺省不注入 ⇒ history 与 F08 之前逐字节相同。 */
  readonly knowledge?: KnowledgeRecallPort;
  /** Phase 18 F17 「记住 / 忘掉」只开确认卡（I-17）。同 `knowledge`；两者都注入才生效。 */
  readonly memoryCards?: MemoryCardPort;
  /**
   * #4361「我改主意了，改成 Y」这一轮确定地走 R8 的改口取代（抽取执行器 + 取代 + 自动记入，都是抽取任务已经在用的端口）。
   * 同 `memoryCards`；不注入 ⇒ 改口仍只经抽取之后的 R8（与 #4361 之前相同）。
   */
  readonly memoryChange?: ChangeMindPorts;
}

/**
 * 执行器的唯一入口（execute-run.ts 只调它）：这一轮交给模型的记忆材料，按放进 history 的先后排好——
 * 先是 F17 的卡片说明（没接卡片端口 / 没有明确意图 ⇒ 没有），再是 F08 的【记忆】召回材料（没命中 ⇒ 没有）。
 * 读身份恒为这一轮的发起人、会话恒为这一轮所在的会话（run.requesterUserId / run.threadId）。两样都降级不 fail run。
 */
export async function turnKnowledgeContext(
  knowledge: KnowledgeRecallPort,
  cards: MemoryCardPort | undefined,
  input: {
    readonly orgId: OrgId;
    readonly run: {
      readonly requesterUserId: string; readonly threadId: string; readonly inputText: string;
      readonly runId: string; readonly inputMessageId: string;
      /** 个人对话 ⇒ null（或空串，同 execute-run.ts 的判法）；issue #4360 的画像摘要只进个人对话。 */
      readonly projectId?: string | null;
    };
  },
  log: (message: string, detail: Record<string, unknown>) => void,
  change?: ChangeMindPorts,
): Promise<readonly string[]> {
  const { orgId, run } = input;
  // 卡片先于召回：#4361「改主意」在这一步就可能取代掉旧决定，召回要读取代之后的样子（不再把旧说法交给模型）。
  const card = cards === undefined ? null : await memoryCardFor(knowledge, cards, {
    orgId, userId: run.requesterUserId, threadId: run.threadId, runId: run.runId, messageId: run.inputMessageId, text: run.inputText,
  }, log, change);
  // issue #4360：画像摘要只进个人对话（run.projectId 为空，同 execute-run.ts 的判法）；这个判断同样只取自 run。
  const memory = await knowledgeMemoryFor(knowledge, { orgId, userId: run.requesterUserId, threadId: run.threadId, query: run.inputText, runId: run.runId, personalThread: run.projectId === null || run.projectId === "" }, log);
  return [card, memory].filter((x): x is string => x !== null);
}
