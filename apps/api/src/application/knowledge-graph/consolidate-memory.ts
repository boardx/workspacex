/**
 * Phase 18 S8（#4365）—— 个人空间的记忆整合：取候选 → 纯函数出计划（domain/knowledge-graph/consolidation.ts）→
 * 数据库函数在锁下复核后落表（迁移 20260928180000）→ 逐对开冲突卡（不裁决）→ 收尾。以及本人的整合记录与撤销。
 *
 * 开关：部署级 `kg_consolidation_state`，**默认关**——人类说开之前不跑（#4365 协调约定）。定时 worker 与平台的
 * 「现在整合一次」走同一个 `runConsolidationPass`，关着都不跑。
 * 失败隔离：一个人整合失败只记日志、计数，不影响别人；一次运行里合并已经落下而开卡失败，运行照样收尾（已落下的仍可撤销）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import { CONSOLIDATION_MAX_CLAIMS, planConsolidation } from "../../domain/knowledge-graph/consolidation";
import type { OrgId } from "../../domain/org-id";
import type { LoggerPort } from "../ports/logger.port";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { decidePersonalSpace } from "./read-personal-knowledge";
import type { KnowledgeReadDeps } from "./read-thread-knowledge";
import { KgConsolidationError, type KgConsolidationPort, type KgConsolidationRunView } from "./s8-ports";

/** 每一轮最多整合几个人：整合是后台任务，一轮不该占住太久。 */
export const CONSOLIDATION_USERS_PER_PASS = 20;

export interface ConsolidationDeps {
  readonly consolidation: KgConsolidationPort;
  readonly logger: LoggerPort;
  readonly newRunId: () => string;
}

export interface UserConsolidationResult {
  readonly runId: string;
  readonly claimMerges: number;
  readonly entityMerges: number;
  readonly conflicts: number;
  readonly conflictsUnsurfaced: number;
}

export async function consolidateUser(
  deps: ConsolidationDeps, target: { readonly orgId: OrgId; readonly userId: string },
): Promise<UserConsolidationResult> {
  const { orgId, userId } = target;
  const cand = await deps.consolidation.candidates(orgId, userId, CONSOLIDATION_MAX_CLAIMS);
  const plan = planConsolidation(cand);
  const runId = deps.newRunId();
  await deps.consolidation.begin(orgId, userId, runId);
  let conflicts = 0;
  let conflictsUnsurfaced = 0;
  let merged = { claimMerges: 0, entityMerges: 0 };
  try {
    if (plan.claimMerges.length > 0 || plan.entityMerges.length > 0) {
      merged = await deps.consolidation.applyMerges(orgId, userId, runId, plan);
    }
    // 矛盾：一对一个事务（会话锁 → 个人空间锁，与 F16 同一顺序）。被合掉的那条不在计划里（纯函数已排除）。
    for (const pair of plan.conflicts) {
      const outcome = await deps.consolidation.openConflict(orgId, userId, runId, pair);
      if (outcome === "opened") conflicts += 1;
      else if (outcome === "unsurfaced") conflictsUnsurfaced += 1;
    }
  } finally {
    await deps.consolidation.finish(orgId, userId, runId);
  }
  const result = { runId, ...merged, conflicts, conflictsUnsurfaced };
  deps.logger.info("kg consolidation run", {
    traceId: "kg-consolidation", orgId, runId, planned: {
      claimMerges: plan.claimMerges.length, entityMerges: plan.entityMerges.length, conflicts: plan.conflicts.length,
    }, ...merged, conflicts, conflictsUnsurfaced,
  });
  return result;
}

export type ConsolidationPassResult = z.infer<typeof KG.KgConsolidationPassResult>;

/** 一轮：开关关着 ⇒ `KG_CONSOLIDATION_DISABLED`；否则对有新东西的人逐个整合（一个失败不影响别人）。 */
export async function runConsolidationPass(deps: ConsolidationDeps, limit = CONSOLIDATION_USERS_PER_PASS): Promise<ConsolidationPassResult> {
  if (!(await deps.consolidation.getEnabled())) throw new KgConsolidationError("KG_CONSOLIDATION_DISABLED");
  const out = { users: 0, claimMerges: 0, entityMerges: 0, conflicts: 0, conflictsUnsurfaced: 0, failedUsers: 0 };
  for (const target of await deps.consolidation.pendingUsers(limit)) {
    out.users += 1;
    try {
      const r = await consolidateUser(deps, target);
      out.claimMerges += r.claimMerges;
      out.entityMerges += r.entityMerges;
      out.conflicts += r.conflicts;
      out.conflictsUnsurfaced += r.conflictsUnsurfaced;
    } catch (err) {
      out.failedUsers += 1;
      deps.logger.error("kg consolidation failed for a user", { traceId: "kg-consolidation", orgId: target.orgId, err });
    }
  }
  return out;
}

interface Viewer { readonly userId: string; readonly orgId: OrgId }

/** 本人的整合记录：与个人空间读口同一个判定（组织成员 + 查看者就是空间主人），不过 ⇒ KG_NOT_VISIBLE。 */
export async function listMyConsolidationRuns(
  deps: KnowledgeReadDeps & { readonly consolidation: KgConsolidationPort }, viewer: Viewer, limit: number, runId?: string,
): Promise<readonly KgConsolidationRunView[]> {
  const guarded = await deps.consolidation.listRuns(viewer.orgId, viewer.userId, limit, runId);
  const d = discloseDecided(guarded, await decidePersonalSpace(deps, viewer, guarded));
  if (!isDisclosed(d)) throw new KgConsolidationError("KG_NOT_VISIBLE");
  return d.payload;
}

/** 本人撤销一次整合；返回撤销后的那次运行（逐处的 undone / undo_skipped + 原因）。 */
export async function undoMyConsolidationRun(
  deps: KnowledgeReadDeps & { readonly consolidation: KgConsolidationPort; readonly newActionId: () => string },
  viewer: Viewer, runId: string,
): Promise<KgConsolidationRunView> {
  // 先过同一道「本人空间」判定：已不是组织成员的人不能动自己原来空间里的东西（同读口）。
  await listMyConsolidationRuns(deps, viewer, 0);
  await deps.consolidation.undo(viewer.orgId, viewer.userId, runId, deps.newActionId());
  // #4491 L3：按 id 读回这一次（不受列表条数上限影响——撤销一次很早的整理，读回时它可能已不在最近 N 条里）。
  const run = (await listMyConsolidationRuns(deps, viewer, 1, runId)).find((r) => r.runId === runId);
  if (run === undefined) throw new KgConsolidationError("KG_CONSOLIDATION_RUN_NOT_FOUND");
  return run;
}
