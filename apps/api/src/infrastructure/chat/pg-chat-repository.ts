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
  AgentRosterState,
  ChatCitationRow,
  ChatMessageRow,
  ChatRepository,
  MessageLocation,
  NewThreadInput,
  ThreadFileRecord,
  ThreadListRow,
  ThreadPresentation,
  UpdateAgentRosterOutcome,
} from "../../application/chat/ports";
import type {
  ChatVisibilityScope,
  ThreadFacts,
} from "../../domain/chat/thread-visibility";
import type { AgentPresenceValue } from "../../domain/chat/agent-presence";
import type { OrgId } from "../../domain/org-id";

interface AgentRosterDbRow {
  agent_id: string;
  abbr: string;
  name: string;
  duty: string;
  presence: string;
}

/**
 * 内部信号，只在本文件的事务函数与外层 catch 之间传递（F110）。
 * ⚠ 不外泄到 `ChatRepository` 接口——那边是判别联合返回值，不是异常，
 *   见 `application/chat/ports.ts` 上 `UpdateAgentRosterOutcome` 的注释。
 */
class RosterOutOfScopeSignal extends Error {
  constructor(public readonly agentId: string) {
    super("roster_out_of_scope");
  }
}
class RosterAgentMissingSignal extends Error {
  constructor(public readonly agentId: string) {
    super("roster_agent_missing");
  }
}

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
        review_pending: boolean;
        created_at: Date;
      }>(
        `SELECT id, author_kind, author_id, agent_id, body, raw_transcript, visibility_scope,
                review_pending, created_at
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
        // ⚠ 这是全仓**唯一**读 `review_pending` 的地方。徽标怎么算见
        //   `domain/chat/thread-badges.ts`——仓储给事实，不给结论（I-13）。
        reviewPending: row.review_pending,
        createdAt: row.created_at.toISOString(),
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

  /* ── F109 ──────────────────────────────────────────────────────────── */

  /**
   * 候选行。**没有可见性 WHERE**——过滤由 `resolveVisibility` 逐条判，
   * 与 `getThread` 同一个门。理由见文件头与 `ports.ts` 上的注释。
   *
   * `transcribing` 是一个 EXISTS 子查询，读的是 `chat_transcript_sessions`，
   * **与 `last_activity_at` 无关**（I-14）。想按时间推断徽标的实现在这里连数据都取不到。
   */
  async listProjectThreads(
    orgId: OrgId,
    projectId: string,
    opts: { includeArchived: boolean },
  ): Promise<readonly ThreadListRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<
        ThreadDbRow & { title: string; agent_private: boolean; transcribing: boolean }
      >(
        `SELECT t.id, t.project_id, t.group_id, t.visibility_scope, t.created_by, t.archived,
                t.phase, t.title, t.agent_private, t.last_activity_at, t.version,
                EXISTS (
                  SELECT 1 FROM chat_transcript_sessions ts
                   WHERE ts.thread_id = t.id AND ts.org_id = t.org_id AND ts.stopped_at IS NULL
                ) AS transcribing
           FROM chat_threads t
          WHERE t.org_id = $1 AND t.project_id = $2
            AND ($3::boolean OR NOT t.archived)
          ORDER BY t.last_activity_at DESC, t.id`,
        [orgId, projectId, opts.includeArchived],
      );
      return r.rows.map((row) => ({
        threadId: row.id,
        projectId: row.project_id,
        groupId: row.group_id,
        visibilityScope: row.visibility_scope as ChatVisibilityScope,
        createdBy: row.created_by,
        archived: row.archived,
        title: row.title,
        agentPrivate: row.agent_private,
        lastActivityAt: row.last_activity_at.toISOString(),
        version: row.version,
        transcribing: row.transcribing,
      }));
    });
  }

  async findSpeakingAgentIds(orgId: OrgId, threadId: string): Promise<readonly string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ agent_id: string }>(
        `SELECT DISTINCT agent_id FROM chat_messages
          WHERE thread_id = $1 AND org_id = $2 AND author_kind = 'agent' AND agent_id IS NOT NULL`,
        [threadId, orgId],
      );
      return r.rows.map((row) => row.agent_id);
    });
  }

  async createThread(input: NewThreadInput): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_threads
           (id, org_id, project_id, group_id, visibility_scope, title, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.threadId, input.orgId, input.projectId, input.groupId,
          input.visibilityScope, input.title, input.createdBy,
        ],
      );
    });
  }

  /**
   * 乐观并发：`WHERE version = $expected` 在**同一条语句**里比对并自增。
   * 「先 SELECT 比一下再 UPDATE」在两句之间留着一个窗口，而那个窗口就是 V7 要关的东西。
   */
  async renameThread(
    orgId: OrgId,
    threadId: string,
    title: string,
    expectedVersion: number,
  ): Promise<number | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ version: number }>(
        `UPDATE chat_threads
            SET title = $1, version = version + 1, last_activity_at = now()
          WHERE id = $2 AND org_id = $3 AND version = $4
      RETURNING version`,
        [title, threadId, orgId, expectedVersion],
      );
      return r.rows[0]?.version ?? null;
    });
  }

  async deleteThread(
    orgId: OrgId,
    threadId: string,
    expectedVersion: number,
  ): Promise<{ messageCount: number } | null> {
    return this.db.withTenant(orgId, async (s) => {
      // 条数在同一个事务里、删除之前读。删完再数恒为 0——一个恒为 0 的影响范围
      // 比没有影响范围更糟：它看起来像已经验证过了。
      const c = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM chat_messages WHERE thread_id = $1 AND org_id = $2",
        [threadId, orgId],
      );
      const r = await s.query<{ id: string }>(
        `DELETE FROM chat_threads
          WHERE id = $1 AND org_id = $2 AND version = $3
      RETURNING id`,
        [threadId, orgId, expectedVersion],
      );
      if (r.rows.length === 0) return null;
      return { messageCount: Number(c.rows[0]?.n ?? "0") };
    });
  }

  async findThreadFile(orgId: OrgId, threadId: string): Promise<ThreadFileRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        artifact_id: string;
        object_key: string;
        sha256: string;
        size_bytes: string;
      }>(
        `SELECT artifact_id, object_key, sha256, size_bytes::text AS size_bytes
           FROM chat_thread_files WHERE thread_id = $1 AND org_id = $2`,
        [threadId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        artifactId: row.artifact_id,
        objectKey: row.object_key,
        sha256: row.sha256,
        sizeBytes: Number(row.size_bytes),
      };
    });
  }

  /**
   * 登记指针。**没有 ON CONFLICT DO NOTHING**：主键冲突要能冒出来。
   * 吞掉它，第二次物化会静默地留下一个没人指向的 artifact 版本，
   * 而 I-16「恰好一个」在数据库里仍然成立、在对象存储里已经不成立了。
   */
  async recordThreadFile(
    orgId: OrgId,
    threadId: string,
    file: ThreadFileRecord,
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_thread_files
           (thread_id, org_id, artifact_id, object_key, sha256, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [threadId, orgId, file.artifactId, file.objectKey, file.sha256, file.sizeBytes],
      );
    });
  }

  /* ── F110：AI 团队面板 / 编制 ─────────────────────────────────────── */

  /**
   * 线程不存在（读不到 `roster_version`）时返回 `null`——与其余读端口同一个「不存在」
   * 出口。**没有编制的线程返回空数组，不是 `null`**：那是「有线程、编制为空」，
   * 与「线程本身不存在」是两个不同的事实（同 `getAgentPanel` 文件头「依赖失败 vs
   * 空面板」的区分）。
   */
  async findAgentRoster(orgId: OrgId, threadId: string): Promise<AgentRosterState | null> {
    return this.db.withTenant(orgId, async (s) => {
      const t = await s.query<{ roster_version: number }>(
        "SELECT roster_version FROM chat_threads WHERE id = $1 AND org_id = $2",
        [threadId, orgId],
      );
      const rosterVersion = t.rows[0]?.roster_version;
      if (rosterVersion === undefined) return null;
      const rows = await s.query<AgentRosterDbRow>(
        `SELECT ta.agent_id, oa.abbr, oa.name, oa.duty, ta.presence
           FROM chat_thread_agents ta
           JOIN org_agents oa ON oa.org_id = ta.org_id AND oa.agent_id = ta.agent_id
          WHERE ta.org_id = $1 AND ta.thread_id = $2
          ORDER BY ta.agent_id`,
        [orgId, threadId],
      );
      return { rosterVersion, agents: rows.rows.map(toAgentPanelAgent) };
    });
  }

  /**
   * 改编制。**部分成功即整体拒绝**——见 `ports.ts` 上 `UpdateAgentRosterOutcome` 的注释。
   *
   * 实现顺序是关键：
   *   1. 乐观并发 gate **打头**，与 `renameThread` 同一手法（`UPDATE ... WHERE
   *      roster_version = $expected RETURNING roster_version`，比对与自增在同一条语句）。
   *      版本不匹配 ⇒ 直接 `return`（此时还没有任何其余写入，事务提交与否都无所谓）。
   *   2. 版本 gate 通过之后才做 `add`/`remove` 的范围与存在性校验；校验失败**抛出**
   *      内部信号，而不是 `return`——抛出会让 `withTenant` 的 `catch` 分支
   *      `ROLLBACK` 整个事务，**连第 1 步已经写入的版本自增也回滚**。
   *      这就是"部分成功即整体拒绝"在事务层面的真正实现：不是"检查完了再一起写"，
   *      是"写錯了就把已经写的也吐出来"。
   *   3. 全部校验通过后才真正 DELETE / INSERT，再重新 SELECT 整份编制返回。
   */
  async updateAgentRoster(
    orgId: OrgId,
    threadId: string,
    add: readonly string[],
    remove: readonly string[],
    expectedRosterVersion: number,
  ): Promise<UpdateAgentRosterOutcome> {
    try {
      return await this.db.withTenant(orgId, async (s) => {
        const bump = await s.query<{ roster_version: number }>(
          `UPDATE chat_threads
              SET roster_version = roster_version + 1
            WHERE id = $1 AND org_id = $2 AND roster_version = $3
        RETURNING roster_version`,
          [threadId, orgId, expectedRosterVersion],
        );
        const rosterVersion = bump.rows[0]?.roster_version;
        if (rosterVersion === undefined) return { kind: "version-changed" as const };

        for (const agentId of add) {
          const r = await s.query(
            "SELECT 1 FROM org_agents WHERE org_id = $1 AND agent_id = $2",
            [orgId, agentId],
          );
          if (r.rows.length === 0) throw new RosterOutOfScopeSignal(agentId);
        }
        for (const agentId of remove) {
          const r = await s.query(
            "SELECT 1 FROM chat_thread_agents WHERE org_id = $1 AND thread_id = $2 AND agent_id = $3",
            [orgId, threadId, agentId],
          );
          if (r.rows.length === 0) throw new RosterAgentMissingSignal(agentId);
        }

        for (const agentId of remove) {
          await s.query(
            "DELETE FROM chat_thread_agents WHERE org_id = $1 AND thread_id = $2 AND agent_id = $3",
            [orgId, threadId, agentId],
          );
        }
        for (const agentId of add) {
          await s.query(
            `INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence)
             VALUES ($1,$2,$3,'off')
             ON CONFLICT (thread_id, agent_id) DO NOTHING`,
            [threadId, orgId, agentId],
          );
        }

        const rows = await s.query<AgentRosterDbRow>(
          `SELECT ta.agent_id, oa.abbr, oa.name, oa.duty, ta.presence
             FROM chat_thread_agents ta
             JOIN org_agents oa ON oa.org_id = ta.org_id AND oa.agent_id = ta.agent_id
            WHERE ta.org_id = $1 AND ta.thread_id = $2
            ORDER BY ta.agent_id`,
          [orgId, threadId],
        );
        return { kind: "ok" as const, rosterVersion, agents: rows.rows.map(toAgentPanelAgent) };
      });
    } catch (e) {
      if (e instanceof RosterOutOfScopeSignal) {
        return { kind: "agent-out-of-scope", agentId: e.agentId };
      }
      if (e instanceof RosterAgentMissingSignal) {
        return { kind: "agent-not-found", agentId: e.agentId };
      }
      throw e;
    }
  }

  /* ── F111：工具调用链与引用 ───────────────────────────────────────── */

  /** 见 `ports.ts` 上的注释：判权与查询的起点都是它。 */
  async findMessageLocation(orgId: OrgId, messageId: string): Promise<MessageLocation | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ thread_id: string; project_id: string }>(
        `SELECT m.thread_id, t.project_id
           FROM chat_messages m
           JOIN chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
          WHERE m.id = $1 AND m.org_id = $2`,
        [messageId, orgId],
      );
      const row = r.rows[0];
      return row ? { threadId: row.thread_id, projectId: row.project_id } : null;
    });
  }

  async messageExists(orgId: OrgId, messageId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query("SELECT 1 FROM chat_messages WHERE id = $1 AND org_id = $2", [
        messageId, orgId,
      ]);
      return r.rows.length > 0;
    });
  }

  async findCitation(orgId: OrgId, citationId: string): Promise<ChatCitationRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        citation_id: string;
        message_id: string;
        idx: number;
        source_full_name: string;
        anchor_kind: string;
        anchor_page: number | null;
        anchor_range: string | null;
        anchor_message_id: string | null;
        source_artifact_id: string | null;
      }>(
        `SELECT citation_id, message_id, idx, source_full_name, anchor_kind,
                anchor_page, anchor_range, anchor_message_id, source_artifact_id
           FROM chat_citations WHERE citation_id = $1 AND org_id = $2`,
        [citationId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        citationId: row.citation_id,
        messageId: row.message_id,
        index: row.idx,
        sourceFullName: row.source_full_name,
        anchorKind: row.anchor_kind as ChatCitationRow["anchorKind"],
        anchorPage: row.anchor_page,
        anchorRange: row.anchor_range,
        anchorMessageId: row.anchor_message_id,
        sourceArtifactId: row.source_artifact_id,
      };
    });
  }

  async artifactExists(orgId: OrgId, artifactId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query("SELECT 1 FROM artifacts WHERE id = $1 AND org_id = $2", [
        artifactId, orgId,
      ]);
      return r.rows.length > 0;
    });
  }
}

function toAgentPanelAgent(row: AgentRosterDbRow) {
  return {
    id: row.agent_id,
    abbr: row.abbr,
    name: row.name,
    duty: row.duty,
    presence: row.presence as AgentPresenceValue,
  };
}
