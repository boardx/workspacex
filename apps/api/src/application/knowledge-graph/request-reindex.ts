/**
 * UC-KG-4 requestReindex（issue #4352）—— 「整理本会话」：把本会话的消息重新排进抽取队列。
 *
 * - 会话可见性与读接口同一判定（`visibleThread`）：看不见与不存在同一个出口 KG_THREAD_NOT_FOUND。
 * - 只有会话所有者能整理（契约 pre，uc-18-3 R5 同款：编辑动作只给所有者）⇒ 否则 KG_NOT_OWNER。
 * - 部署没有配置抽取模型 ⇒ 什么都不排（`queued: 0`）：没有任何东西会消费这些行，排进去只会让面板永远「整理中」。
 * - 部署开关 / 组织开关关着 ⇒ 数据库那一侧同样什么都不排（「关闭期间的消息不会整理」，打开后再点这里补）。
 * - 本会话还有在整理中的行 ⇒ KG_REINDEX_ALREADY_RUNNING（不叠加一次整理）。
 * - 幂等（I-7）：已经抽过的消息重新排进来，执行器按 `sourceRef + pipeline 版本` 原样返回，不产生重复行。
 * - 「失败 · 重试」走这同一条路：次数用完的失败行被重置成新任务。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { KgHumanActionError, type KgReindexPort } from "./ports";
import { visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";

export interface RequestReindexDeps extends KnowledgeReadDeps {
  readonly reindex: KgReindexPort;
  /** 部署是否配置了抽取模型 provider（`KgExtractionModelConfig.enabled`）。 */
  readonly extractionConfigured: boolean;
}

export async function requestReindex(
  deps: RequestReindexDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly threadId: string; readonly sourceRefs?: readonly string[] },
): Promise<z.infer<typeof KG.knowledgeGraph.requestReindex.out>> {
  const t = await visibleThread(deps, input, input.threadId);
  if (t.facts.createdBy !== input.userId) throw new KgHumanActionError("KG_NOT_OWNER");
  if (!deps.extractionConfigured) return { queued: 0 };
  const n = await deps.reindex.requeueThread(input.orgId, input.threadId, input.sourceRefs ?? null);
  if (n === "already_running") throw new KgHumanActionError("KG_REINDEX_ALREADY_RUNNING");
  return { queued: n };
}
