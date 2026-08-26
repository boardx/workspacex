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
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  AgentRosterState,
  ApprovalDataScopeRow,
  ApprovalDecisionWrite,
  ApprovalRequestRow,
  BackgroundTaskRow,
  ChatCitationRow,
  ChatMessageRow,
  ChatRepository,
  MessageLocation,
  NewApprovalRequestInput,
  NewBackgroundTaskInput,
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
  /**
   * #1705（#728 D-1）—— `capability_listings.role_label`。⚠ 可能为 NULL：这一列没有
   * NOT NULL/kind 条件强制（见迁移 `20260821180000_i1705_agent_role_label.sql` 头注——
   * 「能力目录」admin 表单这条独立写路径不产出它）。`toAgentPanelAgent` 在映射时回退到
   * `duty`，不把 NULL 交给调用方。
   */
  role_label: string | null;
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
  /** 🔴 #594：`null` = 个人线程，不挂靠项目（`chat_threads.project_id` 已放宽为可空）。 */
  project_id: string | null;
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
    /**
     * 🔴 #594：**必须**分清「查无此行」与「查到了但 `project_id IS NULL`」——
     * 后者从这次改动起是一个合法状态（个人线程），前者才是「线程不存在」。
     * 改动前 `r.rows[0]?.project_id ?? null` 把两者叠成同一个 `null`，
     * 这是一个真实的功能性 bug：每一条个人线程的消息都会被这一行误判成
     * 「线程不存在」，创建者读自己的对话会拿到 404——不是越权读，是反过来的
     * 「自己的东西读不到」，但同样是「一个 null 承担两种含义」这个老坑的新受害者。
     */
    const found = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_id: string | null }>(
        "SELECT project_id FROM chat_threads WHERE id = $1 AND org_id = $2",
        [threadId, orgId],
      );
      return r.rows[0] === undefined ? { exists: false as const } : { exists: true as const, projectId: r.rows[0].project_id };
    });
    if (!found.exists) return null;
    const projectId = found.projectId;
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
    // ref 只是 Guarded 的描述性元数据（discloseDecided 不查它），个人线程用一个
    // 恒无绑定行的合成 id，同 resolve-visibility.ts / pg-chat-message-command-repository.ts 的先例。
    return guard({ kind: "project", id: projectId ?? `personal:${threadId}` }, rows);
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

  /**
   * 🔴 #594 —— 一个用户自己名下的候选个人线程。`WHERE project_id IS NULL AND
   * created_by = $2` 是性能手段不是可见性判断，见 `ports.ts` 同名方法的头注。
   */
  async listPersonalThreads(
    orgId: OrgId,
    userId: string,
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
          WHERE t.org_id = $1 AND t.project_id IS NULL AND t.created_by = $2
            AND ($3::boolean OR NOT t.archived)
          ORDER BY t.last_activity_at DESC, t.id`,
        [orgId, userId, opts.includeArchived],
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

  /**
   * 🔴 #2094：一次查询拿全部线程的最近 run 状态。见 `ports.ts` 同名方法头注。
   *
   * `DISTINCT ON (thread_id)` + `ORDER BY thread_id, created_at DESC, id DESC` 正好走
   * `agent_runs_thread_idx (org_id, thread_id, created_at, id)`。`id DESC` 是**并列打破**，
   * 不是装饰：同一毫秒建的两条 run 若没有它，返回哪条取决于物理行序，
   * 于是同一份数据两次请求可能给出不同状态。
   */
  async latestRunStatusByThread(
    orgId: OrgId,
    threadIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (threadIds.length === 0) return new Map();
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ thread_id: string; status: string }>(
        `SELECT DISTINCT ON (thread_id) thread_id, status
           FROM agent_runs
          WHERE org_id = $1 AND thread_id = ANY($2::text[])
          ORDER BY thread_id, created_at DESC, id DESC`,
        [orgId, [...threadIds]],
      );
      return new Map(r.rows.map((row) => [row.thread_id, row.status]));
    });
  }

  /**
   * 🔴 #2094：一次查询拿全部线程的产物数。见 `ports.ts` 同名方法头注。
   *
   * ⚠ `mode <> 'draft' OR created_by = $3` 是 `list-thread-artifacts.ts:66` 那条
   *   `r.mode !== "draft" || r.createdBy === userId`（I-36 草稿仅创建者可见）的
   *   **逐字同一条规则**。两处会不会漂移不靠人盯：
   *   `tests/chat/thread-card-projection.test.ts` 断言两者的答案数值相等。
   */
  async countArtifactsByThread(
    orgId: OrgId,
    threadIds: readonly string[],
    viewerId: string,
  ): Promise<ReadonlyMap<string, number>> {
    if (threadIds.length === 0) return new Map();
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ thread_id: string; n: string }>(
        `SELECT thread_id, count(*)::text AS n
           FROM chat_artifact_landings
          WHERE org_id = $1 AND thread_id = ANY($2::text[])
            AND (mode <> 'draft' OR created_by = $3)
          GROUP BY thread_id`,
        [orgId, [...threadIds], viewerId],
      );
      return new Map(r.rows.map((row) => [row.thread_id, Number(row.n)]));
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

  /**
   * 🔴 #2094：自动命名。见 `ports.ts` 同名方法头注（为什么条件必须在 SQL 里）。
   *
   * ⚠ 与 `renameThread` 的两处**故意不同**，都不是笔误：
   *   · 条件是 `title = $4`（还叫默认名）而不是 `version = $n`——自动命名没有
   *     调用方持有的期望版本，它的前提是「用户还没给它起过名」。
   *   · **不写 `last_activity_at`**：起名不是活动。写了会把线程顶到列表最前，
   *     而触发它的那条消息本来就已经更新过 `last_activity_at`。
   */
  async autoTitleThreadIfDefault(
    orgId: OrgId,
    threadId: string,
    title: string,
    defaultTitle: string,
  ): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      // ⚠ 用 `RETURNING id` + `rows.length` 判命中，不用 `rowCount`：本仓的
      //   `query()` 返回类型上没有 `rowCount`（同 `renameThread` 用 `RETURNING version`）。
      const r = await s.query<{ id: string }>(
        `UPDATE chat_threads
            SET title = $1, version = version + 1
          WHERE id = $2 AND org_id = $3 AND title = $4
      RETURNING id`,
        [title, threadId, orgId, defaultTitle],
      );
      return r.rows.length > 0;
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
        /**
         * #619：`org_agents` → `capability_listings`（`kind='agent'`）。
         *
         * ⚠ 故意**不**加 `AND cl.enabled = true`：这里是"编制里已经有谁"的读端口，
         *   不是"能不能新增"的判断（那条判断在 `updateAgentRoster` 的 add 循环里，
         *   见下方）。一个 agent 被管理员停用之后，**已经在编制里的成员资格不消失**——
         *   同 R8「停用不隐藏，标注原因」的精神：这里虽然还没有"标注原因"的字段，
         *   但至少不能让停用悄悄地把编制读丢一行，那会是比"没有原因"更糟的行为。
         */
        `SELECT ta.agent_id, cl.abbr, cl.name, cl.duty, cl.role_label, ta.presence
           FROM chat_thread_agents ta
           JOIN capability_listings cl
             ON cl.org_id = ta.org_id AND cl.id = ta.agent_id AND cl.kind = 'agent'
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
          /**
           * #619：`org_agents` → `capability_listings`（`kind='agent' AND enabled=true`）。
           * ⚠ 这里**要**过滤 `enabled`——这是"能不能新增进编制"的判断，一个被管理员
           *   停用的能力不应该还能被挑选加入新的线程（同一条道理：停用意味着
           *   "现在起不可用于新用途"，而不仅仅是"界面上标一个原因")。
           * 数据库这一侧还有 `chat_thread_agent_is_enabled_capability_trg`
           *   （迁移 `20260807000000_i619_...sql`）做同一件事的兜底——这条应用层
           *   查询是为了给出 `AGENT_OUT_OF_SCOPE` 这个更精确的错误码，触发器兜的是
           *   "万一应用层这条被绕过"。
           */
          const r = await s.query(
            "SELECT 1 FROM capability_listings WHERE org_id = $1 AND id = $2 AND kind = 'agent' AND enabled = true",
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

        // #619：同 `findAgentRoster` 那条 JOIN，同一个理由（不加 `enabled` 过滤——
        // 已在编制里的成员资格不因目录条目后来被停用而消失）。
        const rows = await s.query<AgentRosterDbRow>(
          `SELECT ta.agent_id, cl.abbr, cl.name, cl.duty, cl.role_label, ta.presence
             FROM chat_thread_agents ta
             JOIN capability_listings cl
               ON cl.org_id = ta.org_id AND cl.id = ta.agent_id AND cl.kind = 'agent'
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

  /** 见 `ports.ts` 上的注释：persona 汇总的 assistant 消息写入（G2）。 */
  async insertAssistantMessage(
    orgId: OrgId,
    input: {
      readonly id: string;
      readonly threadId: string;
      readonly authorId: string;
      readonly body: string;
      readonly replyToMessageId: string | null;
    },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_messages
           (id, org_id, thread_id, author_kind, author_id, agent_id, body, reply_to_message_id)
         VALUES ($1,$2,$3,'agent',$4,NULL,$5,$6)`,
        [input.id, orgId, input.threadId, input.authorId, input.body, input.replyToMessageId],
      );
    });
  }

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

  /** F114：一条消息的全部引用，供 `landAsArtifact` 算 `hasSource` 与逐条定位。 */
  async findCitationsForMessage(orgId: OrgId, messageId: string): Promise<readonly ChatCitationRow[]> {
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
           FROM chat_citations WHERE message_id = $1 AND org_id = $2
          ORDER BY idx ASC`,
        [messageId, orgId],
      );
      return r.rows.map((row) => ({
        citationId: row.citation_id,
        messageId: row.message_id,
        index: row.idx,
        sourceFullName: row.source_full_name,
        anchorKind: row.anchor_kind as ChatCitationRow["anchorKind"],
        anchorPage: row.anchor_page,
        anchorRange: row.anchor_range,
        anchorMessageId: row.anchor_message_id,
        sourceArtifactId: row.source_artifact_id,
      }));
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

  /* ── F112：批准闸门（chat 束 domain.md E 组）────────────────────────── */

  async createApprovalRequest(
    orgId: OrgId,
    input: NewApprovalRequestInput,
  ): Promise<ApprovalRequestRow> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_approval_requests
           (id, org_id, thread_id, agent_id, action, status,
            call_chain, proposed_models, data_scope, estimated_tokens, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'paused', $6, $7, $8::jsonb, $9, $10)`,
        [
          input.id, orgId, input.threadId, input.agentId, input.action,
          input.callChain, input.proposedModels, JSON.stringify(input.dataScope),
          input.estimatedTokens, input.expiresAt,
        ],
      );
      const row = await this.loadApprovalRequestRow(s, orgId, input.id);
      // 刚写完自己的行，找不到就是仓储自身出了问题——不是业务分支，抛比返回 null 更诚实。
      if (row === null) throw new Error("createApprovalRequest: row vanished after insert");
      return row;
    });
  }

  async findApprovalRequest(orgId: OrgId, requestId: string): Promise<ApprovalRequestRow | null> {
    return this.db.withTenant(orgId, (s) => this.loadApprovalRequestRow(s, orgId, requestId));
  }

  /** 见 `ports.ts` 上的注释：乐观并发与 I-30 的「原请求字节不变」都在这一个方法里体现。 */
  async decideApprovalRequest(
    orgId: OrgId,
    requestId: string,
    write: ApprovalDecisionWrite,
  ): Promise<ApprovalRequestRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      let updated: { rows: unknown[] };
      switch (write.kind) {
        case "expire":
          updated = await s.query(
            `UPDATE chat_approval_requests SET status = 'expired'
              WHERE id = $1 AND org_id = $2 AND status = 'paused' RETURNING id`,
            [requestId, orgId],
          );
          break;
        case "approve":
          updated = await s.query(
            `UPDATE chat_approval_requests
                SET status = 'approved', decided_by = $3, decided_at = now(), task_id = $4
              WHERE id = $1 AND org_id = $2 AND status = 'paused' RETURNING id`,
            [requestId, orgId, write.decidedBy, write.taskId],
          );
          break;
        case "decline":
          updated = await s.query(
            `UPDATE chat_approval_requests
                SET status = 'declined', decided_by = $3, decided_at = now()
              WHERE id = $1 AND org_id = $2 AND status = 'paused' RETURNING id`,
            [requestId, orgId, write.decidedBy],
          );
          break;
        case "reparam":
          // ⚠ 原请求**只改 `status` 与 `superseded_by_request_id`**——I-30 要求它的六项
          //   披露字段字节不变，这里没有任何 UPDATE 触碰 call_chain/proposed_models/
          //   data_scope/estimated_tokens/expires_at。
          updated = await s.query(
            `UPDATE chat_approval_requests
                SET status = 'reparamed', decided_by = $3, decided_at = now(),
                    superseded_by_request_id = $4
              WHERE id = $1 AND org_id = $2 AND status = 'paused' RETURNING id`,
            [requestId, orgId, write.decidedBy, write.newRequest.id],
          );
          if (updated.rows.length > 0) {
            await s.query(
              `INSERT INTO chat_approval_requests
                 (id, org_id, thread_id, agent_id, action, status,
                  call_chain, proposed_models, data_scope, estimated_tokens, expires_at,
                  supersedes_request_id)
               VALUES ($1, $2, $3, $4, $5, 'paused', $6, $7, $8::jsonb, $9, $10, $11)`,
              [
                write.newRequest.id, orgId, write.newRequest.threadId, write.newRequest.agentId,
                write.newRequest.action, write.newRequest.callChain, write.newRequest.proposedModels,
                JSON.stringify(write.newRequest.dataScope), write.newRequest.estimatedTokens,
                write.newRequest.expiresAt, requestId,
              ],
            );
          }
          break;
      }
      if (updated.rows.length === 0) return null;
      return this.loadApprovalRequestRow(s, orgId, requestId);
    });
  }

  async createBackgroundTask(orgId: OrgId, input: NewBackgroundTaskInput): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_background_tasks (id, org_id, approval_request_id, status, eta_minutes)
         VALUES ($1, $2, $3, 'running', $4)`,
        [input.taskId, orgId, input.approvalRequestId, input.etaMinutes],
      );
    });
  }

  async findBackgroundTask(orgId: OrgId, taskId: string): Promise<BackgroundTaskRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ status: string; result_message_id: string | null }>(
        "SELECT status, result_message_id FROM chat_background_tasks WHERE id = $1 AND org_id = $2",
        [taskId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        taskId,
        status: row.status as BackgroundTaskRow["status"],
        resultMessageId: row.result_message_id,
      };
    });
  }

  private async loadApprovalRequestRow(
    s: TenantSession,
    orgId: OrgId,
    requestId: string,
  ): Promise<ApprovalRequestRow | null> {
    const r = await s.query<{
      id: string;
      thread_id: string;
      agent_id: string;
      action: string;
      status: string;
      call_chain: string[];
      proposed_models: string[];
      data_scope: ApprovalDataScopeRow[];
      estimated_tokens: number;
      expires_at: Date;
      task_id: string | null;
      supersedes_request_id: string | null;
      superseded_by_request_id: string | null;
    }>(
      `SELECT id, thread_id, agent_id, action, status, call_chain, proposed_models, data_scope,
              estimated_tokens, expires_at, task_id, supersedes_request_id, superseded_by_request_id
         FROM chat_approval_requests WHERE id = $1 AND org_id = $2`,
      [requestId, orgId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      threadId: row.thread_id,
      agentId: row.agent_id,
      action: row.action,
      status: row.status as ApprovalRequestRow["status"],
      callChain: row.call_chain,
      proposedModels: row.proposed_models,
      dataScope: row.data_scope,
      estimatedTokens: row.estimated_tokens,
      expiresAt: row.expires_at.toISOString(),
      taskId: row.task_id,
      supersedesRequestId: row.supersedes_request_id,
      supersededByRequestId: row.superseded_by_request_id,
    };
  }
}

function toAgentPanelAgent(row: AgentRosterDbRow) {
  return {
    id: row.agent_id,
    abbr: row.abbr,
    name: row.name,
    duty: row.duty,
    // #1705：NULL（走「能力目录」admin 表单造的、还没有 role_label 的旧行）回退到
    // `duty`——面板永远有一句可显示的角色文案，不因为某条独立写路径没填这个字段
    // 就让 I-17 style 的非空断言炸出 500。`duty` 已经是这一行**保证非空**的字段
    // （既有 `capability_listings_agent_needs_abbr_duty` CHECK），是诚实的兜底，
    // 不是编造的文本。
    roleLabel: row.role_label ?? row.duty,
    presence: row.presence as AgentPresenceValue,
  };
}
