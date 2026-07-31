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
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_threads
         (id, org_id, project_id, group_id, visibility_scope, phase, archived,
          ownership_layer, agent_private, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opts.id, opts.orgId, opts.projectId, opts.groupId ?? null, opts.visibilityScope,
        opts.phase ?? "onsite", opts.archived ?? false, opts.ownershipLayer ?? "project",
        opts.agentPrivate ?? false, opts.createdBy,
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
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO chat_messages
         (id, org_id, thread_id, author_kind, author_id, agent_id, body, raw_transcript, visibility_scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        opts.id, opts.orgId, opts.threadId, opts.authorKind ?? "human", opts.authorId,
        opts.agentId ?? null, opts.body, opts.rawTranscript ?? false, opts.visibilityScope ?? null,
      ],
    ),
  );
}
