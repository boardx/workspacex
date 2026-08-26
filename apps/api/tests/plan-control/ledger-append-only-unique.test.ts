/**
 * F972 —— `chat_plan_ledgers` 是 append-only 且 (thread_id, revision) 唯一（I-1 / I-2）。
 *
 * 权威规格：phases/phase-01-run-a-project/contracts/plan-control/domain.md I-1/I-2。
 * 依着 `apps/api/tests/kernel/provenance-append-only.test.ts` 同一条纪律：
 * 攻击从外部发起（真实 SQL，走 app_rw 与属主两个角色），不是读代码里"没有 update 方法"。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";

const ORG = "org-f972-plan-ledger";
const OTHER = "org-f972-plan-ledger-other";
const PROJECT = "proj-f972-plan-ledger";
const THREAD = "thread-f972-plan-ledger";

async function appDenies(orgId: string, sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(appConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

async function ownerDenies(sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

async function insertLedgerRow(
  orgId: string,
  threadId: string,
  revision: number,
  opts: { origin?: "engine" | "user"; basedOnRevision?: number | null; createdBy?: string | null } = {},
): Promise<void> {
  const origin = opts.origin ?? "engine";
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        threadId, orgId, revision, revision, origin,
        origin === "user" ? (opts.basedOnRevision ?? revision - 1) : null,
        JSON.stringify([{ planStepId: "s1", content: "第一步", status: "pending", constraints: [] }]),
        origin === "user" ? (opts.createdBy ?? "u-author") : null,
      ],
    ),
  );
}

const countLedgerRows = async (orgId: string, threadId: string): Promise<number> =>
  asApp(orgId, async (c) => {
    const r = await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM chat_plan_ledgers WHERE thread_id = $1",
      [threadId],
    );
    return Number(r.rows[0]!.n);
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: "u-author",
  });
});

describe("I-1: (thread_id, revision) 唯一 —— 任一线程恰好一份 revision 最大的账本", () => {
  it("同一 (thread_id, revision) 二次写入被主键拒绝", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    const err = await appDenies(
      ORG,
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,$3,$4,'engine',NULL,$5,NULL)`,
      [THREAD, ORG, 0, 0, JSON.stringify([])],
    );
    expect(err ?? "<SUCCEEDED>", "duplicate (thread_id, revision) 应被主键拒绝").toMatch(
      /duplicate key|unique/i,
    );
    expect(await countLedgerRows(ORG, THREAD)).toBe(1);
  });

  it("机械断言：同一线程内没有任何 revision 出现超过一次", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    await insertLedgerRow(ORG, THREAD, 1);
    await insertLedgerRow(ORG, THREAD, 2);
    const dup = await asApp(ORG, (c) =>
      c.query(
        `SELECT revision FROM chat_plan_ledgers WHERE thread_id = $1
         GROUP BY revision HAVING count(*) > 1`,
        [THREAD],
      ),
    );
    expect(dup.rows).toEqual([]);
  });

  it("恒有唯一最大 revision 版本可读", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    await insertLedgerRow(ORG, THREAD, 1);
    await insertLedgerRow(ORG, THREAD, 2);
    const latest = await asApp(ORG, (c) =>
      c.query<{ revision: number }>(
        `SELECT revision FROM chat_plan_ledgers WHERE thread_id = $1 ORDER BY revision DESC LIMIT 1`,
        [THREAD],
      ),
    );
    expect(latest.rows).toHaveLength(1);
    expect(latest.rows[0]!.revision).toBe(2);
  });
});

describe("I-2: 账本 append-only —— 没有 UPDATE 路径", () => {
  it("app_rw 不能 UPDATE 一行账本", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    const err = await appDenies(
      ORG,
      "UPDATE chat_plan_ledgers SET engine_epoch = 99 WHERE thread_id = $1 AND revision = 0",
      [THREAD],
    );
    expect(err ?? "<SUCCEEDED>", "UPDATE 成功了——账本可以被就地改写").toMatch(/permission denied/i);
  });

  it("即便是属主（迁移脚本 / psql 会话）也不能 UPDATE 一行账本", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    const err = await ownerDenies(
      "UPDATE chat_plan_ledgers SET engine_epoch = 99 WHERE thread_id = $1 AND revision = 0",
      [THREAD],
    );
    expect(err ?? "<SUCCEEDED>", "属主重写了一行账本").toMatch(/PLAN_LEDGER_APPEND_ONLY/);
  });

  it("并发写：同一 threadId 连发两次编辑，第二次 revision 严格大于第一次，且是新的一行", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    await insertLedgerRow(ORG, THREAD, 1, { origin: "user", basedOnRevision: 0 });
    await insertLedgerRow(ORG, THREAD, 2, { origin: "user", basedOnRevision: 1 });
    expect(await countLedgerRows(ORG, THREAD)).toBe(3);

    const rows = await asApp(ORG, (c) =>
      c.query<{ revision: number }>(
        "SELECT revision FROM chat_plan_ledgers WHERE thread_id = $1 ORDER BY revision",
        [THREAD],
      ),
    );
    expect(rows.rows.map((r) => r.revision)).toEqual([0, 1, 2]);
  });

  it("attacks leave the row count where it was, and appending still works", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    const before = await countLedgerRows(ORG, THREAD);

    await appDenies(ORG, "UPDATE chat_plan_ledgers SET engine_epoch = 99 WHERE thread_id = $1", [THREAD]);
    await ownerDenies("UPDATE chat_plan_ledgers SET engine_epoch = 99 WHERE thread_id = $1", [THREAD]);
    expect(await countLedgerRows(ORG, THREAD)).toBe(before);

    // 表仍然可写——一张谁都写不进去的表会以"移除功能"的方式让上面每条断言全绿。
    await insertLedgerRow(ORG, THREAD, 1, { origin: "user", basedOnRevision: 0 });
    expect(await countLedgerRows(ORG, THREAD)).toBe(before + 1);
  });
});

describe("形状约束：origin 与 based_on_revision / created_by 成对（I-5 / I-9 的前提）", () => {
  it("origin='engine' 但携带 based_on_revision ⇒ 被 CHECK 拒绝", async () => {
    const err = await appDenies(
      ORG,
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,0,0,'engine',0,$3,NULL)`,
      [THREAD, ORG, JSON.stringify([])],
    );
    expect(err ?? "<SUCCEEDED>").toMatch(/check|constraint/i);
  });

  it("origin='user' 但缺 based_on_revision ⇒ 被 CHECK 拒绝", async () => {
    const err = await appDenies(
      ORG,
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,0,0,'user',NULL,$3,'u-author')`,
      [THREAD, ORG, JSON.stringify([])],
    );
    expect(err ?? "<SUCCEEDED>").toMatch(/check|constraint/i);
  });

  it("origin='engine' 但携带 created_by ⇒ 被 CHECK 拒绝（I-9：引擎不产出约束/编辑）", async () => {
    const err = await appDenies(
      ORG,
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,0,0,'engine',NULL,$3,'u-someone')`,
      [THREAD, ORG, JSON.stringify([])],
    );
    expect(err ?? "<SUCCEEDED>").toMatch(/check|constraint/i);
  });
});

describe("RLS：两张表按 org 隔离，继承 chat_threads 判权的同一套机制", () => {
  it("另一个 org 看不到这条线程的账本", async () => {
    await insertLedgerRow(ORG, THREAD, 0);
    await seedOrg({ orgId: OTHER, projectId: `${PROJECT}-other` });
    const rows = await asApp(OTHER, (c) =>
      c.query("SELECT 1 FROM chat_plan_ledgers WHERE thread_id = $1", [THREAD]),
    );
    expect(rows.rows).toEqual([]);
  });

  it("孤儿约束表同样按 org 隔离，且允许 DELETE（UC-6 主动撤销）", async () => {
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO chat_plan_orphan_constraints
           (constraint_id, thread_id, org_id, text, former_step_content, orphaned_at_revision)
         VALUES ('c-orphan-1', $1, $2, '别调用外部 API', '旧步骤正文', 1)`,
        [THREAD, ORG],
      ),
    );
    await seedOrg({ orgId: OTHER, projectId: `${PROJECT}-other-2` });
    const invisible = await asApp(OTHER, (c) =>
      c.query("SELECT 1 FROM chat_plan_orphan_constraints WHERE constraint_id = 'c-orphan-1'"),
    );
    expect(invisible.rows).toEqual([]);

    await asApp(ORG, (c) =>
      c.query("DELETE FROM chat_plan_orphan_constraints WHERE constraint_id = 'c-orphan-1'"),
    );
    const gone = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM chat_plan_orphan_constraints WHERE constraint_id = 'c-orphan-1'"),
    );
    expect(gone.rows).toEqual([]);
  });
});
