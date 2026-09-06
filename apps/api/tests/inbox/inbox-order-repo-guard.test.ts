/**
 * `pg-inbox-order-repository.ts` 的 lint 豁免，钉在这里（UC-17.8 收件箱看板列内排序）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「`inbox_item_order`
 * 不是 `ObjectRef` 的任何一种，一行只有一个排序整数，不携带任何 D3 门控过的内容——真正的
 * 内容披露仍在 `inbox-projection.ts` 那条已经 `guard()` 过的路径上」。那条理由**只在
 * 三个前提成立时**有效，所以三个前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../src/infrastructure/inbox/pg-inbox-order-repository.ts", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

function stripComments(ts: string): string {
  return ts.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
}

const repoCode = stripComments(readFileSync(REPO, "utf8"));

/** 从迁移里推导租户表，与 lint 同一套推导——手写清单缺的正是刚加的那张表。 */
function tenantTables(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of body.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      if (/\borg_id\b/.test(m[2]!)) names.add(m[1]!);
    }
  }
  return names;
}

function tablesNamed(sql: string): ReadonlySet<string> {
  const hit = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) hit.add(m[1]!);
  return hit;
}

describe("(a) 只碰 inbox_item_order，没有第二张租户表", () => {
  const ALLOWED = new Set(["inbox_item_order"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    expect(tenant.has("inbox_item_order"), "inbox_item_order 不在租户表里").toBe(true);

    const named = tablesNamed(repoCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, `出现了豁免范围之外的租户表：${strangers.join(",")}`).toEqual([]);
  });

  it("变异：加一张陌生租户表就应该被上面那条断言抓住", () => {
    const named = tablesNamed(`${repoCode}\nSELECT * FROM product_feedback`);
    const strangers = [...named].filter((t) => tenantTables().has(t) && !ALLOWED.has(t));
    expect(strangers).toEqual(["product_feedback"]);
  });
});

describe("(b) 从不调用 withoutTenant", () => {
  it("文件里没有 withoutTenant", () => {
    expect(repoCode.includes("withoutTenant")).toBe(false);
  });
});

describe("(c) 两个方法只碰 kind/item_id/sort_order/updated_at", () => {
  const ALLOWED_COLUMNS = ["kind", "item_id", "sort_order", "updated_at", "org_id"];

  it("SELECT 列表里没有出现允许集合之外的列名", () => {
    const selectMatch = repoCode.match(/SELECT\s+([\s\S]*?)\s+FROM\s+inbox_item_order/);
    expect(selectMatch, "没找到 getOrders 的 SELECT 语句——文件形状变了，这条断言需要跟着改").not.toBeNull();
    const columns = selectMatch![1]!.split(",").map((c) => c.trim());
    for (const col of columns) {
      expect(ALLOWED_COLUMNS.includes(col), `SELECT 里出现了不在允许集合里的列：${col}`).toBe(true);
    }
  });

  it("变异：往 SELECT 里加一列内容列应该被上面那条断言抓住", () => {
    const mutated = repoCode.replace(
      "SELECT kind, item_id, sort_order FROM inbox_item_order",
      "SELECT kind, item_id, sort_order, granted_by_user_id FROM inbox_item_order",
    );
    const selectMatch = mutated.match(/SELECT\s+([\s\S]*?)\s+FROM\s+inbox_item_order/);
    const columns = selectMatch![1]!.split(",").map((c) => c.trim());
    expect(columns.includes("granted_by_user_id")).toBe(true);
  });
});
