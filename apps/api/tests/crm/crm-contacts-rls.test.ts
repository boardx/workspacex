// @global-scope-fixture table:crm_contacts: 无 org_id 的平台运营自有表；本文件只写 lead_ 前缀随机 id 的行并在 afterAll 删除。
/**
 * D3 —— `crm_contacts` 的行级门（真 PostgreSQL，app_rw 身份）：
 *   · 不设 `app.crm_operator` 的会话读不到、写不进（纵深防御：其他代码路径拿到连接也碰不到个人信息）；
 *   · PgCrmContactRepository 设了标记，增删改查走得通；
 *   · 自检：先证明有行（空集不算绿），再证明无标记时看到 0 行。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newLeadId } from "../../src/application/crm/crm-contact-ports";
import { PgCrmContactRepository } from "../../src/infrastructure/crm/pg-crm-contact-repository";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";

const created: string[] = [];
const db = {
  withoutTenant: (fn) => asApp(null, (c) => fn({ query: (sql, params) => c.query(sql, params as unknown[]) as never })),
  withTenant: () => { throw new Error("not used"); },
  close: async () => undefined,
} as DatabasePort;
const repo = new PgCrmContactRepository(db);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});
afterAll(async () => {
  if (created.length) await asOwner((c) => c.query("DELETE FROM crm_contacts WHERE lead_id = ANY($1)", [created]));
});

describe("crm_contacts 行级门", () => {
  it("仓储（带运营标记）增删改查", async () => {
    const id = newLeadId();
    created.push(id);
    const c = await repo.create(id, { name: "测试联系人", company: "测试公司", email: "t@example.com" }, "u_test");
    expect(c.leadId).toBe(id);
    expect((await repo.update(id, { notes: "回访" }))?.notes).toBe("回访");
    expect((await repo.get(id))?.company).toBe("测试公司");
    const other = newLeadId();
    created.push(other);
    await repo.create(other, { name: "待删" }, "u_test");
    expect(await repo.delete(other)).toBe(true);
    expect(await repo.get(other)).toBeNull();
  });

  it("不设运营标记的 app_rw 会话：表里有行，但读到 0 行、写入被拒", async () => {
    const total = await asOwner(async (c) => Number((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM crm_contacts")).rows[0]!.n));
    expect(total, "先证明表里有行，否则「读到 0 行」是空集假绿").toBeGreaterThan(0);
    const seen = await asApp(null, async (c) => (await c.query("SELECT lead_id FROM crm_contacts")).rows.length);
    expect(seen).toBe(0);
    await expect(asApp(null, (c) => c.query(
      "INSERT INTO crm_contacts (lead_id, name, created_by) VALUES ($1, 'x', 'u')", [newLeadId()],
    ))).rejects.toThrow(/row-level security/);
  });
});
