/**
 * `FileRetrievalPort` 的 PostgreSQL 实现（F155 L3，design delta `context-engine-l3-file-based`）。
 *
 * ## 权限在 WHERE 里，不在返回之后
 *
 * delta §3.1 / verification V4 的原话是「不是『召回了再过滤』，是查询本身就不出这些行」。
 * 所以 `FileRetrievalScope` 的三个字段全部编译进下面的 SQL 谓词；本文件**不做**任何
 * 事后 filter，也**不新增**第二套权限模型——它复用的是既有事实表：
 *   · 租户隔离 → `withTenant` 的 RLS（`app.current_org`），同本仓每一条读路径；
 *   · 项目成员资格 → `project_memberships`（`resolveVisibility` 判项目线程时读的同一张表）；
 *   · 个人线程 → `project_id IS NULL ∧ created_by = actor`（#594 起的既有语义，
 *     也是 F156 delta 已签的受限召回边界）。
 *
 * ## 项目线程的范围**刻意收窄**（fail closed），并具名登记
 *
 * 项目线程侧只召回：**本线程** ∪ **同项目的 `plenary`（全场）非 agent 私聊线程**。
 * 完整的两层可见性判定（member-private / group-shared 要读 group 归属与组长身份）住在
 * `domain/chat/thread-visibility.ts`，把它整段搬进这条 SQL 就是在造第二套判权——AGENTS.md
 * 点名的那种漂移。收窄的方向是**少召回**：受限线程的文件不进上下文，绝不会多给。
 * 具名缺口 `GAP-CE-FTS-SCOPE-GROUP-VISIBILITY`：组内共享/组员私聊线程的文件今天召不回来，
 * 要接就得让判权先能以「批量谓词」的形态被复用，不是在这里抄一份。
 *
 * ## 为什么把 `plainto_tsquery` 的 AND 改成 OR
 *
 * `plainto_tsquery` 把输入的每个 token 用 `&` 连起来——一句自然语言提问里只要有一个词没出现
 * 在文件里，整份文件就命中不了，召回率会塌到接近 0。这里把连接符换成 `|`（OR），相关性交给
 * `ts_rank` 排序（命中词越多分越高）。改的是**已经由 `plainto_tsquery` 清洗过**的 tsquery 的
 * 文本形态，不是把用户输入拼进 SQL——注入面为零。
 */
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  FileRetrievalHit, FileRetrievalPort, FileRetrievalScope,
} from "../../application/agent-run/file-retrieval";

export interface FileSourceRow {
  source_record_id: string; thread_id: string; message_id: string; project_id: string | null;
  extracted_ref: string | null;
}

interface HitRow extends FileSourceRow {
  kind: string;
  title: string | null;
  text: string | null;
  rank: number | string;
}

/**
 * `$1` orgId · `$2` query · `$3` threadId · `$4` projectId(nullable) · `$5` actorUserId · `$6` limit
 *
 * 两类「文件」各一条 SELECT，UNION ALL 后统一按 `ts_rank` 排序——刻意**不**做任何融合/重排
 * （那是五路召回引擎的事，本 delta §2 明确不动它、也不模仿它）。
 */
const SEARCH_SQL = `
WITH q AS (
  -- plainto_tsquery 已完成清洗与分词；这里只把它的 AND 连接改成 OR（见文件头注）。
  SELECT replace(plainto_tsquery('simple', $2)::text, '&', '|')::tsquery AS tsq
)
SELECT 'chat-attachment' AS kind, a.filename AS title, a.extracted_excerpt AS text,
       a.id AS source_record_id, a.thread_id, a.message_id, t.project_id, a.extracted_ref,
       ts_rank(a.search_tsv, q.tsq) AS rank
  FROM chat_message_attachments a
  JOIN chat_threads t ON t.id = a.thread_id AND t.org_id = a.org_id
  CROSS JOIN q
 WHERE a.org_id = $1
   -- 只召回**真的抽出了正文**的附件：pending/failed/unsupported 没有可检索内容，
   -- 把它们放进来只会让「召回了一份读不出内容的文件」污染上下文。
   AND a.extraction_status = 'extracted'
   AND a.extracted_excerpt IS NOT NULL
   AND a.search_tsv @@ q.tsq
   AND (
     ($4::text IS NULL
        AND t.id = $3 AND t.project_id IS NULL AND t.created_by = $5)
     OR
     ($4::text IS NOT NULL
        AND t.project_id = $4
        AND (t.id = $3 OR (t.visibility_scope = 'plenary' AND t.agent_private = false))
        AND EXISTS (SELECT 1 FROM project_memberships pm
                     WHERE pm.org_id = t.org_id AND pm.project_id = $4 AND pm.user_id = $5))
   )
UNION ALL
SELECT 'canvas-artifact' AS kind, l.title AS title, l.content_excerpt AS text,
       l.id AS source_record_id, l.thread_id, l.message_id, t.project_id, NULL::text AS extracted_ref,
       ts_rank(l.search_tsv, q.tsq) AS rank
  FROM chat_artifact_landings l
  JOIN chat_threads t ON t.id = l.thread_id AND t.org_id = l.org_id
  CROSS JOIN q
 WHERE l.org_id = $1
   AND l.content_excerpt IS NOT NULL
   AND l.search_tsv @@ q.tsq
   AND (
     ($4::text IS NULL
        AND t.id = $3 AND t.project_id IS NULL AND t.created_by = $5)
     OR
     ($4::text IS NOT NULL
        AND t.project_id = $4
        AND (t.id = $3 OR (t.visibility_scope = 'plenary' AND t.agent_private = false))
        AND EXISTS (SELECT 1 FROM project_memberships pm
                     WHERE pm.org_id = t.org_id AND pm.project_id = $4 AND pm.user_id = $5))
   )
 ORDER BY rank DESC, title ASC
 LIMIT $6`;

export class PgFileRetrieval implements FileRetrievalPort {
  constructor(private readonly db: DatabasePort) {}

  /** Same retrieval predicates and SQL as legacy search; exposes actual storage identity internally. */
  async searchSources(orgId: OrgId, scope: FileRetrievalScope, query: string, limit: number): Promise<readonly HitRow[]> {
    if (limit <= 0 || query.trim() === "") return [];
    return this.db.withTenant(orgId, async s => (await s.query<HitRow>(SEARCH_SQL, [
      orgId, query, scope.threadId, scope.projectId, scope.actorUserId, limit,
    ])).rows);
  }

  /** Exact source lookup retains the same restricted scope; it cannot broaden search visibility. */
  async findAttachmentSource(orgId: OrgId, scope: FileRetrievalScope, id: string): Promise<HitRow | null> {
    const sql = SEARCH_SQL.replace('a.search_tsv @@ q.tsq', 'a.id = $7')
      .replace('l.search_tsv @@ q.tsq', 'false');
    return this.db.withTenant(orgId, async s => (await s.query<HitRow>(sql, [
      orgId, '', scope.threadId, scope.projectId, scope.actorUserId, 1, id,
    ])).rows[0] ?? null);
  }

  async search(
    orgId: OrgId,
    scope: FileRetrievalScope,
    query: string,
    limit: number,
  ): Promise<readonly FileRetrievalHit[]> {
    if (limit <= 0 || query.trim() === "") return [];
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<HitRow>(SEARCH_SQL, [
        orgId, query, scope.threadId, scope.projectId, scope.actorUserId, limit,
      ]);
      return result.rows
        .map((row): FileRetrievalHit | null => {
          if (row.text === null || row.text === "") return null;
          if (row.kind !== "chat-attachment" && row.kind !== "canvas-artifact") return null;
          return {
            kind: row.kind,
            title: row.title ?? "",
            text: row.text,
            rank: typeof row.rank === "number" ? row.rank : Number(row.rank),
          };
        })
        .filter((h): h is FileRetrievalHit => h !== null);
    });
  }
}
