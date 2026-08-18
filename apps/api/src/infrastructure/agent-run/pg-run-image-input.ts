/**
 * `RunImagePort` 的实现（P2 / #1561）：Postgres 查元数据 + 既有 `ObjectStore` 取字节。
 *
 * ## 权限在 WHERE 里，且范围比 L3 还窄一档
 *
 * 同 `pg-file-retrieval.ts` 立下的那条纪律（"不是『召回了再过滤』，是查询本身就不出这些
 * 行"），`RunImageScope` 的三个字段全部编译进下面的谓词。区别在于范围：L3 会跨线程召回
 * 同项目的全场线程文件，这里**只**取触发本次 run 的那一条消息自己挂的附件，并且要求那条
 * 消息的作者就是 run 的请求者。换句话说，这条读路径读到的东西，是 run 早就合法持有的
 * 那批附件元数据（`ClaimedAgentRun.inputAttachments`，由同一张表按同一个 `message_id`
 * 聚合而来）对应的字节——**没有新增任何一个可见面**，见 `run-image-input.ts` 头注。
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

interface ImageRow {
  id: string;
  filename: string;
  mime: string;
  bytes: number | string;
  storage_ref: string;
}

/** `$1` orgId · `$2` threadId · `$3` messageId · `$4` actorUserId · `$5` 允许的 mime 数组 */
const LIST_SQL = `
SELECT a.id, a.filename, a.mime, a.bytes, a.storage_ref
  FROM chat_message_attachments a
  JOIN chat_messages m ON m.id = a.message_id AND m.org_id = a.org_id
 WHERE a.org_id = $1
   AND a.thread_id = $2
   AND a.message_id = $3
   AND m.author_id = $4
   AND a.mime = ANY($5::text[])
 ORDER BY a.created_at, a.id`;

/** `$1` orgId · `$2` threadId · `$3` messageId · `$4` actorUserId · `$5` attachmentId */
const READ_REF_SQL = `
SELECT a.storage_ref
  FROM chat_message_attachments a
  JOIN chat_messages m ON m.id = a.message_id AND m.org_id = a.org_id
 WHERE a.org_id = $1
   AND a.thread_id = $2
   AND a.message_id = $3
   AND m.author_id = $4
   AND a.id = $5`;

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
      return r.rows.map((row): RunImageRef => ({
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
      const r = await s.query<{ storage_ref: string }>(READ_REF_SQL, [
        orgId, scope.threadId, scope.messageId, scope.actorUserId, attachmentId,
      ]);
      return r.rows[0]?.storage_ref ?? null;
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
