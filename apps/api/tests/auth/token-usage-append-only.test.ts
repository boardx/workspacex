/**
 * F159 —— `token_usage_events` 落在真实 Postgres 上的行为，即迁移
 * (`20260812030000_f159_token_usage_events.sql`) 声称的四条：
 *
 *   1. 写进去读得出来，token 数逐字保留（bigint 不被截成 int）。
 *   2. **append-only**：UPDATE / DELETE 被触发器拒绝。这是本表存在的意义——
 *      账能改写，「本月已用 3.9M」这句话就不成立。
 *   3. **RLS**：另一个租户读不到，也写不进来。
 *   4. 拆分维度（`tokens_prompt` / `tokens_completion`）**没报就是 NULL，不是 0**；
 *      失败的行也可以带 token（上游 4xx 照样计费 prompt tokens）。
 *
 * 时序/参数那一半（谁在什么时候调用计量、失败路径也记一行）由
 * `token-usage-single-write-path.test.ts` 用内存 fake 验，不在这里重复。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTokenUsageRepository } from "../../src/infrastructure/auth/pg-token-usage-repository";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f159-usage";
const OTHER_ORG = "org-f159-usage-other";
const PROJECT = "proj-f159-usage";
const THREAD = "thread-f159-usage";
const ACTOR = "u-f159-usage-actor";
const RUN = "run-f159-usage";

let db: PgDatabase;
let repo: PgTokenUsageRepository;

async function seedMinimalRun(): Promise<void> {
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  const inputMessageId = `${RUN}-input`;
  await addChatMessage({
    orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hello", authorId: ACTOR,
  });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'running')`,
      [RUN, ORG, THREAD, inputMessageId, "agent-f159", "agent-version-f159", "test-provider", "test-model"],
    ),
  );
}

const write = (
  tokensTotal: number,
  outcome: "succeeded" | "failed" = "succeeded",
  split: { promptTokens: number | null; completionTokens: number | null } =
    { promptTokens: null, completionTokens: null },
) =>
  repo.record(toOrgId(ORG), {
    userId: ACTOR, runId: RUN, modelProvider: "test-provider", modelId: "test-model",
    tokensTotal, outcome, ...split,
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTokenUsageRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedMinimalRun();
});

afterAll(async () => {
  await db.close();
});

describe("F159 token_usage_events —— 账的落库行为", () => {
  it("写进去读得出来，大数按 bigint 保留（不被截断）", async () => {
    await write(12_345_678_901);

    const rows = await asApp(ORG, (c) =>
      c.query<{ tokens_total: string; user_id: string; outcome: string }>(
        "SELECT tokens_total, user_id, outcome FROM token_usage_events WHERE org_id=$1", [ORG],
      ).then((r) => r.rows),
    );

    expect(rows).toHaveLength(1);
    // pg 把 bigint 作为字符串返回——正是这一点让「用 int 就够了」的假设在超过 21 亿
    // token（一个大组织几个月的量）时静默溢出。断言字符串原值，不 Number() 它。
    expect(rows[0]?.tokens_total).toBe("12345678901");
    expect(rows[0]?.user_id).toBe(ACTOR);
    expect(rows[0]?.outcome).toBe("succeeded");
  });

  it("append-only 第一半：应用角色的 GRANT 面根本没有 UPDATE/DELETE，改账在权限层就被拒", async () => {
    await write(1000);

    await expect(
      asApp(ORG, (c) => c.query("UPDATE token_usage_events SET tokens_total = 1 WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM token_usage_events WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/permission denied/i);

    const after = await asApp(ORG, (c) =>
      c.query<{ tokens_total: string }>("SELECT tokens_total FROM token_usage_events WHERE org_id=$1", [ORG])
        .then((r) => r.rows),
    );
    expect(after[0]?.tokens_total).toBe("1000");
  });

  it("append-only 第二半：即使拿到了写权限（owner 连接），触发器仍然拒绝——GRANT 被放宽也改不了账", async () => {
    await write(1000);

    // 只测 GRANT 面是不够的：GRANT 是一行可以被某次「顺手放开一下」的迁移改掉的配置，
    // 改掉之后上一条测试仍然会红（好），但如果只有那一条，红了之后最省事的修法恰恰是
    // 把断言改成「现在允许了」。触发器这一半让「改账」在任何权限下都不成立。
    await expect(
      asOwner((c) => c.query("UPDATE token_usage_events SET tokens_total = 1 WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/append-only/i);

    await expect(
      asOwner((c) => c.query("DELETE FROM token_usage_events WHERE org_id=$1", [ORG])),
    ).rejects.toThrow(/append-only/i);
  });

  it("失败的行可以带 token：部分 4xx 上游照样计费 prompt tokens，一律记 0 会让那部分钱凭空消失", async () => {
    // coord-main 2026-08-12 裁决②的修正。代价说清楚：因此**没有**「失败必为 0」这条
    // 机械约束了，「把成功的数写到失败分支上」不再被数据库拦住——那条改由
    // `token-usage-single-write-path.test.ts` 在写入点上断言。
    await write(120, "failed", { promptTokens: 120, completionTokens: 0 });

    const rows = await asApp(ORG, (c) =>
      c.query<{ tokens_total: string; tokens_prompt: string | null; outcome: string }>(
        "SELECT tokens_total, tokens_prompt, outcome FROM token_usage_events WHERE org_id=$1", [ORG],
      ).then((r) => r.rows),
    );
    expect(rows[0]).toMatchObject({ tokens_total: "120", tokens_prompt: "120", outcome: "failed" });
  });

  it("上游没报拆分维度时存 NULL，不是 0（「没报」≠「一个 prompt token 都没用」）", async () => {
    await write(1000);

    const rows = await asApp(ORG, (c) =>
      c.query<{ tokens_prompt: string | null; tokens_completion: string | null }>(
        "SELECT tokens_prompt, tokens_completion FROM token_usage_events WHERE org_id=$1", [ORG],
      ).then((r) => r.rows),
    );
    expect(rows[0]?.tokens_prompt).toBeNull();
    expect(rows[0]?.tokens_completion).toBeNull();
  });

  it("RLS：另一个租户既读不到也写不进来", async () => {
    await write(500);

    const seenByOther = await asApp(OTHER_ORG, (c) =>
      c.query("SELECT 1 FROM token_usage_events").then((r) => r.rowCount),
    );
    expect(seenByOther).toBe(0);

    await expect(
      asApp(OTHER_ORG, (c) => c.query(
        `INSERT INTO token_usage_events
           (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome)
         VALUES ('evt-cross',$1,$2,NULL,'p','m',1,'succeeded')`,
        [ORG, ACTOR],
      )),
    ).rejects.toThrow();
  });
});
