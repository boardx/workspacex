/**
 * `InterviewSubjectsRepository` 的 PostgreSQL 实现（F960，2026-08-17 delta）。
 *
 * 表：`project_group_interview_subjects`（表 F960 迁移头注解释了为什么不叫
 * `interview_subjects`——那个名字已经被 06-itv 束的真实访谈领域实体占了）+
 * `project_group_interview_subjects_revision`（按 `group_id` 维度的整批乐观锁，
 * 同 `project_grouping_revision` 的形状）。
 *
 * ## 并发：`pg_advisory_xact_lock` 而不是只靠 `FOR UPDATE`
 *
 * `expectedRevision = "0"` 代表「这一组还没人填过」——此时 revision 表还没有那一行，
 * `SELECT ... FOR UPDATE` 锁不住一行不存在的行，两个并发的「首次填写」都会读到
 * `currentRevision = "0"`、都以为自己能通过 CAS。用事务级 advisory lock 按
 * `(group_id)` 序列化整个「读 revision → 判等 → 写」区间，把「行还不存在」这个
 * 特例也覆盂进去——同 `project_tags_limit` 触发器「数据库是最终防线，不只信一次
 * 应用层判断」的纪律，这里的形态是「锁」而不是「触发器」，因为要保护的是
 * 一整段读-判-写，不是单条 INSERT。
 *
 * ## 整体替换，不逐条 diff
 *
 * 同 `pg-project-tags-repository.ts`：一个事务内 `DELETE` 旧集合 + `INSERT` 新集合。
 * `updateInterviewSubjects` 契约传的是整个 `subjects` 数组，不是「改第几行」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { InterviewSubjectRow } from "../../domain/templates/interview-subject";
import {
  InterviewSubjectsRevisionConflictError,
  type GetInterviewSubjectsResult,
  type InterviewSubjectsRepository,
  type UpdateInterviewSubjectsCommand,
  type UpdatedInterviewSubjects,
} from "../../application/templates/interview-subjects-ports";

interface SubjectRow {
  subject_id: string;
  name: string;
  role: string;
  contact: string;
  focus: string;
  method: string;
  status: string;
}

function toRow(r: SubjectRow): InterviewSubjectRow {
  return {
    subjectId: r.subject_id,
    name: r.name,
    role: r.role,
    contact: r.contact,
    focus: r.focus,
    method: r.method,
    status: r.status,
  };
}

export class PgInterviewSubjectsRepository implements InterviewSubjectsRepository {
  constructor(private readonly db: DatabasePort) {}

  async updateSubjects(cmd: UpdateInterviewSubjectsCommand): Promise<UpdatedInterviewSubjects> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      // 序列化同一个 group 的并发写（见文件头注：FOR UPDATE 锁不住不存在的行）。
      await s.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `interview-subjects:${cmd.groupId}`,
      ]);

      const revRes = await s.query<{ revision: string }>(
        `SELECT revision FROM project_group_interview_subjects_revision WHERE group_id = $1`,
        [cmd.groupId],
      );
      const currentRevision = revRes.rows[0]?.revision ?? "0";
      if (currentRevision !== cmd.expectedRevision) {
        throw new InterviewSubjectsRevisionConflictError();
      }
      const nextRevision = String((Number(currentRevision) || 0) + 1);

      await s.query(
        `INSERT INTO project_group_interview_subjects_revision (group_id, project_id, org_id, revision)
           VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id) DO UPDATE
           SET revision = EXCLUDED.revision, updated_at = now()`,
        [cmd.groupId, cmd.projectId, cmd.orgId, nextRevision],
      );

      await s.query(`DELETE FROM project_group_interview_subjects WHERE group_id = $1`, [cmd.groupId]);

      if (cmd.subjects.length > 0) {
        const cols =
          "(subject_id, project_id, org_id, group_id, position, name, role, contact, focus, method, status)";
        const rows: string[] = [];
        const params: unknown[] = [];
        cmd.subjects.forEach((subject, i) => {
          const p = params.length;
          rows.push(
            `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11})`,
          );
          params.push(
            subject.subjectId,
            cmd.projectId,
            cmd.orgId,
            cmd.groupId,
            i,
            subject.name,
            subject.role,
            subject.contact,
            subject.focus,
            subject.method,
            subject.status,
          );
        });
        await s.query(
          `INSERT INTO project_group_interview_subjects ${cols} VALUES ${rows.join(", ")}`,
          params,
        );
      }

      return { subjects: cmd.subjects, revision: nextRevision };
    });
  }

  async getSubjects(orgId: OrgId, projectId: string, groupId: string): Promise<GetInterviewSubjectsResult> {
    void projectId;
    return this.db.withTenant(orgId, async (s) => {
      const revRes = await s.query<{ revision: string }>(
        `SELECT revision FROM project_group_interview_subjects_revision WHERE group_id = $1`,
        [groupId],
      );
      const revision = revRes.rows[0]?.revision ?? "0";

      const rowsRes = await s.query<SubjectRow>(
        `SELECT subject_id, name, role, contact, focus, method, status
           FROM project_group_interview_subjects
          WHERE group_id = $1
          ORDER BY position ASC`,
        [groupId],
      );

      return { subjects: rowsRes.rows.map(toRow), revision };
    });
  }
}
