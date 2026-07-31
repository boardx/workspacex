/**
 * PostgreSQL 实现 —— **「固定快照」在这一个文件里变成一次具体的 JOIN**。
 *
 * ## `SNAPSHOT_JOIN` 是一个导出的常量，理由与 F80 的 `VISIBILITY_PREDICATE` 一样
 *
 * 为了让「把读快照改成读当前值」是一个**可执行的动作**：把下面那句
 *
 *     JOIN artifact_versions v ON v.id = a.pinned_version_id
 *
 * 换成「取该 artifact 的 head」
 *
 *     JOIN artifact_versions v ON v.artifact_id = (…) ORDER BY version_number DESC LIMIT 1
 *
 * 再跑 `mount-to-segment-snapshot.test.ts`，它必须当场红。
 * 反证做不出来的门控就是空转的门控 —— 本仓已经栽过九次。
 *
 * 三处读（attach 回执 / find / listActive）共用同一个 JOIN，也是为了不让它们各写一份：
 * 「挂的时候记对了、后来读的是 head」是这类 bug 最常见的形态，
 * 因为后来那条读路径通常只有一个「查到就返回」的 happy path。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AttachInput,
  AttachmentRecord,
  GuardedAttachment,
  InterviewAttachmentRepository,
} from "../../application/interview/attachment-ports";
import { guard } from "../../application/security/permission-filter";
import type { CitationAnchor } from "../../domain/artifact/downstream-eligibility";
import type { BindingModeName } from "../../domain/artifact/binding-modes";
import type { OrgId } from "../../domain/org-id";

/**
 * ⚠ **本 feature 的「固定快照」就是这一句。**
 *
 * `v.id = a.pinned_version_id` —— 挂载行自己指的那一条版本，与 artifact 现在的 head 无关。
 * `artifact_versions` 的行不可变（0007），所以这条 JOIN 取回来的 `content_hash`
 * 在挂载之后**永远不会变**；而任何「顺着 artifact_id 取最新一版」的写法都会跟着上游走，
 * 且两种写法在只有一个版本时给出完全一样的结果 —— 这正是它必须被单独反证的原因。
 */
export const SNAPSHOT_JOIN = `JOIN artifact_versions v ON v.id = a.pinned_version_id AND v.org_id = a.org_id`;

/**
 * 判定所需的事实，与行**在同一条查询里**取出。
 *
 * 与 F80 的 `FACT_COLUMNS` 同因：两次查询之间协作者被移除，就会出现
 * 「按 A 时刻的事实判定、发 B 时刻的内容」。
 *
 * 事实取自**访谈**而不是挂载：能不能看见一条挂载 = 能不能看见它挂的那场访谈。
 * `$1 = orgId, $2 = viewerUserId` 不在这里 —— 协作者身份按挂载所属访谈现查，
 * 判定人由调用方在 `decideInterviewVisibility` 里给。
 */
const INTERVIEW_JOIN = `JOIN interview_sessions s ON s.id = a.interview_id AND s.org_id = a.org_id`;

const COLUMNS = `
  a.id, a.interview_id, a.project_id, a.agenda_segment_id, a.pinned_version_id,
  v.version_number, v.content_hash,
  a.attached_by, a.attached_at, a.detached_at,
  s.project_id AS interview_project_id, s.created_by`;

interface AttachmentRowShape {
  id: string;
  interview_id: string;
  project_id: string;
  agenda_segment_id: string;
  pinned_version_id: string;
  version_number: number;
  content_hash: string;
  attached_by: string;
  attached_at: Date;
  detached_at: Date | null;
  interview_project_id: string | null;
  created_by: string;
  is_collaborator: boolean;
}

const toRecord = (r: AttachmentRowShape): AttachmentRecord => ({
  attachmentId: r.id,
  interviewId: r.interview_id,
  projectId: r.project_id,
  agendaSegmentId: r.agenda_segment_id,
  pinnedVersionId: r.pinned_version_id,
  pinnedVersionNumber: Number(r.version_number),
  pinnedContentHash: r.content_hash,
  attachedBy: r.attached_by,
  attachedAt: r.attached_at.toISOString(),
  detachedAt: r.detached_at === null ? null : r.detached_at.toISOString(),
});

/**
 * 包成 `Guarded<T>`：从这里开始，载荷只能经 `discloseDecided` 取出。
 *
 * `ref.kind` 用 `"interview"`（与 F80 同一个），而不是新造一个 `"interview-attachment"`：
 * 这条挂载的准入就是那场访谈的准入，用同一个 ref 让它不可能被单独放行。
 * `interview` 不在 `AclObjectRef` 里 ⇒ 「顺手交给 `disclose()` 判一下」是编译错误，
 * 而不是一次退回宽松默认 scope 的静默放行。
 */
const toGuarded = (r: AttachmentRowShape): GuardedAttachment => ({
  item: guard({ kind: "interview", id: r.interview_id }, toRecord(r)),
  facts: {
    projectId: r.interview_project_id,
    createdBy: r.created_by,
    isExplicitCollaborator: r.is_collaborator,
  },
});

/** `$1 = orgId, $2 = viewerUserId` —— 与 F80 的 `FACT_COLUMNS` 逐字同形。 */
const COLLABORATOR_FACT = `
  EXISTS (
    SELECT 1 FROM interview_collaborators ic
     WHERE ic.interview_id = a.interview_id AND ic.org_id = $1 AND ic.user_id = $2
  ) AS is_collaborator`;

export class PgInterviewAttachmentRepository implements InterviewAttachmentRepository {
  constructor(private readonly db: DatabasePort) {}

  private selectSql(where: string, extra = ""): string {
    return `SELECT ${COLUMNS}, ${COLLABORATOR_FACT}
              FROM interview_step_attachments a ${SNAPSHOT_JOIN} ${INTERVIEW_JOIN}
             WHERE ${where} ${extra}`;
  }

  async attach(input: AttachInput): Promise<GuardedAttachment> {
    return this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_step_attachments
           (id, org_id, interview_id, project_id, agenda_segment_id, pinned_version_id, attached_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.attachmentId,
          input.orgId,
          input.interviewId,
          input.projectId,
          input.agendaSegmentId,
          input.pinnedVersionId,
          input.attachedBy,
        ],
      );
      // 回执**回查一次**而不是把入参拼回去：`version_number` / `content_hash` 只有库里有，
      // 而它们正是审计明细要记的东西。顺带地，这一次回查也走了同一条 SNAPSHOT_JOIN。
      const r = await s.query<AttachmentRowShape>(
        this.selectSql(`a.org_id = $1 AND a.id = $3`),
        [input.orgId, input.attachedBy, input.attachmentId],
      );
      const row = r.rows[0];
      if (row === undefined) {
        throw new Error(`attachment ${input.attachmentId} vanished immediately after insert`);
      }
      return toGuarded(row);
    });
  }

  async detach(
    orgId: OrgId,
    viewerUserId: string,
    attachmentId: string,
  ): Promise<GuardedAttachment | null> {
    return this.db.withTenant(orgId, async (s) => {
      // `detached_at IS NULL` 在 WHERE 里而不是先读后写：两次往返之间的第二个解除请求
      // 会静默把时间戳往后推，而「谁在什么时候摘下来的」就此变成最后一个人。
      const done = await s.query<{ id: string }>(
        `UPDATE interview_step_attachments a
            SET detached_at = now(), detached_by = $2
          WHERE a.org_id = $1 AND a.id = $3 AND a.detached_at IS NULL
        RETURNING a.id`,
        [orgId, viewerUserId, attachmentId],
      );
      if (done.rows[0] === undefined) return null;
      const r = await s.query<AttachmentRowShape>(this.selectSql(`a.org_id = $1 AND a.id = $3`), [
        orgId,
        viewerUserId,
        attachmentId,
      ]);
      const row = r.rows[0];
      return row === undefined ? null : toGuarded(row);
    });
  }

  async find(
    orgId: OrgId,
    viewerUserId: string,
    attachmentId: string,
  ): Promise<GuardedAttachment | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<AttachmentRowShape>(this.selectSql(`a.org_id = $1 AND a.id = $3`), [
        orgId,
        viewerUserId,
        attachmentId,
      ]);
      const row = r.rows[0];
      return row === undefined ? null : toGuarded(row);
    });
  }

  async listActive(
    orgId: OrgId,
    viewerUserId: string,
    interviewId: string,
  ): Promise<readonly GuardedAttachment[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<AttachmentRowShape>(
        this.selectSql(
          `a.org_id = $1 AND a.interview_id = $3 AND a.detached_at IS NULL`,
          `ORDER BY a.attached_at ASC, a.id ASC`,
        ),
        [orgId, viewerUserId, interviewId],
      );
      return r.rows.map(toGuarded);
    });
  }

  /**
   * 该版本所属 artifact 的全部绑定锚点。
   *
   * ⚠ 没有 `WHERE b.mode = 'pinned'`：判定是 `judgeCitation` 的事。
   * 在这里先筛，等于把规则第二次声明在 SQL 里，而那时唯一能断言它的方式就是断言这条查询。
   */
  async anchorsFor(orgId: OrgId, versionId: string): Promise<readonly CitationAnchor[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ mode: string; pinned_version_id: string | null }>(
        `SELECT b.mode, b.pinned_version_id
           FROM artifact_bindings b
           JOIN artifact_versions v
             ON v.artifact_id = b.artifact_id AND v.org_id = b.org_id
          WHERE b.org_id = $1 AND v.id = $2`,
        [orgId, versionId],
      );
      return r.rows.map((x) => ({
        mode: x.mode as BindingModeName,
        pinnedVersionId: x.pinned_version_id,
      }));
    });
  }
}
