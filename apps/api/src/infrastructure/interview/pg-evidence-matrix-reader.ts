/**
 * PostgreSQL 实现 —— F02（phase-11）`getEvidenceMatrix` 读端的两个端口。
 *
 * `listConfirmedEvidence` 把 `interview_insights` 与它固化的
 * `interview_insight_source_snapshots.quotes`（jsonb 数组）展开成一行一条证据，供
 * `get-evidence-matrix.ts` 的 `projectMatrix` 分组——不重复冻结逻辑，只读它。
 *
 * `roleOf` 是 `pg-interview-subject-repository.ts` 里 `viewerContextForGroup` 读的同一张
 * `project_memberships` 表，换了 join 的起点（本读端只有 `projectId`，没有 `groupId`）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  EvidenceMatrixReader,
  EvidenceQuoteRow,
  ProjectRoleReader,
} from "../../application/interview/evidence-matrix-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";

interface EvidenceRowShape {
  interview_id: string;
  strong: boolean;
  quote_id: string;
  subject_id: string | null;
  rq_id: string | null;
}

export class PgEvidenceMatrixReader implements EvidenceMatrixReader, ProjectRoleReader {
  constructor(private readonly db: DatabasePort) {}

  async listConfirmedEvidence(
    orgId: OrgId,
    interviewIds: readonly string[],
  ): Promise<readonly Guarded<EvidenceQuoteRow>[]> {
    if (interviewIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<EvidenceRowShape>(
        `SELECT ii.interview_id,
                ii.strong,
                elem->>'quoteId'   AS quote_id,
                elem->>'subjectId' AS subject_id,
                elem->>'rqId'      AS rq_id
           FROM interview_insights ii
           JOIN interview_insight_source_snapshots s
             ON s.org_id = ii.org_id AND s.id = ii.pinned_source_snapshot_id
          CROSS JOIN LATERAL jsonb_array_elements(s.quotes) AS elem
          WHERE ii.org_id = $1 AND ii.interview_id = ANY($2::text[])`,
        [orgId, [...interviewIds]],
      );
      // `ref.kind: "interview"` —— 与 `pg-interview-scope-repository.ts` 的 `toGuarded`
      // 同一个 ACL kind，同一个理由：这张证据行的可见性绑定的是它所属那场访谈的可见性，
      // 不是一等对象自己的规则。调用方（`get-evidence-matrix.ts`）用
      // `decideInterviewVisibility` + `discloseDecided` 现判，不经通用 `authorize()`。
      return r.rows.map((row): Guarded<EvidenceQuoteRow> =>
        guard({ kind: "interview", id: row.interview_id }, {
          interviewId: row.interview_id,
          subjectId: row.subject_id,
          rqId: row.rq_id,
          quoteId: row.quote_id,
          strong: row.strong,
        }),
      );
    });
  }

  async roleOf(
    orgId: OrgId,
    userId: string,
    projectId: string,
  ): Promise<"facilitator" | "groupLead" | "member" | "observer" | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_role: string }>(
        `SELECT project_role FROM project_memberships
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3`,
        [orgId, projectId, userId],
      );
      const row = r.rows[0];
      return (row?.project_role as "facilitator" | "groupLead" | "member" | "observer" | undefined) ?? null;
    });
  }
}
