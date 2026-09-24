/**
 * D3 —— 源站 CRM 的无库单测（`pnpm run test:crm-unit`）：
 *   · 仓储每个事务的**第一句**都是设运营标记（RLS 放行的前提）；
 *   · leadId 随机、格式与契约 LEAD_ID_PATTERN 一致；
 *   · 迁移确实 ENABLE + FORCE RLS 且带策略；
 *   · 控制器每条路由都挂 PlatformOperatorGuard、都 no-store；
 *   · 契约 `crmContacts.operations` 只有源站 CRUD 四项（跨境待法务确认，不设导出类操作）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crmContacts as C } from "@repo/contracts";
import { newLeadId } from "../../src/application/crm/crm-contact-ports";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { PgCrmContactRepository } from "../../src/infrastructure/crm/pg-crm-contact-repository";

const now = new Date("2026-09-24T00:00:00Z");
function recordingDb() {
  const txs: string[][] = [];
  const db = {
    withoutTenant: async (fn) => {
      const tx: string[] = [];
      txs.push(tx);
      return fn({
        query: async (sql: string) => {
          tx.push(sql);
          return { rows: /RETURNING|SELECT lead_id/.test(sql) ? [{ lead_id: "lead_0123456789abcdef", name: "n", company: null, phone: null, email: null, notes: null, created_at: now, updated_at: now }] : [] } as never;
        },
      });
    },
    withTenant: () => { throw new Error("CRM 不属于任何租户"); },
    close: async () => undefined,
  } as DatabasePort;
  return { db, txs };
}

describe("PgCrmContactRepository", () => {
  it("每个事务先设 app.crm_operator（事务级），再做业务 SQL", async () => {
    const { db, txs } = recordingDb();
    const repo = new PgCrmContactRepository(db);
    await repo.create("lead_0123456789abcdef", { name: "n" }, "u");
    await repo.get("lead_0123456789abcdef");
    await repo.update("lead_0123456789abcdef", { notes: "x" });
    await repo.delete("lead_0123456789abcdef");
    expect(txs.length).toBe(4);
    for (const tx of txs) {
      expect(tx[0]).toBe("SELECT set_config('app.crm_operator', 'on', true)");
      expect(tx.length).toBeGreaterThan(1);
    }
  });
});

describe("leadId", () => {
  it("随机、符合契约格式", () => {
    const ids = new Set(Array.from({ length: 50 }, newLeadId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(C.LEAD_ID_PATTERN.test(id)).toBe(true);
  });
});

const API = join(import.meta.dirname, "../..");
describe("迁移与控制器的静态门", () => {
  it("crm_contacts 开 RLS 且 FORCE，有策略", () => {
    const sql = readFileSync(join(API, "migrations/20260924200000_crm_contacts.sql"), "utf8");
    expect(sql).toMatch(/ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY \w+ ON crm_contacts/);
  });
  it("每条路由都挂 PlatformOperatorGuard 与 no-store（数到了路由，空集不算绿）", () => {
    const src = readFileSync(join(API, "src/interface/controllers/crm-contact.controller.ts"), "utf8");
    const routes = src.match(/@(Get|Post|Patch|Delete)\(/g) ?? [];
    expect(routes.length).toBe(Object.keys(C.operations).length);
    expect((src.match(/@UseGuards\(PlatformOperatorGuard\)/g) ?? []).length).toBe(routes.length);
    expect((src.match(/@Header\("Cache-Control", "no-store"\)/g) ?? []).length).toBe(routes.length);
  });
  it("契约只有源站 CRUD，没有导出 / 同步 / 边缘推送类操作", () => {
    const ops = Object.values(C.operations);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(op.path).toMatch(/^\/system\/crm\/contacts(\/:leadId)?$/);
    expect(Object.keys(C.operations).filter((k) => /export|sync|push|edge|bulk/i.test(k))).toEqual([]);
  });
});
