/**
 * F176 —— 消息级评价的 PostgreSQL 适配器（F68 契约的地基）。
 *
 * 实现三个端口：`RatingRepositoryPort`（幂等查 + 落库 + 按 skill 列出）、
 * `DataQualityReportPort`（E1 的报表落点）、`MessageAttributionPort`（服务端归因）。
 * 落到 `message_ratings` / `rating_data_quality_entries`
 * （迁移 `20260814120000_f176_message_ratings.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，本文件没有 `withoutTenant`——业务仓储用它
 *   等于关掉 RLS 后读到「没有数据」而不是报错（同 `pg-thread-mount-store.ts`）。
 * ⚠ 每个 WHERE 仍然带 `org_id = $1`，即使 RLS 已经在挡。第二道防线。
 *
 * ## 归因规则：**恰好一个 skill 版本才归因**
 *
 * `agent_runs.skill_version_ids` 是一个数组——一次 run 可以钉多个 skill。
 * 而契约的 `attribution` 只有单个 `skillVersionId`。三种情况：
 *
 *   0 个  → `skillId`/`skillVersionId` 皆 null，只计 agent 级
 *   1 个  → 归因到它
 *   ≥2 个 → **也是 null**，只计 agent 级
 *
 * ≥2 时挑一个（第一个 / 最后一个 / 随便一个）是这里最容易写错的地方：I-20 逐字
 * 「**不得随意归给某个 skill**」，而「用了 A 和 B，把这条 👎 记在 A 头上」正是那句话
 * 禁止的东西——它会让 B 的满意度偏高、A 的偏低，且两个数字看起来都很正常。
 * 降级为 agent 级不会丢失这条评价：它照样落库、照样进数据质量报表，只是不参与
 * 任何 skill 的满意度。**可见的少算，好过看不见的错算。**
 *
 * ## `skill_id` 是查出来的，不是从版本 id 猜的
 *
 * `agent_runs` 只存版本 id。`skill_id` 走 `skill_versions.skill_id` 取——
 * 版本 id 里编不出 skill id，也不该有人试图从命名规则里解析它。
 * 查不到那一行（版本被清理）时同样降级为 agent 级：**不为一条不存在的版本编造归属**。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  DataQualityEntry,
  RatingAttribution,
  RatingRecord,
  RatingVerdict,
} from "../../domain/skill/rating-attribution";
import { idempotencyKeyOf } from "../../domain/skill/rating-attribution";
import type {
  MessageRatingRepository,
  MessageRatingRepositoryFactory,
} from "../../application/skill/ports";

interface RatingDbRow {
  readonly id: string;
  readonly message_id: string;
  readonly rater_id: string;
  readonly verdict: string;
  readonly reason: string | null;
  readonly agent_id: string;
  readonly skill_id: string | null;
  readonly skill_version_id: string | null;
}

function toRecord(row: RatingDbRow): RatingRecord {
  return {
    ratingId: row.id,
    messageId: row.message_id,
    raterId: row.rater_id,
    // 列上有 CHECK (verdict IN ('up','down'))，读回来的值只可能是这两个之一。
    verdict: row.verdict as RatingVerdict,
    reason: row.reason,
    attribution: {
      agentId: row.agent_id,
      skillId: row.skill_id,
      skillVersionId: row.skill_version_id,
    },
  };
}

const SELECT_COLUMNS =
  "id, message_id, rater_id, verdict, reason, agent_id, skill_id, skill_version_id";

class ScopedPgMessageRatingRepository implements MessageRatingRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  /**
   * ⚠ 幂等键的**拆分规则来自 domain**（`idempotencyKeyOf`），不是这里另定的。
   *   端口签名收的是一个字符串键，而表上是两列——所以这里必须把它拆回去。
   *   拆法与拼法必须是同一条规则：`::` 是 domain 那个函数的分隔符，
   *   `splitIdempotencyKey` 用它自己拼一遍做自检，对不上就抛，
   *   而不是拿一个猜出来的 messageId 去查（那会静默查不到 ⇒ 幂等失效 ⇒ 重复计数）。
   */
  async findByIdempotencyKey(key: string): Promise<RatingRecord | null> {
    const parts = splitIdempotencyKey(key);
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<RatingDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM message_ratings
          WHERE org_id = $1 AND message_id = $2 AND rater_id = $3`,
        [this.orgId, parts.messageId, parts.raterId],
      );
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    });
  }

  /**
   * ⚠ `ON CONFLICT DO NOTHING`，不是 `DO UPDATE`。唯一约束
   *   `(org_id, message_id, rater_id)` 是 V13 在并发下的落点——用例层那次
   *   `findByIdempotencyKey` 与这次 INSERT 之间有窗口，两个并发请求会双双查到 null。
   *   `DO NOTHING` 让后到的那个变成 no-op（第一条评价胜出），
   *   `DO UPDATE` 会让它变成「后一次覆盖前一次」，那正是 V13 禁止的。
   */
  async save(record: RatingRecord): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO message_ratings
           (id, org_id, message_id, rater_id, verdict, reason,
            agent_id, skill_id, skill_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (org_id, message_id, rater_id) DO NOTHING`,
        [
          record.ratingId, this.orgId, record.messageId, record.raterId,
          record.verdict, record.reason,
          record.attribution.agentId,
          record.attribution.skillId,
          record.attribution.skillVersionId,
        ],
      );
    });
  }

  async listBySkillId(skillId: string): Promise<readonly RatingRecord[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<RatingDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM message_ratings
          WHERE org_id = $1 AND skill_id = $2
          ORDER BY created_at ASC, id ASC`,
        [this.orgId, skillId],
      );
      return rows.map(toRecord);
    });
  }

  /**
   * ⚠ `ON CONFLICT DO NOTHING`：主键是 `rating_id`，而幂等重放会让用例对同一条
   *   评价再走一次这条路。报表里出现两行「同一条评价缺归因」不是更严重的信号，
   *   只是一个重复计数。
   */
  async record(entry: DataQualityEntry): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO rating_data_quality_entries (rating_id, org_id, agent_id, reason)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (rating_id) DO NOTHING`,
        [entry.ratingId, this.orgId, entry.agentId, entry.reason],
      );
    });
  }

  /**
   * 服务端归因。⚠ 三条硬性：
   *   ① 只认 `author_kind = 'agent'` —— 人类发的消息没有 agent 归因可言；
   *   ② 沿 `chat_messages.agent_run_id` join `agent_runs`，**不接受任何外部输入**；
   *   ③ `skill_version_ids` 恰好一个才归因（见文件头）。
   */
  async resolveForMessage(messageId: string): Promise<RatingAttribution | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{
        agent_id: string; skill_version_ids: unknown;
      }>(
        `SELECT r.agent_id, r.skill_version_ids
           FROM chat_messages m
           JOIN agent_runs r ON r.id = m.agent_run_id AND r.org_id = m.org_id
          WHERE m.org_id = $1 AND m.id = $2 AND m.author_kind = 'agent'`,
        [this.orgId, messageId],
      );
      const row = rows[0];
      if (row === undefined) return null;

      const versionIds = Array.isArray(row.skill_version_ids)
        ? row.skill_version_ids.filter((v): v is string => typeof v === "string")
        : [];
      // 恰好一个才归因。0 个与 ≥2 个都降级为 agent 级——见文件头，
      // 「≥2 时挑一个」是 I-20 逐字禁止的「随意归给某个 skill」。
      if (versionIds.length !== 1) {
        return { agentId: row.agent_id, skillId: null, skillVersionId: null };
      }
      const versionId = versionIds[0]!;

      const owner = await s.query<{ skill_id: string }>(
        `SELECT skill_id FROM skill_versions WHERE org_id = $1 AND id = $2`,
        [this.orgId, versionId],
      );
      const skillId = owner.rows[0]?.skill_id;
      // 版本行查不到（被清理）：不为一条不存在的版本编造归属。
      if (skillId === undefined) {
        return { agentId: row.agent_id, skillId: null, skillVersionId: null };
      }
      return { agentId: row.agent_id, skillId, skillVersionId: versionId };
    });
  }
}

/**
 * 把 domain 拼出来的幂等键拆回两列，并**自检**。
 *
 * ⚠ 不用 `key.split("::")` 直接取两段：`messageId` 或 `raterId` 里若含 `::`，
 *   naive 拆分会得到一个错的 messageId，然后 `findByIdempotencyKey` 静默查不到，
 *   于是幂等失效、同一个人的第二次点击变成第二行。所以这里拆完**用 domain 自己的
 *   `idempotencyKeyOf` 拼回去比对**——对不上就抛，而不是带着一个猜测继续查。
 */
export function splitIdempotencyKey(key: string): {
  readonly messageId: string; readonly raterId: string;
} {
  const at = key.indexOf("::");
  if (at < 0) throw new Error(`幂等键格式无法识别：${key}`);
  const candidate = { messageId: key.slice(0, at), raterId: key.slice(at + 2) };
  if (idempotencyKeyOf(candidate.messageId, candidate.raterId) !== key) {
    throw new Error(`幂等键歧义（分段含分隔符）：${key}`);
  }
  return candidate;
}

export class PgMessageRatingRepository implements MessageRatingRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): MessageRatingRepository {
    return new ScopedPgMessageRatingRepository(this.db, orgId);
  }
}
