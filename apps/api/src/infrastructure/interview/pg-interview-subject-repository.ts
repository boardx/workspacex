/**
 * PostgreSQL 实现 —— `interview_subjects` + `interview_session_subjects`（F97）。
 *
 * ⚠ 两个 list 方法查的是**同一张表**，只是 WHERE 子句不同：`listByGroup` 按
 * `group_id`，`listByInterviewSession` 经 `interview_session_subjects` 关联查。
 * 这就是「两处投影一致」在 SQL 层面的样子——它不是靠应用层小心地保持两份数据同步，
 * 是压根只有一份数据、两条取数路径。
 *
 * ⚠ 联系方式的"加密"在这里只是一个占位实现（明文原样写进 `contact_cipher`）：
 * 真正的加密算法与密钥管理不是 F97 的范围（O-39 的完整落地含轮换、只读授权取明文
 * 等，见 F98 的范围）。本仓储只负责「明文不会被这个方法原样返回」这一条——
 * `toRecord` 只映射 `contact_mask`，从不读取 `contact_cipher` 到返回值里。
 *
 * ⚠ 读方法一律经 `guard()` 出门（R5：观察者不可读对象表），`create`/`update`
 * 只回显调用者自己刚写的行，理由见 `subject-ports.ts` 文件头。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { SubjectMode, SubjectRecord } from "../../domain/interview/subject";
import { guard } from "../../application/security/permission-filter";
import type {
  CreateSubjectInput,
  GuardedSubjectRow,
  SubjectRepository,
  UpdateSubjectInput,
} from "../../application/interview/subject-ports";

/** 掩码规则：只留最后 4 位可见，其余以 `*` 替换。无联系方式则整体为 `null`。 */
function maskContact(contact: string | null): string | null {
  if (contact === null || contact.length === 0) return null;
  if (contact.length <= 4) return "*".repeat(contact.length);
  return "*".repeat(contact.length - 4) + contact.slice(-4);
}

interface SubjectRowShape {
  id: string;
  group_id: string | null;
  display_name: string;
  role_title: string;
  org_name: string | null;
  background_and_questions: string;
  mode: string;
  source_kind: string;
  contact_mask: string | null;
  created_by: string;
  created_at: Date;
}

const toRecord = (r: SubjectRowShape): SubjectRecord => ({
  subjectId: r.id,
  groupId: r.group_id,
  displayName: r.display_name,
  roleTitle: r.role_title,
  orgName: r.org_name,
  backgroundAndQuestions: r.background_and_questions,
  mode: r.mode as SubjectMode,
  sourceKind: r.source_kind as "human" | "virtual",
  contactMask: r.contact_mask,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
});

/** 包成 `Guarded<T>`：从这里开始，载荷只能经 `discloseDecided` 取出（同 F80 手法）。 */
const toGuarded = (r: SubjectRowShape): GuardedSubjectRow => ({
  item: guard({ kind: "subject", id: r.id }, toRecord(r)),
  facts: { groupId: r.group_id, createdBy: r.created_by },
});

const SELECT_COLUMNS = `
  id, group_id, display_name, role_title, org_name, background_and_questions,
  mode, source_kind, contact_mask, created_by, created_at`;

/** 与本仓其它仓储同一手法（见 `infrastructure/artifact/uuid-id-factory.ts`）：随机 id，不靠时间戳+计数器——
 * 后者在多个 vitest worker 并行、各自持有独立模块状态时会跨进程撞号（同一毫秒、同一计数值）。 */
function nextId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export class PgInterviewSubjectRepository implements SubjectRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateSubjectInput): Promise<SubjectRecord> {
    return this.db.withTenant(input.orgId, async (s) => {
      const id = nextId("subj");
      const r = await s.query<SubjectRowShape>(
        `INSERT INTO interview_subjects
           (id, org_id, group_id, display_name, role_title, org_name,
            background_and_questions, mode, source_kind, contact_cipher, contact_mask, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          input.orgId,
          input.groupId,
          input.displayName,
          input.roleTitle,
          input.orgName,
          input.backgroundAndQuestions ?? "",
          input.mode ?? "interview",
          input.sourceKind,
          input.contact, // 占位：真正的加密算法属 F98 范围，见文件头。
          maskContact(input.contact),
          input.createdBy,
        ],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error("createSubject: insert returned no row");
      return toRecord(row);
    });
  }

  async update(input: UpdateSubjectInput): Promise<SubjectRecord> {
    return this.db.withTenant(input.orgId, async (s) => {
      // `COALESCE` 落地「null = 不改这一列」（displayName/roleTitle 恒非空列，
      // 契约也没给它们提供清空语义）；`orgName`/`groupId` 契约本就允许写 null 来清空，
      // 所以它们不经 COALESCE，直接赋值。
      const r = await s.query<SubjectRowShape>(
        `UPDATE interview_subjects SET
           display_name = COALESCE($3, display_name),
           role_title   = COALESCE($4, role_title),
           org_name     = $5,
           group_id     = $6,
           contact_cipher = COALESCE($7, contact_cipher),
           contact_mask   = COALESCE($8, contact_mask),
           updated_at   = now()
         WHERE org_id = $1 AND id = $2
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.orgId,
          input.subjectId,
          input.displayName,
          input.roleTitle,
          input.orgName,
          input.groupId,
          input.contact,
          input.contact === null ? null : maskContact(input.contact),
        ],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`updateSubject: no such subject ${input.subjectId}`);
      return toRecord(row);
    });
  }

  async findGuardedById(orgId: OrgId, subjectId: string): Promise<GuardedSubjectRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<SubjectRowShape>(
        `SELECT ${SELECT_COLUMNS} FROM interview_subjects WHERE org_id = $1 AND id = $2`,
        [orgId, subjectId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toGuarded(row);
    });
  }

  async listByGroup(orgId: OrgId, groupId: string): Promise<GuardedSubjectRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<SubjectRowShape>(
        `SELECT ${SELECT_COLUMNS} FROM interview_subjects
          WHERE org_id = $1 AND group_id = $2
          ORDER BY created_at ASC, id ASC`,
        [orgId, groupId],
      );
      return r.rows.map(toGuarded);
    });
  }

  async listByInterviewSession(orgId: OrgId, interviewSessionId: string): Promise<GuardedSubjectRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<SubjectRowShape>(
        `SELECT ${SELECT_COLUMNS.split(",").map((c) => `su.${c.trim()}`).join(", ")}
           FROM interview_subjects su
           JOIN interview_session_subjects iss
             ON iss.subject_id = su.id AND iss.org_id = su.org_id
          WHERE su.org_id = $1 AND iss.interview_session_id = $2
          ORDER BY iss.added_at ASC, su.id ASC`,
        [orgId, interviewSessionId],
      );
      return r.rows.map(toGuarded);
    });
  }

  async attachToSession(
    orgId: OrgId,
    interviewSessionId: string,
    subjectId: string,
    addedBy: string,
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_session_subjects (interview_session_id, subject_id, org_id, added_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (interview_session_id, subject_id) DO NOTHING`,
        [interviewSessionId, subjectId, orgId, addedBy],
      );
    });
  }

  async viewerContextForGroup(
    orgId: OrgId,
    userId: string,
    groupId: string,
  ): Promise<{
    orgRole: string | null;
    teamId: string | null;
    projectRole: "facilitator" | "groupLead" | "member" | "observer" | null;
  }> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ org_role: string | null; team_id: string | null; project_role: string | null }>(
        `SELECT om.org_role, om.team_id, pm.project_role
           FROM groups g
           LEFT JOIN org_memberships om ON om.org_id = g.org_id AND om.user_id = $2
           LEFT JOIN project_memberships pm
             ON pm.org_id = g.org_id AND pm.project_id = g.project_id AND pm.user_id = $2
          WHERE g.org_id = $1 AND g.id = $3`,
        [orgId, userId, groupId],
      );
      const row = r.rows[0];
      return {
        orgRole: row?.org_role ?? null,
        teamId: row?.team_id ?? null,
        projectRole: (row?.project_role as "facilitator" | "groupLead" | "member" | "observer" | null) ?? null,
      };
    });
  }

  async orgMembershipOf(orgId: OrgId, userId: string): Promise<{ orgRole: string | null; teamId: string | null }> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ org_role: string; team_id: string | null }>(
        `SELECT org_role, team_id FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      const row = r.rows[0];
      return { orgRole: row?.org_role ?? null, teamId: row?.team_id ?? null };
    });
  }
}
