/**
 * Phase 18 F08 —— 对话一轮开始前，召回本会话记下的相关知识（uc-18-2）。
 *
 * 失败**降级**、不 fail run（同 L3 文件检索的纪律）：候选集读不到 ⇒ 这轮不带记忆；图路读不到 ⇒
 * 只用字面召回，并在计划里记 graph.available = false，给模型的材料里带上降级说明（R4-E1）。
 */
import type { OrgId } from "../../domain/org-id";
import { buildKnowledgeContextMessage, fuseRecall, graphSeeds, type KnowledgeRecall } from "../../domain/knowledge-graph/recall";
import type { KnowledgeRecallPort } from "./ports";

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
