/**
 * F176 —— `message_ratings` 落在真实 Postgres 上的行为，即迁移
 * (`20260814120000_f176_message_ratings.sql`) 声称的四条：
 *
 *   1. 写进去读得出来，归因三列逐字保留。
 *   2. **幂等是数据库约束**（V13）：同一 `(org, message, rater)` 的第二次写入
 *      落不进第二行，且**第一条不被覆盖**。⚠ 这一条不能只靠用例层那次
 *      `findByIdempotencyKey` —— 它与 INSERT 之间有窗口，并发下两边都会查到 null。
 *   3. **append-only**：UPDATE / DELETE 两半都被拒（GRANT 面 + 触发器）。
 *      端口结构上就没有 `update`；数据库这一半让「悄悄允许」也不成立。
 *   4. **RLS**：另一个租户读不到。
 *
 * 归因是怎么算出来的（服务端查、恰好一个版本才归因）由
 * `message-rating-attribution-server-derived.test.ts` 验，不在这里重复。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgMessageRatingRepository } from "../../src/infrastructure/skill/pg-message-rating-repository";
import { idempotencyKeyOf, type RatingRecord } from "../../src/domain/skill/rating-attribution";
import type { MessageRatingRepository } from "../../src/application/skill/ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f176-rating";
const OTHER_ORG = "org-f176-rating-other";
const PROJECT = "proj-f176-rating";
const THREAD = "thread-f176-rating";
const ACTOR = "u-f176-actor";
const OTHER_ACTOR = "u-f176-other-actor";
const AI_MESSAGE = "msg-f176-ai";

let db: PgDatabase;
let repo: MessageRatingRepository;

async function seed(): Promise<void> {
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addChatMessage({ orgId: ORG, id: AI_MESSAGE, threadId: THREAD, body: "reply", authorId: "agent-f176", authorKind: "agent", agentId: "agent-f176" });
}

function record(over: Partial<RatingRecord> = {}): RatingRecord {
  return {
    ratingId: "rating-1", messageId: AI_MESSAGE, raterId: ACTOR,
    verdict: "down", reason: "答非所问",
    attribution: { agentId: "agent-f176", skillId: "skill-a", skillVersionId: "sv-1" },
    ...over,
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgMessageRatingRepository(db).forOrg(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seed();
});

afterAll(async () => {
  await db.close();
});

describe("F176 message_ratings —— 评价的落库行为", () => {
  it("写进去读得出来，归因三列逐字保留", async () => {
    await repo.save(record());

    const found = await repo.findByIdempotencyKey(idempotencyKeyOf(AI_MESSAGE, ACTOR));
    expect(found).toEqual(record());
  });

  it("V13 幂等：同一人对同一条消息写第二次 ⇒ 仍然只有一行，且第一条不被覆盖", async () => {
    await repo.save(record({ ratingId: "rating-1", verdict: "down", reason: "第一次" }));
    // ⚠ 第二次刻意换 verdict 与 reason：如果实现写成 `ON CONFLICT DO UPDATE`，
    //   行数仍然是 1（看起来幂等），但内容被后一次覆盖了——那是 V13 明确禁止的
    //   「后一次覆盖前一次」。所以这里断的是**内容仍是第一条**，不只是行数。
    await repo.save(record({ ratingId: "rating-2", verdict: "up", reason: "第二次" }));

    const rows = await asApp(ORG, (c) =>
      c.query<{ id: string; verdict: string; reason: string }>(
        "SELECT id, verdict, reason FROM message_ratings WHERE org_id=$1", [ORG],
      ).then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("rating-1");
    expect(rows[0]?.verdict).toBe("down");
    expect(rows[0]?.reason).toBe("第一次");
  });

  it("不同的人对同一条消息各评一次 ⇒ 两行（幂等键是 (message, rater) 不是 message）", async () => {
    await addOrgMember(ORG, OTHER_ACTOR, "consultant", null);
    await repo.save(record({ ratingId: "r-a", raterId: ACTOR }));
    await repo.save(record({ ratingId: "r-b", raterId: OTHER_ACTOR }));

    const { rows } = await asApp(ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*) AS n FROM message_ratings WHERE org_id=$1", [ORG]),
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("I-20：skill_id 与 skill_version_id 必须同生同死 —— 只有一半的行写不进去", async () => {
    await expect(
      asApp(ORG, (c) => c.query(
        `INSERT INTO message_ratings
           (id,org_id,message_id,rater_id,verdict,reason,agent_id,skill_id,skill_version_id)
         VALUES ('bad',$1,$2,$3,'up',NULL,'agent-f176','skill-a',NULL)`,
        [ORG, AI_MESSAGE, ACTOR],
      )),
    ).rejects.toThrow(/message_ratings_attribution_pairing/);
  });

  it("append-only 第一半：应用角色的 GRANT 面没有 UPDATE/DELETE", async () => {
    await repo.save(record());

    await expect(
      asApp(ORG, (c) => c.query("UPDATE message_ratings SET verdict='up' WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM message_ratings WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("append-only 第二半：owner 连接（有写权限）也被触发器拒 —— GRANT 被放宽也改不了评价", async () => {
    // 只测 GRANT 面不够：GRANT 是一行可以被某次「顺手放开一下」的迁移改掉的配置，
    // 而那时最省事的修法恰恰是把上一条断言改成「现在允许了」。
    await repo.save(record());
    await expect(
      asOwner((c) => c.query("UPDATE message_ratings SET verdict='up' WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/append-only/i);
    await expect(
      asOwner((c) => c.query("DELETE FROM message_ratings WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/append-only/i);
  });

  it("RLS：另一个租户读不到这条评价", async () => {
    await repo.save(record());

    const other = new PgMessageRatingRepository(db).forOrg(OTHER_ORG);
    expect(await other.findByIdempotencyKey(idempotencyKeyOf(AI_MESSAGE, ACTOR))).toBeNull();
    // 阳性对照：同一个查询在本租户下确实查得到，否则上面只是在为「这个方法恒返回 null」背书。
    expect(await repo.findByIdempotencyKey(idempotencyKeyOf(AI_MESSAGE, ACTOR))).not.toBeNull();
  });

  it("E1：缺归因的评价进数据质量报表，且报表行跟着评价走", async () => {
    await repo.save(record({ attribution: { agentId: "agent-f176", skillId: null, skillVersionId: null } }));
    await repo.record({ ratingId: "rating-1", agentId: "agent-f176", reason: "missing-skill-version" });

    const { rows } = await asApp(ORG, (c) =>
      c.query<{ rating_id: string; reason: string }>(
        "SELECT rating_id, reason FROM rating_data_quality_entries WHERE org_id=$1", [ORG],
      ),
    );
    expect(rows).toEqual([{ rating_id: "rating-1", reason: "missing-skill-version" }]);
  });
});
