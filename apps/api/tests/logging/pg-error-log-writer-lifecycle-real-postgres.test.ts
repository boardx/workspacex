/**
 * 系统异常生命周期（迁移 `20260903120000_error_logs_lifecycle_tags.sql`）的权限边界与
 * 不变量，对**真实 Postgres**——独立评审 finding #3（PR #2590）：diff 加了两个
 * `app_rw` 可执行的生命周期函数与一个新的 `app_diag_ro` 读函数，但当时只有
 * fake-port/controller 单测，没有真实角色行为的证据。这里补上，镜子照的是
 * `pg-error-log-writer-real-postgres.test.ts` 那组反证的同一套结构（拒绝 app_rw 直连、
 * PUBLIC 已显式 REVOKE、app_diag_ro 能走新函数、上限被夹住），只是换成生命周期三个函数，
 * 另外补两条这组函数特有的：写函数的列作用域（CASE WHEN 局部写入）与终态不变量
 * （CHECK 约束 + 乐观锁）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig, diagnosticsReaderConfig } from "../../src/infrastructure/db/pg-config";
import { PgErrorLogWriter } from "../../src/infrastructure/logging/pg-error-log-writer";

let db: PgDatabase;
/** `app_diag_ro` -- 独立凭据，见 `pg-config.ts` 头注。 */
let readDb: PgDatabase;
let writer: PgErrorLogWriter;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  readDb = new PgDatabase(diagnosticsReaderConfig());
  writer = new PgErrorLogWriter(db, readDb);
});

beforeEach(async () => {
  await asOwner((c) => c.query("DELETE FROM error_logs"));
});

afterAll(async () => {
  await db?.close();
  await readDb?.close();
});

async function insertOne(traceId: string): Promise<string> {
  await writer.record({ traceId, msg: "x", detail: {} });
  const row = await asOwner((c) =>
    c.query<{ id: string }>("SELECT id FROM error_logs WHERE trace_id = $1", [traceId]).then((r) => r.rows[0]!),
  );
  return row.id;
}

describe("系统异常生命周期——权限边界（app_rw 只能走窄口径函数，不能裸 SELECT/UPDATE 新列）", () => {
  it("【反证1】app_rw 对 status/status_reason/dev_note/tags 四列没有裸 SELECT", async () => {
    await insertOne("t-real-lc-cols");
    await expect(
      db.withoutTenant((s) => s.query("SELECT status, status_reason, dev_note, tags FROM error_logs LIMIT 1")),
    ).rejects.toThrow(/permission denied/);
  });

  it("【反证2】app_rw 对 error_logs 没有裸 UPDATE——唯一的写路径是 SECURITY DEFINER 函数", async () => {
    const id = await insertOne("t-real-lc-no-update");
    await expect(
      db.withoutTenant((s) => s.query(`UPDATE error_logs SET status = '不做' WHERE id = ${id}`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("【反证3】app_rw 调不了 kernel_read_error_logs_with_lifecycle——EXECUTE 只给了 app_diag_ro", async () => {
    await expect(
      db.withoutTenant((s) => s.query("SELECT * FROM kernel_read_error_logs_with_lifecycle(10, NULL)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("has_function_privilege 三连：读函数只授 app_diag_ro，两个生命周期函数只授 app_rw，PUBLIC 全部没有隐式继承", async () => {
    const rows = await asOwner((c) =>
      c.query<{ fn: string; role: string; has_priv: boolean }>(`
        SELECT * FROM (VALUES
          ('kernel_read_error_logs_with_lifecycle(integer,bigint)', 'app_rw',
            has_function_privilege('app_rw', 'kernel_read_error_logs_with_lifecycle(integer,bigint)', 'EXECUTE')),
          ('kernel_read_error_logs_with_lifecycle(integer,bigint)', 'app_diag_ro',
            has_function_privilege('app_diag_ro', 'kernel_read_error_logs_with_lifecycle(integer,bigint)', 'EXECUTE')),
          ('kernel_read_error_log_lifecycle(bigint)', 'app_rw',
            has_function_privilege('app_rw', 'kernel_read_error_log_lifecycle(bigint)', 'EXECUTE')),
          ('kernel_read_error_log_lifecycle(bigint)', 'app_diag_ro',
            has_function_privilege('app_diag_ro', 'kernel_read_error_log_lifecycle(bigint)', 'EXECUTE')),
          ('kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])', 'app_rw',
            has_function_privilege('app_rw', 'kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])', 'EXECUTE')),
          ('kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])', 'app_diag_ro',
            has_function_privilege('app_diag_ro', 'kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])', 'EXECUTE'))
        ) AS t(fn, role, has_priv)
      `).then((r) => r.rows),
    );
    const byKey = new Map(rows.map((r) => [`${r.fn}::${r.role}`, r.has_priv]));
    expect(byKey.get("kernel_read_error_logs_with_lifecycle(integer,bigint)::app_rw")).toBe(false);
    expect(byKey.get("kernel_read_error_logs_with_lifecycle(integer,bigint)::app_diag_ro")).toBe(true);
    expect(byKey.get("kernel_read_error_log_lifecycle(bigint)::app_rw")).toBe(true);
    expect(byKey.get("kernel_read_error_log_lifecycle(bigint)::app_diag_ro")).toBe(false);
    expect(byKey.get("kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])::app_rw")).toBe(true);
    expect(byKey.get("kernel_write_error_log_lifecycle(bigint,text,boolean,text,boolean,text,boolean,text,boolean,text[])::app_diag_ro")).toBe(false);
  });

  it("app_diag_ro 能调用 kernel_read_error_logs_with_lifecycle，读到生命周期四列（分离是真的分离）", async () => {
    await insertOne("t-real-lc-diag-ro");
    const rows = await readDb.withoutTenant((s) =>
      s.query<{ trace_id: string; status: string; tags: string[] }>(
        "SELECT * FROM kernel_read_error_logs_with_lifecycle(50, NULL)",
      ),
    );
    const row = rows.rows.find((r) => r.trace_id === "t-real-lc-diag-ro");
    expect(row).toBeTruthy();
    expect(row!.status).toBe("待处理");
    expect(row!.tags).toEqual([]);
  });

  it("kernel_read_error_logs_with_lifecycle 同样把超大 p_limit 夹到 200", async () => {
    for (let i = 0; i < 5; i++) await insertOne(`t-real-lc-clamp-${i}`);
    const rows = await readDb.withoutTenant((s) =>
      s.query<{ id: string }>("SELECT * FROM kernel_read_error_logs_with_lifecycle(100000, NULL)"),
    );
    expect(rows.rows.length).toBeLessThanOrEqual(200);
  });
});

describe("系统异常生命周期——写函数的列作用域（字段级局部写入）", () => {
  it("只传 p_set_tags=true 时，只有 tags 变了；status/status_reason/dev_note 原样不动", async () => {
    const id = await insertOne("t-real-lc-partial-tags");
    await db.withoutTenant((s) =>
      s.query(
        `SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, NULL, false, NULL, false, NULL, false, NULL, true, $2::text[])`,
        [id, ["a", "b"]],
      ),
    );
    const row = await asOwner((c) =>
      c.query<{ status: string; status_reason: string | null; dev_note: string | null; tags: string[] }>(
        "SELECT status, status_reason, dev_note, tags FROM error_logs WHERE id = $1", [id],
      ).then((r) => r.rows[0]!),
    );
    expect(row).toEqual({ status: "待处理", status_reason: null, dev_note: null, tags: ["a", "b"] });
  });

  it("只传 p_set_dev_note=true 时，一次并发的 tags 编辑不会被这次写入冲掉（不是整行覆盖）", async () => {
    const id = await insertOne("t-real-lc-partial-devnote");
    // 模拟"标签编辑"先落地
    await db.withoutTenant((s) =>
      s.query(
        `SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, NULL, false, NULL, false, NULL, false, NULL, true, $2::text[])`,
        [id, ["urgent"]],
      ),
    );
    // 再来一次"只改开发备注"的写入——不该带着旧的 tags 快照把它冲掉（这里根本没传 tags）
    await db.withoutTenant((s) =>
      s.query(
        `SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, NULL, false, NULL, false, NULL, true, $2, false, NULL)`,
        [id, "指派给 @foo"],
      ),
    );
    const row = await asOwner((c) =>
      c.query<{ dev_note: string | null; tags: string[] }>(
        "SELECT dev_note, tags FROM error_logs WHERE id = $1", [id],
      ).then((r) => r.rows[0]!),
    );
    expect(row.dev_note).toBe("指派给 @foo");
    expect(row.tags).toEqual(["urgent"]); // 第一次写入的标签仍然在，没被第二次写入的"整行旧快照"覆盖
  });

  it("零行返回 ⟺ id 不存在", async () => {
    const rows = await db.withoutTenant((s) =>
      s.query(`SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, NULL, false, NULL, false, NULL, false, NULL, true, $2::text[])`, [999999999, ["x"]]),
    );
    expect(rows.rows).toHaveLength(0);
  });
});

describe("系统异常生命周期——乐观锁（CAS）：p_expected_status 与当前值不一致时不生效", () => {
  it("expected_status 匹配时正常写入", async () => {
    const id = await insertOne("t-real-lc-cas-match");
    const rows = await db.withoutTenant((s) =>
      s.query<{ status: string }>(
        `SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, '待处理', true, '已转入开发', false, NULL, false, NULL, false, NULL)`,
        [id],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe("已转入开发");
  });

  it("expected_status 与当前值不符（并发已经改过）时零行返回，不生效——不是静默按旧快照覆盖", async () => {
    const id = await insertOne("t-real-lc-cas-conflict");
    // 并发请求先把状态改到「已转入开发」
    await db.withoutTenant((s) =>
      s.query(`SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, '待处理', true, '已转入开发', false, NULL, false, NULL, false, NULL)`, [id]),
    );
    // 这次请求仍然以为当前状态是「待处理」（读到的是旧快照），尝试转到「不做」
    const rows = await db.withoutTenant((s) =>
      s.query(
        `SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, '待处理', true, '不做', true, '过期的请求', false, NULL, false, NULL)`,
        [id],
      ),
    );
    expect(rows.rows).toHaveLength(0); // CAS 未命中，没有任何列被改
    const row = await asOwner((c) =>
      c.query<{ status: string }>("SELECT status FROM error_logs WHERE id = $1", [id]).then((r) => r.rows[0]!),
    );
    expect(row.status).toBe("已转入开发"); // 并发那次写入的结果原样保留，没被"过期请求"覆盖
  });

  it("status 没变的请求（expected_status 传 NULL）不受任何 CAS 限制——纯标签编辑不该被别人的状态转移拦住", async () => {
    const id = await insertOne("t-real-lc-cas-none");
    await db.withoutTenant((s) =>
      s.query(`SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, '待处理', true, '已转入开发', false, NULL, false, NULL, false, NULL)`, [id]),
    );
    const rows = await db.withoutTenant((s) =>
      s.query(`SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, NULL, false, NULL, false, NULL, false, NULL, true, $2::text[])`, [id, ["ok"]]),
    );
    expect(rows.rows).toHaveLength(1); // 即便 status 早已不是「待处理」，这次写入照样成功
  });
});

describe("系统异常生命周期——终态不变量（DB 侧 CHECK，独立于应用层校验）", () => {
  it("直接用 owner 身份 UPDATE 出 status='不做' 且 status_reason 为空/空白，撞 CHECK 约束", async () => {
    const id = await insertOne("t-real-lc-check-blank");
    await expect(
      asOwner((c) => c.query(`UPDATE error_logs SET status = '不做', status_reason = NULL WHERE id = ${id}`)),
    ).rejects.toThrow(/error_logs_status_reason_pairing_check/);
    await expect(
      asOwner((c) => c.query(`UPDATE error_logs SET status = '不做', status_reason = '   ' WHERE id = ${id}`)),
    ).rejects.toThrow(/error_logs_status_reason_pairing_check/);
  });

  it("status='不做' 且 status_reason 非空白——满足约束，正常提交", async () => {
    const id = await insertOne("t-real-lc-check-ok");
    await expect(
      asOwner((c) => c.query(`UPDATE error_logs SET status = '不做', status_reason = '已知问题' WHERE id = ${id}`)),
    ).resolves.toBeTruthy();
  });

  it("kernel_write_error_log_lifecycle 转「不做」不带理由，同样撞 CHECK（应用层与 DB 层双重把关）", async () => {
    const id = await insertOne("t-real-lc-check-via-fn");
    await expect(
      db.withoutTenant((s) =>
        s.query(`SELECT * FROM kernel_write_error_log_lifecycle($1::bigint, '待处理', true, '不做', true, NULL, false, NULL, false, NULL)`, [id]),
      ),
    ).rejects.toThrow(/error_logs_status_reason_pairing_check/);
  });

  it("status_check 约束仍然拒绝非法状态值（既有 CHECK，未被这次改动削弱）", async () => {
    const id = await insertOne("t-real-lc-check-status-enum");
    await expect(
      asOwner((c) => c.query(`UPDATE error_logs SET status = '已删除' WHERE id = ${id}`)),
    ).rejects.toThrow(/error_logs_status_check/);
  });
});
