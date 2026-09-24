/**
 * Phase 18 F16 —— 入图之后判矛盾（uc-18-6 D1–D2 / uc-18-1 A3）。
 *
 * 接在抽取（F06）的同一个任务里、交执行器之后：队列行在这之后才删，所以回答下的「正在记…」
 * 结束时，这一轮该出的矛盾卡已经在了（getTurnMemory 同一次读到）。任务重试时再跑一遍也无害：
 * 已经配过对的新条不再是「没人看过」，数据库复核会跳过。
 *
 * 候选取数与复核在数据库，判定在 domain（纯函数，可测）；这里只把三步串起来。
 */
import type { OrgId } from "../../domain/org-id";
import { findConflicts } from "../../domain/knowledge-graph/conflict";
import type { KgConflictPort } from "./ports";

export interface ConflictDetectionDeps {
  readonly conflicts: KgConflictPort;
  readonly newId: (prefix: "act") => string;
}

/** 返回这条消息开了几张矛盾提醒。 */
export async function detectConflicts(
  deps: ConflictDetectionDeps,
  job: { readonly orgId: OrgId; readonly threadId: string; readonly messageId: string },
): Promise<number> {
  const { fresh, confirmed } = await deps.conflicts.candidates(job.orgId, job.threadId, job.messageId);
  if (fresh.length === 0 || confirmed.length === 0) return 0;
  const pairs = findConflicts(fresh, confirmed);
  if (pairs.length === 0) return 0;
  return deps.conflicts.open(job.orgId, {
    actionId: deps.newId("act"), threadId: job.threadId, messageId: job.messageId, pairs,
  });
}
