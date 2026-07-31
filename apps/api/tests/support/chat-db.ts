/**
 * F108 的对话夹具。
 *
 * 和 `db.ts` 一样以 **app 角色**在租户事务里写入，不以属主写：
 * 若某条策略的 WITH CHECK 写错了，属主插入照样成功，而测试就建立在
 * 生产永远写不出来的数据上——那种绿灯什么都没证明。
 */
import { asApp } from "./db";

export async function addChatThread(opts: {
  orgId: string;
  id: string;
  projectId: string;
  groupId?: string | null;
  visibilityScope: string;
  createdBy: string;
  phase?: "onsite" | "research";
  archived?: boolean;
  agentPrivate?: boolean;
  /** 只有反证用得上：正常路径不该能写别的值（I-9）。 */
  ownershipLayer?: string;
  /** F109。缺省空串 —— 0029 给的就是这个默认值。 */
  title?: string;
  /** F109：分组用（今天 / 本周 / 本周之前）。缺省 now()。 */
  lastActivityAt?: Date;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_threads
         (id, org_id, project_id, group_id, visibility_scope, phase, archived,
          ownership_layer, agent_private, created_by, title, last_activity_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()))`,
      [
        opts.id, opts.orgId, opts.projectId, opts.groupId ?? null, opts.visibilityScope,
        opts.phase ?? "onsite", opts.archived ?? false, opts.ownershipLayer ?? "project",
        opts.agentPrivate ?? false, opts.createdBy, opts.title ?? "",
        opts.lastActivityAt ?? null,
      ],
    ),
  );
}

/**
 * F109 / I-14：一个**真实的**转录会话。
 *
 * 这个夹具存在的全部意义是让「最后消息很新 + 转录已停」构造得出来。
 * 没有它，按最后消息时间推断徽标的实现在任何测试下都是绿的。
 */
export async function addTranscriptSession(opts: {
  orgId: string;
  id: string;
  threadId: string;
  stopped?: boolean;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_transcript_sessions (id, org_id, thread_id, stopped_at)
       VALUES ($1,$2,$3,$4)`,
      [opts.id, opts.orgId, opts.threadId, opts.stopped === true ? new Date() : null],
    ),
  );
}

/**
 * F111：一条落库的引用（`chat_citations`）。
 *
 * ⚠ 与其余夹具同一个纪律（`addChatThread` / `addChatMessage` 文件头）：以 app 角色写，
 *   不以属主写——若某条 RLS 策略的 `WITH CHECK` 写错了，属主插入照样成功，
 *   测试就建立在生产永远写不出来的数据上。
 */
export async function addChatCitation(opts: {
  orgId: string;
  citationId: string;
  messageId: string;
  index: number;
  sourceFullName: string;
  anchorKind: "page" | "transcript" | "message";
  anchorPage?: number | null;
  anchorRange?: string | null;
  anchorMessageId?: string | null;
  sourceArtifactId?: string | null;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_citations
         (citation_id, org_id, message_id, idx, source_full_name, anchor_kind,
          anchor_page, anchor_range, anchor_message_id, source_artifact_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opts.citationId, opts.orgId, opts.messageId, opts.index, opts.sourceFullName,
        opts.anchorKind, opts.anchorPage ?? null, opts.anchorRange ?? null,
        opts.anchorMessageId ?? null, opts.sourceArtifactId ?? null,
      ],
    ),
  );
}

export async function addChatMessage(opts: {
  orgId: string;
  id: string;
  threadId: string;
  body: string;
  authorId: string;
  authorKind?: "human" | "agent";
  agentId?: string | null;
  rawTranscript?: boolean;
  visibilityScope?: string | null;
  /** F109 / I-13：「待复核」的唯一事实源。 */
  reviewPending?: boolean;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_messages
         (id, org_id, thread_id, author_kind, author_id, agent_id, body, raw_transcript,
          visibility_scope, review_pending)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opts.id, opts.orgId, opts.threadId, opts.authorKind ?? "human", opts.authorId,
        opts.agentId ?? null, opts.body, opts.rawTranscript ?? false, opts.visibilityScope ?? null,
        opts.reviewPending ?? false,
      ],
    ),
  );
}
