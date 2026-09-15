/**
 * 研判工作流的出站端口。
 *
 * ⚠ 每个读方法都返回 `Guarded<T>` 而不是裸行 —— `lint-permission-paths` 要求的，
 * 而且要求得对：研判会话的阶段、材料清单与审计都是租户内容，一个交出裸行的仓储
 * 会让"忘了判可见性"变成一次疏漏，而不是一个编译错误。
 * 解开它的唯一地方是 `guarded-operations.ts`，且必须先有一个可见性判定。
 *
 * 领域状态机判"成不成立"，这些端口负责"读出快照 / 写回结果 / 留下痕迹"。
 * 刻意切得很薄：仓储不许有任何判断逻辑——一旦它开始"顺手"决定某个推进合不合法，
 * 门就有了第二处定义，而第二处定义正是本项目已经栽过五次的那个形状。
 */
import type { researchWorkflow as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type ResearchSessionRow = z.infer<typeof C.ResearchSession>;
export type ResearchMaterialRow = z.infer<typeof C.ResearchMaterial>;
export type ResearchPredictionRow = z.infer<typeof C.ResearchPrediction>;

/** 一条审计：谁、做什么、从哪个阶段、结果如何。拒绝时必须带原因码。 */
export interface GateAuditEntry {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorKind: "human" | "agent";
  readonly action: string;
  readonly fromPhase: C.ResearchPhaseName;
  readonly outcome: "allowed" | "refused";
  readonly refusal: C.ResearchRefusalName | null;
}

export interface ResearchWorkflowRepository {
  /** 读会话；线程还没有会话时**建一个 empty 的**——否则每个调用方都要处理 null。 */
  ensureSession(orgId: OrgId, threadId: string): Promise<Guarded<ResearchSessionRow>>;
  addMaterials(
    orgId: OrgId,
    threadId: string,
    items: readonly { source: z.infer<typeof C.MaterialSource>; label: string }[],
  ): Promise<Guarded<ResearchSessionRow>>;
  setMaterialVerdict(
    orgId: OrgId,
    threadId: string,
    materialId: string,
    verdict: C.MaterialVerdictName,
    note: string | null,
  ): Promise<Guarded<ResearchSessionRow>>;
  /** 同一条材料被打回后重新采集，计数加一。 */
  bumpMaterialAttempts(orgId: OrgId, threadId: string, materialId: string): Promise<Guarded<ResearchSessionRow>>;
  /** 写回阶段与血缘。两者必须同一次事务——阶段进了而血缘没跟上，等于血缘是假的。 */
  applyTransition(
    orgId: OrgId,
    threadId: string,
    nextPhase: C.ResearchPhaseName,
    lineage: ResearchSessionRow["lineage"],
    verifyDueAt: string | null,
  ): Promise<Guarded<ResearchSessionRow>>;
  appendAudit(entry: GateAuditEntry): Promise<void>;
  /* ── 第三步：预测与回填 ── */
  listPredictions(orgId: OrgId, threadId: string): Promise<Guarded<readonly ResearchPredictionRow[]>>;
  addPredictions(
    orgId: OrgId,
    threadId: string,
    graphVersion: number,
    statements: readonly string[],
  ): Promise<Guarded<readonly ResearchPredictionRow[]>>;
  fillPrediction(
    orgId: OrgId,
    threadId: string,
    predictionId: string,
    actual: string,
    verdict: C.PredictionVerdictName,
    rootCause: C.RootCauseName | null,
  ): Promise<Guarded<readonly ResearchPredictionRow[]>>;
  listAudit(orgId: OrgId, threadId: string, limit: number): Promise<Guarded<readonly (GateAuditEntry & { createdAt: string })[]>>;
}

/** 批次 id 由调用方注入，领域层不生成——纯函数不许碰随机数。 */
export interface UuidFactory {
  next(): string;
}

/** DI token。 */
export const RESEARCH_WORKFLOW_REPOSITORY = Symbol("RESEARCH_WORKFLOW_REPOSITORY");
