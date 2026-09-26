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
import { findSupersedes } from "../../domain/knowledge-graph/decision-supersede";
import type { LoggerPort } from "../ports/logger.port";
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

/**
 * Issue #4290 —— 明确改口的取代，接在判矛盾之后、同一个抽取任务里（迁移 20260926140000）。
 *
 * 顺序有意放在 F16 之后：F16 刚开了卡的新条已经是「有矛盾」，不再是「没人看过」的候选，这里自然跳过——
 * 同一对不会既弹矛盾卡、又被自动取代；F16 管不到的（例如 211 → 985 这种换了对象的改口）才轮到这里。
 * 任务重试时再跑一遍无害：同一条新决定只取代一次（数据库按 newer_claim_id 去重），撤销过的也不会再被取代。
 * 返回开了几张取代提示。
 */
export async function detectSupersedes(
  deps: ConflictDetectionDeps,
  job: { readonly orgId: OrgId; readonly threadId: string; readonly messageId: string },
): Promise<number> {
  const { fresh, live } = await deps.conflicts.supersedeCandidates(job.orgId, job.threadId, job.messageId);
  if (fresh.length === 0 || live.length === 0) return 0;
  const pairs = findSupersedes(fresh, live);
  if (pairs.length === 0) return 0;
  const byNewer = new Map<string, string[]>();
  for (const p of pairs) byNewer.set(p.newerClaimId, [...(byNewer.get(p.newerClaimId) ?? []), p.olderClaimId]);
  return deps.conflicts.applySupersedes(job.orgId, {
    actionId: deps.newId("act"), threadId: job.threadId, messageId: job.messageId,
    supersedes: [...byNewer].map(([newer, olders]) => ({ newer, olders })),
  });
}

/** 每个 org 每轮最多排空的卡数：一张一个事务，量大时分几轮，别让一个 org 占住 worker。 */
export const KG_CONFLICT_CLOSE_BATCH = 20;

/**
 * 排空「结束冲突」的待办（迁移 20260924290000 kg_conflict_close_queue）：结论在别处被改掉、而触发器当时拿不到锁
 * （为了不死锁，它从不等锁）的卡，在这里按正常锁顺序结束，另一条放回可确认。可重复执行。
 * 一个 org 失败不影响别的 org；返回本轮处理的卡数。
 */
export async function drainConflictCloses(
  deps: { readonly conflicts: KgConflictPort; readonly logger: LoggerPort },
): Promise<number> {
  let processed = 0;
  for (const orgId of await deps.conflicts.pendingCloseOrgs()) {
    try {
      for (let i = 0; i < KG_CONFLICT_CLOSE_BATCH && (await deps.conflicts.drainCloseOne(orgId)); i += 1) processed += 1;
    } catch (err) {
      deps.logger.error("kg conflict close drain failed", { traceId: "kg-conflict-close", orgId, err });
    }
  }
  return processed;
}
