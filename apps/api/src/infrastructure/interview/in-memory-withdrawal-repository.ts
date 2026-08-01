/**
 * F89 —— 内存实现，供单元测试对五步撤回编排 + 级联失效做纯编排断言。
 *
 * 与 `in-memory-consent-token-repository.ts`（F86）同一立场：本 feature 涉及的
 * 受访者/片段/检索/图边/决策持久化地基尚未在这条分片里落地为 Postgres 实现，
 * 按 issue #74 的允许口径，这里只声明并实现内存版本，用于把编排逻辑本身跑通、
 * 断言顺序与副作用是否正确——不冒充这是生产可用的存储层。
 */
import type { ConsentKeyValue } from "../../application/interview/consent-token-ports";
import type {
  CascadeInvalidationStore,
  CreateWithdrawalInput,
  PendingDeletionQueue,
  ReportSegmentAnnotator,
  ReportSegmentRef,
  RetrievalExclusionPort,
  SignedDecisionRef,
  SignedDecisionReviewNotifier,
  WithdrawalDerivativeKind,
  WithdrawalDerivativeRef,
  WithdrawalRecord,
  WithdrawalRepository,
  WithdrawalSegmentLocator,
} from "../../application/interview/withdrawal-ports";

function scopesOverlap(a: readonly ConsentKeyValue[], b: readonly ConsentKeyValue[]): boolean {
  return a.some((k) => b.includes(k));
}

export class InMemoryWithdrawalRepository implements WithdrawalRepository {
  private readonly rows = new Map<string, WithdrawalRecord>();

  async findActiveForSubject(
    subjectId: string,
    scope: readonly ConsentKeyValue[],
  ): Promise<WithdrawalRecord | null> {
    for (const row of this.rows.values()) {
      if (row.subjectId !== subjectId) continue;
      if (!scopesOverlap(row.scope, scope)) continue;
      const step5 = row.steps.find((s) => s.no === 5);
      if (step5?.state !== "done") return row;
    }
    return null;
  }

  async create(input: CreateWithdrawalInput): Promise<WithdrawalRecord> {
    const record: WithdrawalRecord = { ...input, physicalDeleteCompletedAt: null, receiptId: null };
    this.rows.set(input.withdrawalId, record);
    return record;
  }

  async findById(withdrawalId: string): Promise<WithdrawalRecord | null> {
    return this.rows.get(withdrawalId) ?? null;
  }

  async markPhysicalDeleteComplete(withdrawalId: string, at: Date): Promise<WithdrawalRecord | null> {
    const row = this.rows.get(withdrawalId);
    if (!row) return null;
    const updated: WithdrawalRecord = {
      ...row,
      physicalDeleteCompletedAt: at,
      steps: row.steps.map((s) => (s.no === 5 ? { ...s, state: "done" as const } : s)),
    };
    this.rows.set(withdrawalId, updated);
    return updated;
  }

  async saveReceipt(withdrawalId: string, receiptId: string): Promise<void> {
    const row = this.rows.get(withdrawalId);
    if (!row) return;
    this.rows.set(withdrawalId, { ...row, receiptId });
  }
}

export class FixedWithdrawalSegmentLocator implements WithdrawalSegmentLocator {
  constructor(private readonly bySubject: Map<string, readonly string[]>) {}

  async segmentIdsFor(subjectId: string, _scope: readonly ConsentKeyValue[]): Promise<readonly string[]> {
    return this.bySubject.get(subjectId) ?? [];
  }
}

export class InMemoryPendingDeletionQueue implements PendingDeletionQueue {
  readonly tickets: {
    readonly withdrawalId: string;
    readonly subjectId: string;
    readonly scope: readonly ConsentKeyValue[];
    readonly segmentIds: readonly string[];
    readonly dueAt: Date;
  }[] = [];

  async enqueue(input: {
    readonly withdrawalId: string;
    readonly subjectId: string;
    readonly scope: readonly ConsentKeyValue[];
    readonly segmentIds: readonly string[];
    readonly dueAt: Date;
  }): Promise<{ readonly ticketId: string }> {
    this.tickets.push(input);
    return { ticketId: `pdq-${this.tickets.length}` };
  }
}

export class InMemoryRetrievalIndex implements RetrievalExclusionPort {
  readonly excludedSegmentIds = new Set<string>();
  readonly topicMatrixRecomputedFor: string[] = [];

  async exclude(segmentIds: readonly string[], _at: Date): Promise<void> {
    for (const id of segmentIds) this.excludedSegmentIds.add(id);
  }

  async recomputeTopicMatrixStrength(subjectId: string): Promise<void> {
    this.topicMatrixRecomputedFor.push(subjectId);
  }

  /** 测试断言用：模拟"新建 Context Pack"——被排除的片段永远不会出现在检索结果里。 */
  retrievableSegmentIds(candidateSegmentIds: readonly string[]): readonly string[] {
    return candidateSegmentIds.filter((id) => !this.excludedSegmentIds.has(id));
  }
}

interface DerivativeRow extends WithdrawalDerivativeRef {
  readonly segmentId: string;
  invalidatedAt: Date | null;
}

export class InMemoryCascadeInvalidationStore implements CascadeInvalidationStore {
  private readonly derivatives: DerivativeRow[] = [];
  private readonly soleEvidenceClaims = new Map<string, readonly string[]>();
  readonly contestedClaimIds = new Set<string>();

  seedDerivative(segmentId: string, kind: WithdrawalDerivativeKind, id: string): void {
    this.derivatives.push({ id, kind, segmentId, invalidatedAt: null });
  }

  /** 以这个 segmentId 为唯一证据的 claim id 列表——测试装配用。 */
  seedSoleEvidenceClaim(segmentId: string, claimId: string): void {
    const existing = this.soleEvidenceClaims.get(segmentId) ?? [];
    this.soleEvidenceClaims.set(segmentId, [...existing, claimId]);
  }

  async listDerivatives(segmentIds: readonly string[]): Promise<readonly WithdrawalDerivativeRef[]> {
    return this.derivatives.filter((d) => segmentIds.includes(d.segmentId));
  }

  async invalidate(derivativeIds: readonly string[], at: Date): Promise<void> {
    for (const d of this.derivatives) {
      if (derivativeIds.includes(d.id)) d.invalidatedAt = at;
    }
  }

  async listClaimsSolelyEvidencedBy(segmentIds: readonly string[]): Promise<readonly string[]> {
    const out = new Set<string>();
    for (const id of segmentIds) {
      for (const claimId of this.soleEvidenceClaims.get(id) ?? []) out.add(claimId);
    }
    return [...out];
  }

  async markClaimsContested(claimIds: readonly string[]): Promise<void> {
    for (const id of claimIds) this.contestedClaimIds.add(id);
  }

  isInvalidated(derivativeId: string): boolean {
    return this.derivatives.find((d) => d.id === derivativeId)?.invalidatedAt !== null;
  }
}

export class InMemoryReportSegmentAnnotator implements ReportSegmentAnnotator {
  private readonly refsBySegment = new Map<string, ReportSegmentRef[]>();
  readonly markedWithdrawn = new Set<string>();
  readonly pendingExternalConfirmation: string[] = [];

  seedReference(segmentId: string, ref: ReportSegmentRef): void {
    const existing = this.refsBySegment.get(segmentId) ?? [];
    this.refsBySegment.set(segmentId, [...existing, ref]);
  }

  async listReferencing(segmentIds: readonly string[]): Promise<readonly ReportSegmentRef[]> {
    const out: ReportSegmentRef[] = [];
    for (const id of segmentIds) out.push(...(this.refsBySegment.get(id) ?? []));
    return out;
  }

  async markEvidenceWithdrawn(
    segmentIds: readonly string[],
    _at: Date,
  ): Promise<readonly ReportSegmentRef[]> {
    const refs = await this.listReferencing(segmentIds);
    for (const ref of refs) this.markedWithdrawn.add(ref.id);
    return refs;
  }

  async queuePendingExternalConfirmation(refs: readonly ReportSegmentRef[]): Promise<readonly string[]> {
    const ids = refs.map((r) => r.id);
    this.pendingExternalConfirmation.push(...ids);
    return ids;
  }
}

export class InMemorySignedDecisionReviewNotifier implements SignedDecisionReviewNotifier {
  private readonly bySegment = new Map<string, SignedDecisionRef[]>();
  readonly createdReviewTasks: {
    readonly decisionId: string;
    readonly approverId: string;
    readonly withdrawalId: string;
    readonly segmentIds: readonly string[];
  }[] = [];

  seedDecision(segmentId: string, ref: SignedDecisionRef): void {
    const existing = this.bySegment.get(segmentId) ?? [];
    this.bySegment.set(segmentId, [...existing, ref]);
  }

  async findSignedDecisionsSupportedBy(segmentIds: readonly string[]): Promise<readonly SignedDecisionRef[]> {
    const seen = new Set<string>();
    const out: SignedDecisionRef[] = [];
    for (const id of segmentIds) {
      for (const ref of this.bySegment.get(id) ?? []) {
        if (seen.has(ref.decisionId)) continue;
        seen.add(ref.decisionId);
        out.push(ref);
      }
    }
    return out;
  }

  async createReviewTask(input: {
    readonly decisionId: string;
    readonly approverId: string;
    readonly withdrawalId: string;
    readonly segmentIds: readonly string[];
  }): Promise<string> {
    this.createdReviewTasks.push(input);
    return `rtask-${this.createdReviewTasks.length}`;
  }
}
