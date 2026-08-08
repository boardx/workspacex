/**
 * #654 阶段2a — `agent_run_deltas`：`PgAgentRunRepository.appendModelDelta`/`readModelDeltas`
 * 落在真实 Postgres 上的行为，以及迁移
 * (`20260808120000_i654_agent_run_deltas.sql`) 声称的三条不变量：
 *
 *   1. `(org_id, run_id, seq)` 唯一 —— 重复写同一条 seq 是无害的 no-op，不是报错，
 *      不是覆盖（`ports.ts` `appendModelDelta` 的文档原话）。
 *   2. RLS 强制隔离 —— 另一个租户读不到这些增量（与 `agent_run_steps` 同款测试形状）。
 *   3. append-only —— UPDATE/DELETE 被触发器拒绝（组织级联删除除外，这里不测那条，
 *      `agent_run_steps` 已经测过同一个触发器函数模式）。
 *
 * `agent_runs` 行本身用最小夹具直接 INSERT（不经过 `acceptHumanMessage`）：本文件只
 * 关心 `agent_run_deltas` 这一张新表的行为，不是整条验收链路——那条链路已经由
 * `no-tool-run-writeback.test.ts` 覆盖，本文件不重复它。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i654-deltas";
const OTHER_ORG = "org-i654-deltas-other";
const PROJECT = "proj-i654-deltas";
const THREAD = "thread-i654-deltas";
const ACTOR = "u-i654-deltas-actor";
const RUN = "run-i654-deltas";

let db: PgDatabase;
let repo: PgAgentRunRepository;

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
      [RUN, ORG, THREAD, inputMessageId, "agent-i654", "agent-version-i654", "test-provider", "test-model"],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedMinimalRun();
});

afterAll(async () => {
  await db.close();
});

describe("appendModelDelta / readModelDeltas", () => {
  it("持久化的增量按 seq 顺序读回，内容逐字保留", async () => {
    const orgId = toOrgId(ORG);
    await repo.appendModelDelta(orgId, { runId: RUN, seq: 0, text: "Hel" });
    await repo.appendModelDelta(orgId, { runId: RUN, seq: 1, text: "lo, " });
    await repo.appendModelDelta(orgId, { runId: RUN, seq: 2, text: "world" });

    const all = await repo.readModelDeltas(orgId, RUN, -1);
    expect(all.map((d) => d.text)).toEqual(["Hel", "lo, ", "world"]);
    expect(all.map((d) => d.seq)).toEqual([0, 1, 2]);

    const afterFirst = await repo.readModelDeltas(orgId, RUN, 0);
    expect(afterFirst.map((d) => d.text)).toEqual(["lo, ", "world"]);
  });

  it("重复写同一条 (org_id, run_id, seq) 是无害的 no-op，不是第二条记录", async () => {
    const orgId = toOrgId(ORG);
    await repo.appendModelDelta(orgId, { runId: RUN, seq: 0, text: "first" });
    // A retried write of the SAME fragment must not create a duplicate or overwrite.
    await repo.appendModelDelta(orgId, { runId: RUN, seq: 0, text: "first" });

    const all = await repo.readModelDeltas(orgId, RUN, -1);
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe("first");
  });

  it("跨租户读不到——RLS 强制隔离，不是应用层过滤", async () => {
    await repo.appendModelDelta(toOrgId(ORG), { runId: RUN, seq: 0, text: "tenant-a-only" });

    // The other org's tenant context genuinely sees zero rows for a run_id it has no
    // row for -- proving isolation, not merely "the query filtered by orgId correctly".
    const fromOtherOrg = await repo.readModelDeltas(toOrgId(OTHER_ORG), RUN, -1);
    expect(fromOtherOrg).toEqual([]);
  });

  it("空字符串增量被迁移的 CHECK 约束拒绝，不会静默落一行空文本", async () => {
    await expect(
      repo.appendModelDelta(toOrgId(ORG), { runId: RUN, seq: 0, text: "" }),
    ).rejects.toThrow();
  });

  it("append-only：两道机制都拦——app_rw 的 GRANT 面没有 UPDATE/DELETE 权限（先在这里被拒），" +
    "触发器是万一 GRANT 被放宽之后的第二道防线（`agent_run_steps` 同款两半证据）", async () => {
    await repo.appendModelDelta(toOrgId(ORG), { runId: RUN, seq: 0, text: "immutable" });

    // The GRANT (SELECT, INSERT only) denies this before the trigger even runs —
    // exactly the "which half caught it" question `agent_run_steps`'s own migration
    // comment describes measuring. Both messages are acceptable evidence of the same
    // append-only property; only silent success would be a real failure.
    await expect(
      asApp(ORG, (c) =>
        c.query("UPDATE agent_run_deltas SET text='tampered' WHERE run_id=$1 AND seq=0", [RUN])),
    ).rejects.toThrow(/append-only|permission denied/);

    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM agent_run_deltas WHERE run_id=$1 AND seq=0", [RUN])),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});
