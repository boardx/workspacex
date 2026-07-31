/**
 * `ChatRepository` 的 PostgreSQL 实现。
 *
 * 每个查询都经 `withTenant`，所以 RLS 是第一道，WHERE 里的 org_id 是第二道。
 * 后者不是冗余的保险带——它让查询对下一个读代码的人是可读的；但即便哪天被删掉，
 * RLS 依然成立。这种不对称正是 F18 的设计。
 *
 * ⚠ 这里**没有**任何可见性过滤。可见性由 `domain/chat/thread-visibility.ts` 一处回答，
 *   仓储只负责取。把「组员看不到别组」写进 SQL，就是第二份可见性实现，
 *   而两份实现里总有一份是旧的。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  ChatMessageRow,
  ChatRepository,
  ThreadPresentation,
} from "../../application/chat/ports";
import type {
  ChatVisibilityScope,
  ThreadFacts,
} from "../../domain/chat/thread-visibility";
import type { OrgId } from "../../domain/org-id";

interface ThreadDbRow {
  id: string;
  project_id: string;
  group_id: string | null;
  visibility_scope: string;
  created_by: string;
  archived: boolean;
  phase: string;
  last_activity_at: Date;
  version: number;
}

export class PgChatRepository implements ChatRepository {
  constructor(private readonly db: DatabasePort) {}

  async findThreadFacts(orgId: OrgId, threadId: string): Promise<ThreadFacts | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ThreadDbRow>(
        `SELECT id, project_id, group_id, visibility_scope, created_by, archived
           FROM chat_threads WHERE id = $1 AND org_id = $2`,
        [threadId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        threadId: row.id,
        projectId: row.project_id,
        groupId: row.group_id,
        visibilityScope: row.visibility_scope as ChatVisibilityScope,
        createdBy: row.created_by,
        archived: row.archived,
      };
    });
  }

  async findThreadPresentation(orgId: OrgId, threadId: string): Promise<ThreadPresentation | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ThreadDbRow>(
        `SELECT phase, last_activity_at, version
           FROM chat_threads WHERE id = $1 AND org_id = $2`,
        [threadId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        phase: row.phase as ThreadPresentation["phase"],
        lastActivityAt: row.last_activity_at.toISOString(),
        version: row.version,
      };
    });
  }

  /**
   * 返回 `Guarded`，不是裸数组。
   *
   * 正文是本仓最敏感的一类内容，而「取到手了再记得别返回」是把泄露与否押在
   * 未来每一次修改上。`Guarded` 让忘记判权变成类型错误（F02 守卫读路径）。
   * ref 取**项目**：线程不是 `acl_bindings` 的对象类型，它的组织层归属就是所在项目的。
   */
  async findMessages(orgId: OrgId, threadId: string): Promise<Guarded<ChatMessageRow[]> | null> {
    const projectId = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_id: string }>(
        "SELECT project_id FROM chat_threads WHERE id = $1 AND org_id = $2",
        [threadId, orgId],
      );
      return r.rows[0]?.project_id ?? null;
    });
    if (projectId === null) return null;
    const rows = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        author_kind: string;
        author_id: string;
        agent_id: string | null;
        body: string;
        raw_transcript: boolean;
        visibility_scope: string | null;
      }>(
        `SELECT id, author_kind, author_id, agent_id, body, raw_transcript, visibility_scope
           FROM chat_messages WHERE thread_id = $1 AND org_id = $2 ORDER BY created_at, id`,
        [threadId, orgId],
      );
      return r.rows.map((row) => ({
        id: row.id,
        authorKind: row.author_kind as ChatMessageRow["authorKind"],
        authorId: row.author_id,
        agentId: row.agent_id,
        body: row.body,
        rawTranscript: row.raw_transcript,
        visibilityScope: row.visibility_scope as ChatVisibilityScope | null,
      }));
    });
    return guard({ kind: "project", id: projectId }, rows);
  }

  /** COUNT，不是取回列表再数——正文不进内存才叫「只返计数」（I-8）。 */
  async countMessages(orgId: OrgId, threadId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM chat_messages WHERE thread_id = $1 AND org_id = $2",
        [threadId, orgId],
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }
}
