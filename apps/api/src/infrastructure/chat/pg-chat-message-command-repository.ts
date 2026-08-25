import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";
import type {
  AcceptedHumanMessage, AcceptMessageOutcome, ChatMessageCommandRepository, MessageAttachment,
  DefaultAgentResolver, MessagePageRow, PublishedAgentReader, PublishedAgentSnapshot,
} from "../../application/chat/message-command-ports";
import { agentDefaults } from "@repo/contracts";
import { DEEP_AGENT_PROVIDER_NAME } from "../agent-run/deep-agent-model-provider";
import { AttachmentNotPendingError } from "../../application/chat/message-command-ports";

interface AcceptedDbRow {
  id: string; thread_id: string; author_id: string; body: string; client_message_id: string;
  requested_agent_id: string; created_at: Date; agent_run_id: string; status: string;
}

function accepted(row: AcceptedDbRow): AcceptedHumanMessage {
  return {
    id: row.id, threadId: row.thread_id, authorId: row.author_id, text: row.body,
    clientMessageId: row.client_message_id, requestedAgentId: row.requested_agent_id,
    createdAt: row.created_at.toISOString(), agentRunId: row.agent_run_id, runStatus: "queued",
  };
}

async function findAcceptedIn(
  s: TenantSession,
  orgId: OrgId,
  input: { threadId: string; actorId: string; clientMessageId: string },
): Promise<AcceptedHumanMessage | null> {
  const result = await s.query<AcceptedDbRow>(
    `SELECT m.id, m.thread_id, m.author_id, m.body, m.client_message_id::text,
            m.requested_agent_id, m.created_at, r.id AS agent_run_id, r.status
       FROM chat_messages m JOIN agent_runs r ON r.input_message_id=m.id AND r.org_id=m.org_id
      WHERE m.org_id=$1 AND m.thread_id=$2 AND m.author_id=$3 AND m.client_message_id=$4::uuid`,
    [orgId, input.threadId, input.actorId, input.clientMessageId],
  );
  return result.rows[0] ? accepted(result.rows[0]) : null;
}

export class PgChatMessageCommandRepository implements ChatMessageCommandRepository {
  constructor(private readonly db: DatabasePort) {}

  async findAccepted(
    orgId: OrgId,
    input: { projectId: string | null; threadId: string; actorId: string; clientMessageId: string },
  ) {
    const row = await this.db.withTenant(orgId, (s) => findAcceptedIn(s, orgId, input));
    // #594：ref 的 id 只是 Guarded 的描述性元数据（discloseDecided 不查它），
    // 个人线程没有真实 projectId 时用一个恒无绑定行的合成 id，同 resolve-visibility.ts 的先例。
    return guard({ kind: "project", id: input.projectId ?? `personal:${input.actorId}` }, row);
  }

  async accept(
    orgId: OrgId,
    input: {
      projectId: string | null; threadId: string; actorId: string; clientMessageId: string; text: string;
      selectedAgentId: string; messageId: string; runId: string; snapshot: PublishedAgentSnapshot;
      attachmentIds?: readonly string[];
    },
  ) {
    const outcome = await this.db.withTenant(orgId, async (s): Promise<AcceptMessageOutcome> => {
      // JSON is an unambiguous composite key and contains no NUL byte (PostgreSQL text rejects NUL).
      const key = JSON.stringify([orgId, input.threadId, input.actorId, input.clientMessageId]);
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      const replay = await findAcceptedIn(s, orgId, input);
      if (replay) {
        return replay.text === input.text && replay.requestedAgentId === input.selectedAgentId
          ? { kind: "replay", accepted: replay }
          : { kind: "conflict" };
      }
      const inserted = await s.query<{ created_at: Date }>(
        `INSERT INTO chat_messages
           (id,org_id,thread_id,author_kind,author_id,body,client_message_id,requested_agent_id)
         VALUES ($1,$2,$3,'human',$4,$5,$6::uuid,$7)
         RETURNING created_at`,
        [input.messageId, orgId, input.threadId, input.actorId, input.text,
          input.clientMessageId, input.selectedAgentId],
      );
      await s.query(
        `INSERT INTO agent_runs
           (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,
            model_provider,model_id,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'queued')`,
        [input.runId, orgId, input.threadId, input.messageId, input.snapshot.agentId,
          input.snapshot.agentVersionId, JSON.stringify(input.snapshot.skillVersionIds),
          input.snapshot.modelProvider, input.snapshot.modelId],
      );
      // #414 delta §5: `accepted` is the run's first append-only step, and acceptance is
      // where it happens -- inside this same transaction. Writing it later, when the
      // executor claims the run, would leave a queued run showing an empty step list and
      // make "accepted" a claim about a moment nothing recorded.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,input_digest)
         VALUES ($1,$2,$3,1,'accepted','succeeded',$4::timestamptz,$4::timestamptz,$5)`,
        [randomUUID(), orgId, input.runId, inserted.rows[0]!.created_at.toISOString(),
          createHash("sha256").update(input.text).digest("hex")],
      );
      // #946 · V9-a F151：把 pending 附件挂到本消息上——**同一事务**内 set message_id。
      // WHERE 同时约束 thread_id + message_id IS NULL：不属本线程 / 已挂过别的消息 / 不存在
      // 的 id 都不匹配，更新数 < 期望数 ⇒ 抛错回滚整条消息写入（消息与挂附件原子）。
      // 并发两条消息抢同一 pending 行时，PG 行锁串行化：先提交者置上 message_id，后者更新数
      // 不足 ⇒ 同样回滚（不会双挂）。
      if (input.attachmentIds && input.attachmentIds.length > 0) {
        const updated = await s.query<{ id: string }>(
          `UPDATE chat_message_attachments
              SET message_id = $1
            WHERE org_id = $2 AND thread_id = $3 AND message_id IS NULL
              AND id = ANY($4::text[])
          RETURNING id`,
          [input.messageId, orgId, input.threadId, input.attachmentIds],
        );
        // 更新数 = 去重后期望数才算全挂上；否则有 id 不合格 ⇒ 抛错回滚整条消息。
        if (updated.rows.length !== input.attachmentIds.length) throw new AttachmentNotPendingError();
      }
      return {
        kind: "created",
        accepted: {
          id: input.messageId, threadId: input.threadId, authorId: input.actorId,
          text: input.text, clientMessageId: input.clientMessageId,
          requestedAgentId: input.selectedAgentId,
          createdAt: inserted.rows[0]!.created_at.toISOString(),
          agentRunId: input.runId, runStatus: "queued",
        },
      };
    });
    return guard({ kind: "project", id: input.projectId ?? `personal:${input.actorId}` }, outcome);
  }

  async attachmentsByMessage(
    orgId: OrgId,
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MessageAttachment[]>> {
    const out = new Map<string, MessageAttachment[]>();
    if (messageIds.length === 0) return out;
    await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        message_id: string; id: string; filename: string; mime: string; bytes: string; created_at: Date;
      }>(
        `SELECT message_id, id, filename, mime, bytes, created_at
           FROM chat_message_attachments
          WHERE org_id = $1 AND message_id = ANY($2::text[])
          ORDER BY created_at ASC, id ASC`,
        [orgId, messageIds],
      );
      for (const row of r.rows) {
        const list = out.get(row.message_id) ?? [];
        // bytes 是 bigint（pg 回字符串）——转成 number（≤25MB 远在安全整数内）。
        list.push({
          id: row.id, filename: row.filename, mime: row.mime,
          bytes: Number(row.bytes), createdAt: row.created_at.toISOString(),
        });
        out.set(row.message_id, list);
      }
    });
    return out;
  }

  async page(
    orgId: OrgId,
    input: {
      projectId: string | null; threadId: string;
      after: { createdAt: string; messageId: string } | null; limit: number;
    },
  ) {
    const page = await this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{
        id: string; author_kind: "human" | "agent"; author_id: string; agent_id: string | null;
        body: string; client_message_id: string | null; agent_run_id: string | null;
        reply_to_message_id: string | null; raw_transcript: boolean;
        visibility_scope: string | null; created_at: Date;
      }>(
        // #1805：chat_messages.agent_run_id 只在 author_kind='agent' 时写入（写回幂等索引
        // 就是拿这条语义定的，见 20260804060000_wave2_chat_message_acceptance.sql:16-18），
        // 所以人类消息这一列在 DB 里恒为 NULL——但触发它的那个 run 仍然可查：
        // agent_runs.input_message_id 是 NOT NULL + UNIQUE(org_id, input_message_id)，
        // 一条人类消息至多对应一个 run。COALESCE 回填后，人类消息也能带出它触发的 runId，
        // 前端才有办法在页面刷新/重连后凭这个字段恢复轮询（而不是只信内存 state）。
        `SELECT m.id,m.author_kind,m.author_id,m.agent_id,m.body,m.client_message_id::text,
                COALESCE(m.agent_run_id, r.id) AS agent_run_id,
                m.reply_to_message_id,m.raw_transcript,m.visibility_scope,m.created_at
           FROM chat_messages m
           LEFT JOIN agent_runs r ON r.org_id = m.org_id AND r.input_message_id = m.id
          WHERE m.org_id=$1 AND m.thread_id=$2
            AND ($3::timestamptz IS NULL OR (m.created_at,m.id) > ($3::timestamptz,$4::text))
          ORDER BY m.created_at ASC, m.id ASC LIMIT $5`,
        [orgId, input.threadId, input.after?.createdAt ?? null,
          input.after?.messageId ?? null, input.limit + 1],
      );
      const hasMore = result.rows.length > input.limit;
      return {
        hasMore,
        rows: result.rows.slice(0, input.limit).map((row): MessagePageRow => ({
          id: row.id, authorKind: row.author_kind, authorId: row.author_id,
          agentId: row.agent_id, text: row.body, clientMessageId: row.client_message_id,
          agentRunId: row.agent_run_id, replyToMessageId: row.reply_to_message_id,
          rawTranscript: row.raw_transcript, visibilityScope: row.visibility_scope,
          createdAt: row.created_at.toISOString(),
        })),
      };
    });
    return guard({ kind: "project", id: input.projectId ?? `personal:${input.threadId}` }, page);
  }
}

/**
 * Narrow #417 consumer adapter. Until #417 lands, absent catalog tables fail closed as an
 * unknown/unpublished Agent; no message/run write has happened at that point.
 */
export class PgPublishedAgentReader implements PublishedAgentReader, DefaultAgentResolver {
  private readonly schema: string;

  constructor(private readonly db: DatabasePort, schema = "public") {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("invalid_agent_catalog_schema");
    this.schema = schema;
  }

  resolvePublished(orgId: OrgId, agentId: string): Promise<PublishedAgentSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const tables = await s.query<{ ready: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS ready",
        [`${this.schema}.agents`, `${this.schema}.agent_versions`],
      );
      if (!tables.rows[0]?.ready) return null;
      const result = await s.query<{
        agent_id: string; agent_version_id: string; skill_version_ids: unknown;
        model_provider: string; model_id: string; instructions: string;
      }>(
        `SELECT a.id AS agent_id, v.id AS agent_version_id, v.skill_version_ids,
                v.model_provider, v.model_id, v.instructions
           FROM "${this.schema}".agents a JOIN "${this.schema}".agent_versions v
             ON v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id
          WHERE a.org_id=$1 AND a.id=$2 AND a.status='enabled' AND v.published_at IS NOT NULL`,
        [orgId, agentId],
      );
      const row = result.rows[0];
      if (!row || !Array.isArray(row.skill_version_ids) ||
          !row.skill_version_ids.every((id) => typeof id === "string")) return null;
      return {
        agentId: row.agent_id, agentVersionId: row.agent_version_id,
        skillVersionIds: row.skill_version_ids as string[],
        modelProvider: row.model_provider, modelId: row.model_id,
        instructions: row.instructions,
      };
    });
  }

  /**
   * #2038 —— 见 `DefaultAgentResolver` 端口文档：三级确定性排序（系统预置「通用助手」
   * stable_name → deep-agent provider → created_at/id 最早），与 `resolvePublished`
   * 同一个 JOIN 形状（enabled + published_at 非空），保证解析出来的 id 回头喂给
   * `resolvePublished` 必然命中——不会推荐一个自己都跑不了的默认。
   */
  resolveDefaultAgentId(orgId: OrgId): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const tables = await s.query<{ ready: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS ready",
        [`${this.schema}.agents`, `${this.schema}.agent_versions`],
      );
      if (!tables.rows[0]?.ready) return null;
      const result = await s.query<{ agent_id: string }>(
        `SELECT a.id AS agent_id
           FROM "${this.schema}".agents a JOIN "${this.schema}".agent_versions v
             ON v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id
          WHERE a.org_id=$1 AND a.status='enabled' AND v.published_at IS NOT NULL
          ORDER BY COALESCE(a.stable_name = $2, false) DESC,
                   COALESCE(v.model_provider = $3, false) DESC,
                   a.created_at ASC, a.id ASC
          LIMIT 1`,
        [orgId, agentDefaults.DEFAULT_AGENT_STABLE_NAME, DEEP_AGENT_PROVIDER_NAME],
      );
      return result.rows[0]?.agent_id ?? null;
    });
  }
}
