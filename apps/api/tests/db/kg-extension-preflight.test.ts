/**
 * #4366：`age` ≥ 1.6.0 / `vector` ≥ 0.8.0 的迁移前预检（阿里云 RDS PG16：age 1.6.0 需 AliPG 内核 ≥ 20251130，vector 为 0.8.0）。
 *   - 判定逐条钉住：达标、低一个小版本、没装（看 default_version）、实例上根本没有、rc 版本号；
 *   - 真库上跑同一条 SQL：预检的结论与这个库实际的版本一致（不假设测试库本身达标——本地库可能是旧版 pgvector）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkKgExtensions, explainKgExtensionFindings, KG_EXTENSION_MINIMUMS, KG_EXTENSION_PREFLIGHT_SQL, versionAtLeast,
  type AvailableExtensionRow,
} from "../../src/infrastructure/db/kg-extension-preflight";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

const row = (name: string, installed: string | null, def: string | null = installed): AvailableExtensionRow =>
  ({ name, installed_version: installed, default_version: def });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

describe("#4366 扩展最低版本预检", () => {
  it("最低版本就是人类确认的那两个", () => {
    expect(KG_EXTENSION_MINIMUMS).toEqual({ vector: "0.8.0", age: "1.6.0" });
  });

  it("阿里云 RDS PG16 当前版本（age 1.6.0 / vector 0.8.0）通过；更高也通过", () => {
    expect(explainKgExtensionFindings(checkKgExtensions([row("age", "1.6.0"), row("vector", "0.8.0")]))).toBeNull();
    expect(explainKgExtensionFindings(checkKgExtensions([row("age", "1.7.0"), row("vector", "0.8.1")]))).toBeNull();
  });

  it("旧内核（age 1.5.0）/ 旧 pgvector（0.7.4）不通过，说明里写着要多少、现在多少、先升级 AliPG 内核小版本", () => {
    const f = checkKgExtensions([row("age", "1.5.0"), row("vector", "0.7.4")]);
    expect(f).toEqual([
      { name: "age", required: "1.6.0", found: "1.5.0", ok: false },
      { name: "vector", required: "0.8.0", found: "0.7.4", ok: false },
    ]);
    const m = explainKgExtensionFindings(f)!;
    expect(m.split("\n")).toHaveLength(2);
    expect(m).toContain('extension "age" 1.5.0 is below the required 1.6.0');
    expect(m).toContain('extension "vector" 0.7.4 is below the required 0.8.0');
    expect(m).toContain("upgrade the AliPG minor kernel");
  });

  it("没装的看 default_version（CREATE EXTENSION 会装的那个）；实例上根本没有 ⇒ 不通过", () => {
    expect(checkKgExtensions([row("age", null, "1.6.0"), row("vector", null, "0.8.0")]).every((x) => x.ok)).toBe(true);
    const f = checkKgExtensions([row("vector", "0.8.0")]);
    expect(f.find((x) => x.name === "age")).toEqual({ name: "age", required: "1.6.0", found: null, ok: false });
    expect(explainKgExtensionFindings(f)).toContain('extension "age" is not available on this PostgreSQL instance (required >= 1.6.0)');
  });

  it("版本号比较：按段比数字，不按字符串（0.10.0 > 0.8.0）；rc 段取数字前缀", () => {
    expect(versionAtLeast("0.10.0", "0.8.0")).toBe(true);
    expect(versionAtLeast("0.8", "0.8.0")).toBe(true);
    expect(versionAtLeast("1.6.0-rc0", "1.6.0")).toBe(true);
    expect(versionAtLeast("1.5.9", "1.6.0")).toBe(false);
    expect(versionAtLeast("garbage", "1.6.0")).toBe(false);
  });

  it("真库：同一条 SQL 读到两行，预检结论与实际版本一致", async () => {
    const rows = await asOwner(async (c) => (await c.query<AvailableExtensionRow>(KG_EXTENSION_PREFLIGHT_SQL)).rows);
    expect(rows.map((r) => r.name)).toEqual(["age", "vector"]);
    const f = checkKgExtensions(rows);
    for (const x of f) {
      const r = rows.find((y) => y.name === x.name)!;
      expect(x.found).toBe(r.installed_version ?? r.default_version);
      expect(x.ok).toBe(versionAtLeast(x.found!, KG_EXTENSION_MINIMUMS[x.name]));
    }
    console.log(`[#4366 preflight] ${JSON.stringify(f)}`);
  });
});
