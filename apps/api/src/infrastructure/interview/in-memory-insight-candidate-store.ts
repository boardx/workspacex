/**
 * 进程内候选态存储（F01）——同 `in-memory-candidate-store.ts`（F98 人选候选）一样的立场：
 * 候选不入库，短生命周期，进程重启丢失可接受（契约头注「候选不直接入库」）。
 */
import type { OrgId } from "../../domain/org-id";
import type { InsightCandidate, InsightCandidateStore } from "../../application/interview/insight-ports";

export class InMemoryInsightCandidateStore implements InsightCandidateStore {
  private readonly byKey = new Map<string, InsightCandidate>();

  private key(orgId: OrgId, candidateId: string): string {
    return `${orgId}::${candidateId}`;
  }

  async put(candidate: InsightCandidate): Promise<void> {
    this.byKey.set(this.key(candidate.orgId, candidate.candidateId), candidate);
  }

  async get(orgId: OrgId, candidateId: string): Promise<InsightCandidate | null> {
    return this.byKey.get(this.key(orgId, candidateId)) ?? null;
  }

  async remove(orgId: OrgId, candidateId: string): Promise<void> {
    this.byKey.delete(this.key(orgId, candidateId));
  }
}
