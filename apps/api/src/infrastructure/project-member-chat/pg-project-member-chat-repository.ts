import { randomUUID } from "node:crypto";
import { MemberMessage, StageReference } from "@repo/contracts/project-member-chat";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { PageData, PageInput, PostInput, ProjectMemberChatRepository, Viewer } from "../../application/project-member-chat/ports";
import { guard } from "../../application/security/permission-filter";
import { ProjectMemberChatError } from "../../domain/project-member-chat/errors";

interface MessageRow {
  id: string; project_id: string; sequence: string; author_id: string; client_message_id: string;
  text: string; thread_root_id: string | null; stage_reference: unknown; created_at: Date;
}
const COLUMNS = "id, project_id, sequence, author_id, client_message_id, text, thread_root_id, stage_reference, created_at";
function message(row: MessageRow): MemberMessage {
  return MemberMessage.parse({ id: row.id, projectId: row.project_id, sequence: Number(row.sequence),
    authorId: row.author_id, clientMessageId: row.client_message_id, text: row.text,
    threadRootId: row.thread_root_id,
    stageReference: row.stage_reference === null ? null : StageReference.parse(row.stage_reference),
    createdAt: row.created_at.toISOString() });
}
function guarded<T>(viewer: Viewer, payload: T) {
  return guard({ kind: "project", id: viewer.projectId }, payload);
}
/** All methods are nested in the service's withTenant transaction. The channel row lock
 * serializes sequence allocation through COMMIT; no external transport or AI is invoked.
 */
export class PgProjectMemberChatRepository implements ProjectMemberChatRepository {
  constructor(private readonly db: DatabasePort) {}
  async facts(viewer: Viewer) {
    return this.db.withTenant(viewer.orgId, async s => {
      const result = await s.query<{ project_status: "active" | "archived"; org_status: "active" | "disabled" }>(
        `SELECT p.status AS project_status, o.status AS org_status FROM projects p
         JOIN organizations o ON o.id=p.org_id WHERE p.org_id=$1 AND p.id=$2 FOR SHARE OF p,o`,
        [viewer.orgId, viewer.projectId]);
      // Recheck actual membership under a row lock. Removal/role changes cannot commit
      // through an accepted send/read transaction; a removed member sees the same 404.
      const workshop = await s.query(`SELECT user_id FROM project_memberships
        WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE`, [viewer.orgId, viewer.projectId, viewer.userId]);
      const general = await s.query(`SELECT user_id FROM general_project_members
        WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE`, [viewer.orgId, viewer.projectId, viewer.userId]);
      const facts = workshop.rows.length || general.rows.length ? result.rows[0] : undefined;
      return guarded(viewer, facts ? { projectStatus: facts.project_status, orgStatus: facts.org_status } : null);
    });
  }
  async findMessage(viewer: Viewer, id: string) {
    return this.db.withTenant(viewer.orgId, async s => guarded(viewer, await this.find(s, viewer, id)));
  }
  private async find(s: TenantSession, viewer: Viewer, id: string) {
    const result = await s.query<MessageRow>(`SELECT ${COLUMNS} FROM project_member_chat_messages
      WHERE org_id=$1 AND project_id=$2 AND id=$3::uuid`, [viewer.orgId, viewer.projectId, id]);
    return result.rows[0] ? message(result.rows[0]) : null;
  }
  async page(viewer: Viewer, input: PageInput, threadRootId?: string) {
    return this.db.withTenant(viewer.orgId, async s => {
      // Lock-free snapshot watermark precedes rows: later commits are fetched on the next poll.
      const counter = await s.query<{ last_sequence: string }>(`SELECT last_sequence FROM project_member_chat_channels
        WHERE org_id=$1 AND project_id=$2`, [viewer.orgId, viewer.projectId]);
      const latestSequence = Number(counter.rows[0]?.last_sequence ?? 0);
      const after = input.afterSequence;
      const forward = after !== undefined;
      const params: unknown[] = [viewer.orgId, viewer.projectId, latestSequence];
      let where = "org_id=$1 AND project_id=$2 AND sequence <= $3";
      if (threadRootId !== undefined) { params.push(threadRootId); where += ` AND thread_root_id=$${params.length}::uuid`; }
      else if (!forward) where += " AND thread_root_id IS NULL";
      if (after !== undefined) { params.push(after); where += ` AND sequence > $${params.length}`; }
      if (input.beforeSequence !== undefined) { params.push(input.beforeSequence); where += ` AND sequence < $${params.length}`; }
      params.push(input.limit + 1);
      const rows = (await s.query<MessageRow>(`SELECT ${COLUMNS} FROM project_member_chat_messages WHERE ${where}
        ORDER BY sequence ${forward ? "ASC" : "DESC"} LIMIT $${params.length}`, params)).rows;
      const more = rows.length > input.limit;
      const selected = rows.slice(0, input.limit);
      if (!forward) selected.reverse();
      const items = selected.map(message);
      const nextAfterSequence = forward && more ? items.at(-1)!.sequence : latestSequence;
      const roots = [...new Set(items.map(item => item.threadRootId ?? item.id))];
      // Counts are bounded by the same watermark as the message page, never future data.
      const summaries = roots.length === 0 ? [] : (await s.query<{ root_message_id: string; reply_count: string; last_sequence: string }>(
        `SELECT COALESCE(thread_root_id,id) AS root_message_id,
          count(*) FILTER(WHERE thread_root_id IS NOT NULL)::text AS reply_count,
          max(sequence)::text AS last_sequence FROM project_member_chat_messages
          WHERE org_id=$1 AND project_id=$2 AND sequence <= $3 AND (id=ANY($4::uuid[]) OR thread_root_id=ANY($4::uuid[]))
          GROUP BY COALESCE(thread_root_id,id)`, [viewer.orgId, viewer.projectId, latestSequence, roots])).rows;
      const result: PageData = { items, latestSequence, nextAfterSequence,
        nextBeforeSequence: !forward && more ? items[0]!.sequence : null,
        threadUpdates: summaries.map(row => ({ rootMessageId: row.root_message_id,
          replyCount: Number(row.reply_count), lastSequence: Number(row.last_sequence) })) };
      return guarded(viewer, result);
    });
  }
  async post(viewer: Viewer, input: PostInput) {
    return this.db.withTenant(viewer.orgId, async s => {
      await s.query(`INSERT INTO project_member_chat_channels(org_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [viewer.orgId, viewer.projectId]);
      await s.query(`SELECT last_sequence FROM project_member_chat_channels WHERE org_id=$1 AND project_id=$2 FOR UPDATE`,
        [viewer.orgId, viewer.projectId]);
      const prior = (await s.query<MessageRow>(`SELECT ${COLUMNS} FROM project_member_chat_messages
        WHERE org_id=$1 AND project_id=$2 AND author_id=$3 AND client_message_id=$4::uuid`,
        [viewer.orgId, viewer.projectId, viewer.userId, input.clientMessageId])).rows[0];
      if (prior) {
        const saved = message(prior);
        if (saved.text !== input.text || saved.threadRootId !== (input.threadRootId ?? null)
          || saved.stageReference?.stageId !== input.stageReference?.stageId
          || saved.stageReference?.revision !== input.stageReference?.revision) {
          throw new ProjectMemberChatError("IDEMPOTENCY_CONFLICT");
        }
        return guarded(viewer, { message: saved, replayed: true });
      }
      if (input.threadRootId) {
        const root = await this.find(s, viewer, input.threadRootId);
        if (!root) throw new ProjectMemberChatError("NOT_FOUND");
        if (root.threadRootId !== null) throw new ProjectMemberChatError("THREAD_ROOT_INVALID");
      }
      if (input.stageReference?.revision !== undefined) {
        const reference = await s.query(`SELECT 1 FROM aidt_stage_revisions
          WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 AND revision=$4`,
          [viewer.orgId, viewer.projectId, input.stageReference.stageId, input.stageReference.revision]);
        if (reference.rows.length === 0) throw new ProjectMemberChatError("INVALID_INPUT");
      }
      const next = (await s.query<{ last_sequence: string }>(`UPDATE project_member_chat_channels
        SET last_sequence=last_sequence+1 WHERE org_id=$1 AND project_id=$2 RETURNING last_sequence`,
        [viewer.orgId, viewer.projectId])).rows[0];
      if (!next) throw new ProjectMemberChatError("DEPENDENCY_UNAVAILABLE");
      const inserted = await s.query<MessageRow>(`INSERT INTO project_member_chat_messages
        (org_id,project_id,id,sequence,author_id,client_message_id,text,thread_root_id,stage_reference)
        VALUES($1,$2,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,$9::jsonb) RETURNING ${COLUMNS}`,
        [viewer.orgId, viewer.projectId, randomUUID(), next.last_sequence, viewer.userId, input.clientMessageId,
          input.text, input.threadRootId ?? null, input.stageReference ? JSON.stringify(input.stageReference) : null]);
      if (!inserted.rows[0]) throw new ProjectMemberChatError("DEPENDENCY_UNAVAILABLE");
      return guarded(viewer, { message: message(inserted.rows[0]), replayed: false });
    });
  }
}
