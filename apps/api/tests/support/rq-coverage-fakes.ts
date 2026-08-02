/**
 * F92 —— `RqCoverageRepository` 的内存实现，供不连 Postgres 的纯测试使用（issue #74）。
 *
 * ⚠ 种子数据默认 5 个 RQ、`value` 恒 `null`（尚未打过状态）——与 `OutlineSectionRecord`
 *   同一立场：`null` 不等同于 `uncovered`，那是人工确认过的一个值，`null` 是「还没人写」。
 */
import type {
  RqCoverageDraft,
  RqCoverageRecord,
  RqCoverageValueName,
} from "../../src/domain/interview/rq-coverage";
import type { RqCoverageRepository } from "../../src/application/interview/rq-coverage-ports";
import type { OrgId } from "../../src/domain/org-id";

interface Row extends RqCoverageDraft {
  value: RqCoverageValueName | null;
}

export class InMemoryRqCoverageRepository implements RqCoverageRepository {
  private readonly byInterviewId = new Map<string, Row[]>();

  seed(interviewId: string, drafts: readonly RqCoverageDraft[]): void {
    this.byInterviewId.set(
      interviewId,
      drafts.map((d) => ({ ...d, value: null })),
    );
  }

  async listByInterview(_orgId: OrgId, interviewId: string): Promise<readonly RqCoverageRecord[]> {
    return (this.byInterviewId.get(interviewId) ?? []).map((r) => ({ ...r }));
  }

  async setValue(
    _orgId: OrgId,
    interviewId: string,
    rqId: string,
    value: RqCoverageValueName,
  ): Promise<RqCoverageRecord> {
    const rows = this.byInterviewId.get(interviewId);
    if (rows === undefined) {
      throw new Error(`interview ${interviewId} has no seeded RQ list`);
    }
    const row = rows.find((r) => r.rqId === rqId);
    if (row === undefined) {
      throw new Error(`rq ${rqId} not found for interview ${interviewId}`);
    }
    row.value = value;
    return { ...row };
  }
}
