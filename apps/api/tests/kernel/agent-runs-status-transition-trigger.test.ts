import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

/**
 * issue #1787 -- 既有红：`agent_runs_enforce_status_transition` 是孤儿函数。
 *
 * DA-07b（#1776，20260822120000_da07b_hitl_awaiting_approval.sql——迁移文件本身是不可变历史，
 * 文件名不随 F06 的状态改名而改）的迁移注释说它"整体重建"
 * 了与 20260805190000_i519 同名的触发器函数，并新增两条边
 * （running→awaiting_tool_permission、awaiting_tool_permission→queued）。但它实际写的函数名
 * （`agent_runs_enforce_status_transition`）与真正绑定在 `agent_runs_transition_trg` 上的
 * 函数名（`wave2_agent_run_transition`）不同——`CREATE OR REPLACE FUNCTION` 按名字匹配，
 * 改名等于新建了一个从未被任何触发器调用的孤儿函数，旧函数体（不认识 awaiting_tool_permission）
 * 继续生效。
 *
 * `deep-agent-hitl.test.ts` 只 mock 掉了仓储层，从未对真实触发器发起过一次真实 UPDATE，
 * 所以这条状态机洞一直没被测出来。本文件直接对 `agent_runs` 发 UPDATE，只信真实触发器的
 * 回答，不信应用层是否"打算"允许。
 */

const ORG = "org-i1787-trigger";
const PROJECT = "proj-i1787-trigger";
const THREAD = "thread-i1787-trigger";
const ACTOR = "u-i1787-trigger-actor";

let db: PgDatabase;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

async function seedRun(id: string, status: string): Promise<string> {
  const inputMessageId = `${id}-input`;
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hi", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9)`,
      [id, ORG, THREAD, inputMessageId, "agent-i1787", "agent-version-i1787", "test-provider", "test-model", status],
    ),
  );
  return id;
}

describe("agent_runs_transition_trg -- the trigger actually bound, not merely a function with the right name", () => {
  it("running -> awaiting_tool_permission is allowed by the REAL trigger (the engine's interrupt)", async () => {
    const id = await seedRun("run-i1787-a", "running");
    await asApp(ORG, (c) =>
      c.query(
        `UPDATE agent_runs SET status = 'awaiting_tool_permission', pending_tool_name = 't' WHERE id = $1`,
        [id],
      ),
    );
    const status = await asApp(ORG, async (c) => {
      const r = await c.query<{ status: string }>(`SELECT status FROM agent_runs WHERE id = $1`, [id]);
      return r.rows[0]!.status;
    });
    expect(status).toBe("awaiting_tool_permission");
  });

  it("awaiting_tool_permission -> queued is allowed by the REAL trigger (human approved, re-enqueue)", async () => {
    const id = await seedRun("run-i1787-b", "awaiting_tool_permission");
    await asApp(ORG, (c) => c.query(`UPDATE agent_runs SET status = 'queued' WHERE id = $1`, [id]));
    const status = await asApp(ORG, async (c) => {
      const r = await c.query<{ status: string }>(`SELECT status FROM agent_runs WHERE id = $1`, [id]);
      return r.rows[0]!.status;
    });
    expect(status).toBe("queued");
  });

  it("awaiting_tool_permission -> failed is still allowed (human rejected)", async () => {
    const id = await seedRun("run-i1787-c", "awaiting_tool_permission");
    await asApp(ORG, (c) =>
      c.query(`UPDATE agent_runs SET status = 'failed', error_code = 'HITL_REJECTED' WHERE id = $1`, [id]),
    );
    const status = await asApp(ORG, async (c) => {
      const r = await c.query<{ status: string }>(`SELECT status FROM agent_runs WHERE id = $1`, [id]);
      return r.rows[0]!.status;
    });
    expect(status).toBe("failed");
  });

  it("counter-proof: queued -> awaiting_tool_permission is still refused -- the migration says this edge is deliberately absent", async () => {
    const id = await seedRun("run-i1787-d", "queued");
    await expect(
      asApp(ORG, (c) => c.query(`UPDATE agent_runs SET status = 'awaiting_tool_permission' WHERE id = $1`, [id])),
    ).rejects.toThrow(/may not move from queued to awaiting_tool_permission/);
  });

  it("counter-proof: a terminal run still cannot be reopened into awaiting_tool_permission either", async () => {
    const id = await seedRun("run-i1787-e", "succeeded");
    await expect(
      asApp(ORG, (c) => c.query(`UPDATE agent_runs SET status = 'awaiting_tool_permission' WHERE id = $1`, [id])),
    ).rejects.toThrow(/is terminal in succeeded/);
  });

  it("the trigger bound to agent_runs is wave2_agent_run_transition -- there is exactly one transition-enforcing function, not an orphan beside it", async () => {
    const bound = await asOwner(async (c) => {
      const r = await c.query<{ proname: string }>(
        `SELECT p.proname FROM pg_trigger t
           JOIN pg_proc p ON p.oid = t.tgfoid
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'agent_runs' AND NOT t.tgisinternal AND t.tgname = 'agent_runs_transition_trg'`,
      );
      return r.rows.map((x) => x.proname);
    });
    expect(bound).toEqual(["wave2_agent_run_transition"]);

    const orphan = await asOwner(async (c) => {
      const r = await c.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = 'agent_runs_enforce_status_transition'`,
      );
      return r.rows.map((x) => x.proname);
    });
    expect(orphan, "the mis-named orphan function must not exist").toEqual([]);
  });
});
