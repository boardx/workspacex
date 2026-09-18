/**
 * `RunImagePort` 的实现（P2 / #1561）：Postgres 查元数据 + 既有 `ObjectStore` 取字节。
 *
 * ## 权限在 WHERE 里，且范围比 L3 还窄一档
 *
 * 同 `pg-file-retrieval.ts` 立下的那条纪律（"不是『召回了再过滤』，是查询本身就不出这些
 * 行"），`RunImageScope` 的三个字段全部编译进下面的谓词。区别在于范围：L3 会跨线程召回
 * 同项目的全场线程文件，这里只取触发本次 run 的那一条消息自己挂的附件，并且要求那条
 * 消息的作者就是 run 的请求者。换句话说，这条读路径读到的东西，是 run 早就合法持有的
 * 那批附件元数据（`ClaimedAgentRun.inputAttachments`，由同一张表按同一个 `message_id`
 * 聚合而来）对应的字节——**没有新增任何一个可见面**，见 `run-image-input.ts` 头注。
 *
 * ## issue #3727：正文里 `@<filename>` 点名的历史附件也在范围内
 *
 * composer 的 `@` 只把文件名当文本插进正文，run 侧此前从不把它翻译回附件——用户 @ 了
 * 上一轮的截图，模型这一轮看不到（devapp 实测）。现在 `a.message_id = $3` 之外多一个
 * OR 分支：同线程、**同作者**、人类消息上、且触发消息正文里出现 `@<filename>` 的附件。
 * 可见面仍是"这个用户自己在这个线程里传过的东西"，作者锚 `m.author_id = $4` 对两个分支
 * 同时生效；词边界与"同名取最新"由 `domain/chat/attachment-mentions.ts` 纯函数决定。
 * 跨作者 / 跨线程的图仍然取不到（`GAP-VISION-CROSS-TURN-IMAGES` 只关掉了"同作者同线程"这一半）。
 *
 * `chat_messages.author_id = $4` 这一条不是冗余：它把「run 的请求者」与「消息作者」的
 * 一致性变成查询条件本身。今天 `ClaimedAgentRun.requesterUserId` 恰恰取自这个列（见其
 * 文档），所以这个谓词永远为真——它存在是为了**将来某天不再为真的时候查询会自己收口**，
 * 而不是靠一条注释提醒后来的人别忘了判权。
 *
 * ## mime 过滤在 SQL 里，定界在纯函数里
 *
 * SQL 只负责"哪些行属于这次 run 且是图片"，"送几张 / 哪几张送不了"由
 * `selectImagesWithinBounds` 这个纯函数决定——那部分要能被单测直接钉住，且它的产物
 * （每张没送的图的具体原因）要逐字进模型可读文本，不适合藏在 SQL 的 LIMIT 里。
 * SQL 侧刻意**不加 LIMIT**：加了就变成"静默截断"，恰恰是 #1561 明文禁止的那件事。
 */
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type { ObjectStore } from "../../application/artifact/ports";
import type {
  RunImagePort, RunImageRef, RunImageScope,
} from "../../application/agent-run/run-image-input";
import { MODEL_CALL_IMAGE_MIMES } from "../../application/agent-run/ports";
import { selectRunScopedAttachments } from "../../domain/chat/attachment-mentions";

interface ImageRow {
  id: string;
  filename: string;
  mime: string;
  bytes: number | string;
  storage_ref: string;
  message_id: string | null;
  created_at: string | Date;
}

/*
 * `@` 分支里的子查询取触发消息自己的正文。它与 `RunImageScope` 三个锚同源（同一条
 * `chat_messages` 行），所以取它不需要新的判权：作者锚 `i.author_id = $4` 同样编译在里面。
 * 两条 SQL 里逐字写两遍而不是插值，是为了让 `run-image-input-repo-guard.test.ts`
 * 能对**最终的 SQL 文本**断言锚点（插值占位符会让断言看不到它）。
 */
/** `$1` orgId · `$2` threadId · `$3` messageId · `$4` actorUserId · `$5` 允许的 mime 数组 */
const LIST_SQL = `
SELECT a.id, a.filename, a.mime, a.bytes, a.storage_ref, a.message_id, a.created_at
  FROM chat_message_attachments a
  JOIN chat_messages m ON m.id = a.message_id AND m.org_id = a.org_id
 WHERE a.org_id = $1
   AND a.thread_id = $2
   AND m.author_id = $4
   AND m.author_kind = 'human'
   AND (a.message_id = $3 OR position('@' || a.filename IN (SELECT i.body FROM chat_messages i WHERE i.org_id = $1 AND i.thread_id = $2 AND i.id = $3 AND i.author_id = $4)) > 0)
   AND a.mime = ANY($5::text[])
 ORDER BY a.created_at, a.id`;

/** `$1` orgId · `$2` threadId · `$3` messageId · `$4` actorUserId · `$5` attachmentId */
const READ_REF_SQL = `
SELECT a.id, a.filename, a.storage_ref, a.message_id, a.created_at
  FROM chat_message_attachments a
  JOIN chat_messages m ON m.id = a.message_id AND m.org_id = a.org_id
 WHERE a.org_id = $1
   AND a.thread_id = $2
   AND m.author_id = $4
   AND m.author_kind = 'human'
   AND (a.message_id = $3 OR position('@' || a.filename IN (SELECT i.body FROM chat_messages i WHERE i.org_id = $1 AND i.thread_id = $2 AND i.id = $3 AND i.author_id = $4)) > 0)
   AND a.id = $5`;

/** `$1` orgId · `$2` threadId · `$3` messageId · `$4` actorUserId —— 供纯函数做词边界匹配。 */
const BODY_SQL = "SELECT i.body FROM chat_messages i WHERE i.org_id = $1 AND i.thread_id = $2 AND i.id = $3 AND i.author_id = $4";

export class PgRunImageInput implements RunImagePort {
  constructor(
    private readonly db: DatabasePort,
    private readonly store: ObjectStore,
  ) {}

  async list(orgId: OrgId, scope: RunImageScope): Promise<readonly RunImageRef[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ImageRow>(LIST_SQL, [
        orgId, scope.threadId, scope.messageId, scope.actorUserId,
        [...MODEL_CALL_IMAGE_MIMES],
      ]);
      const body = (await s.query<{ body: string }>(BODY_SQL, [orgId, scope.threadId, scope.messageId, scope.actorUserId])).rows[0]?.body ?? "";
      return selectRunScopedAttachments(r.rows, scope.messageId, body).map((row): RunImageRef => ({
        attachmentId: row.id,
        filename: row.filename,
        mime: row.mime,
        // `bytes` 是 bigint，pg 驱动按字符串回传——`Number` 一次，非有限值当 0 处理会让
        // 体积门形同虚设，所以取不到就报一个**大于任何上限**的值，让它被挡下而不是放行。
        byteSize: toByteSize(row.bytes),
      }));
    });
  }

  async read(
    orgId: OrgId,
    scope: RunImageScope,
    attachmentId: string,
  ): Promise<Uint8Array | null> {
    // 取 storage_ref 时**再走一遍同一套谓词**，不是拿 `list` 的结果直接信任：`read` 是
    // 一个独立的公开方法，调用方传什么 attachmentId 都可能。把权限只放在 `list` 里，
    // 等于让「先 list 再 read」这个调用顺序成为判权的一部分——那不是判权，是约定。
    const ref = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Pick<ImageRow, "id" | "filename" | "storage_ref" | "message_id" | "created_at">>(READ_REF_SQL, [
        orgId, scope.threadId, scope.messageId, scope.actorUserId, attachmentId,
      ]);
      const row = r.rows[0];
      if (!row) return null;
      // 历史附件走 `@` 分支时，再过一遍同一个纯函数（词边界），与 list 的判定完全一致。
      if (row.message_id !== scope.messageId) {
        const body = (await s.query<{ body: string }>(BODY_SQL, [orgId, scope.threadId, scope.messageId, scope.actorUserId])).rows[0]?.body ?? "";
        if (selectRunScopedAttachments([row], scope.messageId, body).length === 0) return null;
      }
      return row.storage_ref;
    });
    if (ref === null) return null;
    return this.store.get(ref);
  }
}

/** bigint 列回来的可能是 string。解析不出一个有限非负数 ⇒ 返回 `Infinity`，让体积门挡下
 *  这一张并如实记原因，绝不当作 0 放行（fail closed）。 */
function toByteSize(raw: number | string): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
}
