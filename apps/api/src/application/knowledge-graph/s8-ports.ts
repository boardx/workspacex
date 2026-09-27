/**
 * Phase 18 S8（#4365）的端口：记忆整合（去重 / 实体合一 / 矛盾开卡 + 撤销）与抽取 SLO 的数据库现数。
 * 单独一个文件而不是塞进 ports.ts：同一轮里别的 worker 也在改 ports.ts，端口按轮次分文件，合并时不打架。
 * 实现都在 infrastructure/knowledge-graph/（只调迁移 20260927400000 的 kg_* 函数，不点表名）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type {
  ClaimMergePlan, ConsolidationClaim, ConsolidationObject, EntityMergePlan, SimilarClaimPair,
} from "../../domain/knowledge-graph/consolidation";
import type { Guarded } from "../security/permission-filter";

// ─────────────────────────────── 抽取 SLO ───────────────────────────────

export interface KgExtractionQueueCounts {
  /** 租约过期仍未完成的行（worker 卡死 / 崩溃的信号）。 */
  readonly stuckLeases: number;
  /** 用完重试次数、不再自动处理的行。 */
  readonly deadLetters: number;
  /** 还会被处理的待处理行。 */
  readonly backlog: number;
  /** 最老一条待处理行等了多少秒（没有 ⇒ 0）。 */
  readonly oldestPendingSeconds: number;
}

/** 全库现数，只有数字（`kg_extraction_slo_counts`）。 */
export interface KgExtractionSloCountsPort {
  counts(): Promise<KgExtractionQueueCounts>;
}
export const KG_EXTRACTION_SLO_COUNTS_PORT = Symbol("KgExtractionSloCountsPort");
export const KG_EXTRACTION_SLO_THRESHOLDS = Symbol("KgExtractionSloThresholds");
/** 可选的便宜模型门控（`WorthinessModelPort`）；没开 ⇒ 注入 null。 */
export const KG_EXTRACTION_GATE_MODEL = Symbol("KgExtractionGateModel");

// ─────────────────────────────── 整合 ───────────────────────────────

export interface KgConsolidationCandidates {
  readonly claims: readonly ConsolidationClaim[];
  readonly objects: readonly ConsolidationObject[];
  readonly similar: readonly SimilarClaimPair[];
}

export type KgConsolidationRunView = z.infer<typeof KG.KgConsolidationRun>;

/**
 * 写侧（系统，以本人身份声明 app.current_user_id）：取候选 → 开运行 → 落合并 → 逐对开卡 → 收尾。
 * 每个方法都在数据库里再判一次「个人空间 = 声明的本人」。
 */
export interface KgConsolidationPort {
  /** 部署开关（`kg_consolidation_state`）。 */
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  /** 有东西可整合的用户（只有 id）。 */
  pendingUsers(limit: number): Promise<readonly { readonly orgId: OrgId; readonly userId: string }[]>;
  candidates(orgId: OrgId, userId: string, limit: number): Promise<KgConsolidationCandidates>;
  begin(orgId: OrgId, userId: string, runId: string): Promise<void>;
  applyMerges(orgId: OrgId, userId: string, runId: string, plan: {
    readonly entityMerges: readonly EntityMergePlan[];
    readonly claimMerges: readonly ClaimMergePlan[];
  }): Promise<{ readonly claimMerges: number; readonly entityMerges: number }>;
  openConflict(orgId: OrgId, userId: string, runId: string, pair: { readonly newerId: string; readonly olderId: string }):
    Promise<"opened" | "unsurfaced" | "skipped">;
  /** 返回这次运行是否有改动。 */
  finish(orgId: OrgId, userId: string, runId: string): Promise<boolean>;
  /** 读侧（本人）：最近的有改动的运行。 */
  listRuns(orgId: OrgId, userId: string, limit: number): Promise<Guarded<readonly KgConsolidationRunView[]>>;
  /** 本人撤销一次运行。运行不存在 / 不是本人的 / 已撤销 ⇒ `KgConsolidationError("KG_CONSOLIDATION_RUN_NOT_FOUND")`。 */
  undo(orgId: OrgId, userId: string, runId: string, actionId: string): Promise<{ readonly undone: number; readonly skipped: number }>;
}
export const KG_CONSOLIDATION_PORT = Symbol("KgConsolidationPort");

export class KgConsolidationError extends Error {
  constructor(readonly code: "KG_CONSOLIDATION_RUN_NOT_FOUND" | "KG_CONSOLIDATION_DISABLED" | "KG_NOT_VISIBLE" | "KG_ACTOR_NOT_HUMAN") {
    super(code);
    this.name = "KgConsolidationError";
  }
}
