/**
 * Phase 18 F08 —— 对话一轮开始前，召回本会话记下的相关知识（uc-18-2）。
 *
 * 失败**降级**、不 fail run（同 L3 文件检索的纪律）：候选集读不到 ⇒ 这轮不带记忆；图路读不到 ⇒
 * 只用字面召回，并在计划里记 graph.available = false，给模型的材料里带上降级说明（R4-E1）。
 */
import type { OrgId } from "../../domain/org-id";
import { fuseRecall, graphSeeds, type KnowledgeRecall } from "../../domain/knowledge-graph/recall";
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
