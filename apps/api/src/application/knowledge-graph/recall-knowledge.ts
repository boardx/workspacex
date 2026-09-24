/**
 * Phase 18 F08 —— 对话一轮开始前，召回本会话记下的相关知识（uc-18-2）。
 *
 * 失败**降级**、不 fail run（同 L3 文件检索的纪律）：候选集读不到 ⇒ 这轮不带记忆；图路读不到 ⇒
 * 只用字面召回，并在计划里记 graph.available = false，给模型的材料里带上降级说明（R4-E1）。
 */
import type { OrgId } from "../../domain/org-id";
import { detectMemoryIntent, forgetMatches } from "../../domain/knowledge-graph/memory-intent";
import { buildKnowledgeContextMessage, fuseRecall, graphSeeds, type KnowledgeRecall } from "../../domain/knowledge-graph/recall";
import { newKgId } from "./ids";
import type { KnowledgeRecallPort, MemoryCardPort } from "./ports";

/** 一轮最多放进上下文的记忆条数：够回答「谁定的 / 为什么」，又不挤占对话本身。 */
export const KG_RECALL_LIMIT = 8;

export async function recallThreadKnowledge(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly query: string },
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<KnowledgeRecall> {
  const { claims, objects } = await port.candidates(input.orgId, input.userId, input.threadId);
  const seeds = graphSeeds(input.query, objects);
  let graph: Awaited<ReturnType<KnowledgeRecallPort["graphNeighbors"]>> | null = [];
  if (seeds.length > 0) {
    try {
      graph = await port.graphNeighbors(input.orgId, seeds.map((id) => `object:${id}`));
    } catch (e) {
      log("knowledge recall graph channel unavailable, continuing without it", {
        threadId: input.threadId, detail: e instanceof Error ? e.message : "unexpected graph failure",
      });
      graph = null;
    }
  }
  return fuseRecall({ query: input.query, claims, objects, graph, limit: KG_RECALL_LIMIT });
}

/**
 * 对话一轮开始前交给模型的那段【记忆】参考材料；没有命中 ⇒ null。
 * 与 L3 文件检索同一条降级纪律：召回整个失败 ⇒ 记一条日志、这轮不带记忆，绝不 fail run；
 * 只有图路失败 ⇒ 只用字面召回，材料里带一句「可能不完整」让模型如实告诉用户（R4-E1）。
 */
export async function knowledgeMemoryFor(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly query: string; readonly runId: string },
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<string | null> {
  try {
    const recall = await recallThreadKnowledge(port, input, log);
    await recordTurn(port, input, recall, log);
    return buildKnowledgeContextMessage(recall);
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
 * 记录失败只记日志——回答照常带着记忆，只是下方不显示引用（不拖累对话，06-UX R3-8）。
 */
async function recordTurn(
  port: KnowledgeRecallPort,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly runId: string },
  recall: KnowledgeRecall,
  log: (message: string, detail: Record<string, unknown>) => void,
): Promise<void> {
  const graphDegraded = recall.plan.some((p) => p.channel === "graph" && !p.available);
  if (recall.items.length === 0 && !graphDegraded) return;
  try {
    await port.recordTurn(input.orgId, {
      runId: input.runId, threadId: input.threadId, userId: input.userId, graphDegraded,
      items: recall.items.map((i) => ({
        claimId: i.claim.id, channels: i.channels, retrievalReasons: i.retrievalReasons, score: i.score, graphPath: i.graphPath,
      })),
    });
  } catch (e) {
    log("knowledge recall could not be recorded for this turn", {
      runId: input.runId, detail: e instanceof Error ? e.message : "unexpected record failure",
    });
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * F17（uc-18-6 A / B）：这一轮用户明确说了「记住：…」「忘掉 …」⇒ 开一张确认卡，挂在这一轮的回答下面。
 *
 * **Agent 只出卡，不执行**（R7-1、I-17）：这里只开 open 的卡，不碰任何一条记忆；记不记、忘不忘由人点
 * （actOnMemoryCard，执行身份是点击的人）。意图识别是确定的前缀规则（domain/knowledge-graph/memory-intent.ts），
 * 不确定就不出卡（A1）。忘掉卡的候选与召回同一份（本会话 + 个人线程里本人的个人空间），
 * 列的正是「下一轮会被召回的」那些。
 *
 * 返回给模型的一句说明（放在上下文里）：卡已经出了、还没生效，别说「已经记住 / 忘掉了」；
 * 忘掉却一条也没找到 ⇒ 让模型照实说「没找到相关的记忆」（A2）。没有意图 / 不是所有者 ⇒ null。
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
    const { claims } = await knowledge.candidates(input.orgId, input.userId, input.threadId);
    const matches = forgetMatches(intent.target, claims);
    // 0 条也交给数据库：不是所有者 ⇒ not_owner（什么都不说），是所有者 ⇒ no_items（照实说没找到）。
    const r = await cards.open(input.orgId, { ...base, kind: "forget", claimIds: matches.map((c) => c.id) });
    if (r.outcome === "opened") {
      return `【记忆卡片】用户想让你忘掉「${oneLine(intent.target)}」。系统已在这条回答下方列出相关的记忆（默认全选），用户点「忘掉」之后才会生效——现在还没有忘，不要说「已经忘掉了」。`;
    }
    if (r.outcome === "no_items") {
      return `【记忆卡片】用户想让你忘掉「${oneLine(intent.target)}」，但没找到相关的记忆。请直接告诉用户：没找到相关的记忆。`;
    }
    return null;
  } catch (e) {
    log("memory card could not be opened for this turn, continuing without it", {
      runId: input.runId, detail: e instanceof Error ? e.message : "unexpected memory card failure",
    });
    return null;
  }
}
