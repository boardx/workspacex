/**
 * PostgreSQL 实现 —— `interview_consent_submissions`（F97 的最小落地，供 F87 之后扩展）。
 *
 * append-only（I-16）：`submit` 只 INSERT，永不 UPDATE/DELETE；migration 的 GRANT
 * 也只给了 INSERT，是同一条规则的第二次表达（数据库层）。「当前状态」＝
 * `submitted_at` 最大的一行，`latestFor` 的 `ORDER BY ... DESC LIMIT 1` 是这条规则
 * 唯一的实现——两处投影都调这一个方法，不会有第二种"取最新"的算法。
 *
 * ⚠ `latestFor` 经 `guard()` 出门，`ref.kind` 恒为 `"subject"`（同一个 subjectId）——
 * 同意位是该访谈对象记录的一个敏感facet，不单独发明一套可见性规则；调用方复用
 * 判定该对象本身可见性时算出的同一个 `PermissionDecision` 来解封（见
 * `subject-ports.ts` 的 `ConsentSubmissionStore.latestFor` 注释）。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ConsentBits } from "../../domain/interview/subject";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { ConsentSubmissionStore } from "../../application/interview/subject-ports";

interface ConsentRowShape {
  record: boolean;
  transcript: boolean;
  ai_analysis: boolean;
  attribution: boolean;
}

interface ConsentRowWithMetaShape extends ConsentRowShape {
  submitted_at: Date;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export class PgConsentSubmissionStore implements ConsentSubmissionStore {
  constructor(private readonly db: DatabasePort) {}

  async latestFor(
    orgId: OrgId,
    interviewSessionId: string,
    subjectId: string,
  ): Promise<Guarded<ConsentBits | null>> {
    const bits = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ConsentRowShape>(
        `SELECT record, transcript, ai_analysis, attribution
           FROM interview_consent_submissions
          WHERE org_id = $1 AND interview_session_id = $2 AND subject_id = $3
          ORDER BY submitted_at DESC
          LIMIT 1`,
        [orgId, interviewSessionId, subjectId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        record: row.record,
        transcript: row.transcript,
        ai_analysis: row.ai_analysis,
        attribution: row.attribution,
      };
    });
    return guard({ kind: "subject", id: subjectId }, bits);
  }

  async latestSubmissionMeta(
    orgId: OrgId,
    interviewSessionId: string,
    subjectId: string,
  ): Promise<Guarded<{ readonly bits: ConsentBits; readonly submittedAt: Date } | null>> {
    const meta = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ConsentRowWithMetaShape>(
        `SELECT record, transcript, ai_analysis, attribution, submitted_at
           FROM interview_consent_submissions
          WHERE org_id = $1 AND interview_session_id = $2 AND subject_id = $3
          ORDER BY submitted_at DESC
          LIMIT 1`,
        [orgId, interviewSessionId, subjectId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        bits: {
          record: row.record,
          transcript: row.transcript,
          ai_analysis: row.ai_analysis,
          attribution: row.attribution,
        },
        submittedAt: row.submitted_at,
      };
    });
    return guard({ kind: "subject", id: subjectId }, meta);
  }

  async submit(orgId: OrgId, interviewSessionId: string, subjectId: string, bits: ConsentBits): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_consent_submissions
           (id, org_id, interview_session_id, subject_id, record, transcript, ai_analysis, attribution)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          nextId("consent"),
          orgId,
          interviewSessionId,
          subjectId,
          bits.record,
          bits.transcript,
          bits.ai_analysis,
          bits.attribution,
        ],
      );
    });
  }
}
