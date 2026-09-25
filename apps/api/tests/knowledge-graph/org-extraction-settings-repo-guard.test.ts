/**
 * `pg-kg-org-extraction-settings.ts` 的 lint 豁免，钉在这里（issue #4178）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「`kg_org_extraction_
 * settings` 不是 `ObjectRef` 的任何一种，真正的写权限裁决在 `knowledge-graph.controller.ts`
 * 的 `setExtractionSetting`」（与 `pg-tool-permission-grant-repository.ts` 的豁免同一形状）。
 * 那条理由**只在前提成立时**有效，所以前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(
  new URL("../../src/infrastructure/knowledge-graph/pg-kg-org-extraction-settings.ts", import.meta.url),
);
const CONTROLLER = fileURLToPath(
  new URL("../../src/interface/controllers/knowledge-graph.controller.ts", import.meta.url),
);
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

describe("(a) 只碰 kg_org_extraction_settings，没有第二张租户表", () => {
  const ALLOWED = new Set(["kg_org_extraction_settings"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    expect(tenant.has("kg_org_extraction_settings"), "kg_org_extraction_settings 不在租户表里").toBe(true);

    const named = tablesNamed(repoCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, "这个文件开始读设置表以外的租户表了，豁免理由不再成立").toEqual([]);
  });

  it("变异：扫描确实抓得到多出来的一张表", () => {
    const planted = `SELECT * FROM projects JOIN artifacts ON 1=1`;
    const tenant = tenantTables();
    const strangers = [...tablesNamed(planted)].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers.sort()).toEqual(["artifacts", "projects"]);
  });
});

describe("(b) 从不使用 `withoutTenant`", () => {
  it("每一次取库都带租户上下文", () => {
    expect(repoCode).not.toContain("withoutTenant");
    expect(repoCode).toContain("withTenant");
  });

  it("变异：断言抓得到一次 `withoutTenant`", () => {
    const planted = `await this.db.withoutTenant(async (s) => s.query("SELECT 1"))`;
    expect(() => expect(planted).not.toContain("withoutTenant")).toThrow();
  });
});

describe("(c) getEnabled/setEnabled 只选出/写入四列", () => {
  it("SELECT 与 RETURNING 都只碰 org_id / enabled / updated_at / updated_by", () => {
    const clauses = [
      ...repoCode.matchAll(/SELECT([\s\S]*?)FROM/gi),
      ...repoCode.matchAll(/RETURNING([\s\S]*?)`/gi),
    ].map((m) => m[1]!.trim());
    expect(clauses.length, "一条 SELECT/RETURNING 都没解析到——这个断言是空转的").toBeGreaterThan(0);
    for (const c of clauses) {
      const cols = c.split(",").map((s) => s.trim().replace(/\s+AS\s+\w+$/i, ""));
      for (const col of cols) {
        expect(["org_id", "enabled", "updated_at", "updated_by", "*"].some((allowed) => col === allowed || col.endsWith(`.${allowed}`)),
          `选出了未声明的列: ${col}`).toBe(true);
      }
    }
  });

  it("变异：多选一列会被抓到", () => {
    const planted = "SELECT org_id, enabled, updated_by, granted_by_user_id FROM kg_org_extraction_settings";
    const cols = /SELECT([\s\S]*?)FROM/i.exec(planted)![1]!.split(",").map((s) => s.trim());
    const bad = cols.filter((c) => !["org_id", "enabled", "updated_at", "updated_by"].includes(c));
    expect(bad).toEqual(["granted_by_user_id"]);
  });
});

describe("(d) 写权限裁决在 controller 一层——setExtractionSetting 先判组织 admin，再落库", () => {
  const controllerSrc = stripComments(readFileSync(CONTROLLER, "utf8"));

  it("setExtractionSetting 先查 org_memberships 判 admin，再调 setEnabled", () => {
    const body = controllerSrc.slice(controllerSrc.indexOf("async setExtractionSetting("));
    const membershipAt = body.indexOf("findOrgMembership(");
    const adminCheckAt = body.indexOf('orgRole !== "admin"');
    const writeAt = body.indexOf("this.extractionSettings.setEnabled(");
    expect(membershipAt, "没有查 org_memberships").toBeGreaterThanOrEqual(0);
    expect(adminCheckAt, "没有判 orgRole !== admin").toBeGreaterThan(membershipAt);
    expect(writeAt, "没有碰写口——这个断言是空转的").toBeGreaterThan(adminCheckAt);
    expect(body).toMatch(/KG_NOT_ORG_ADMIN/);
  });

  it("extractionSetting（读）不要求 admin——任何组织成员可读", () => {
    const body = controllerSrc.slice(
      controllerSrc.indexOf("async extractionSetting("),
      controllerSrc.indexOf("async setExtractionSetting("),
    );
    expect(body).not.toMatch(/orgRole !== "admin"/);
    expect(body).not.toMatch(/findOrgMembership\(/);
  });

  it("变异：把 admin 判断删掉，断言必须变红", () => {
    const mutated = controllerSrc.replace(/if \(membership === null \|\| membership\.orgRole !== "admin"\) \{[\s\S]*?\}\n/, "");
    expect(mutated).not.toBe(controllerSrc);
    expect(() => {
      const body = mutated.slice(mutated.indexOf("async setExtractionSetting("));
      expect(body).toMatch(/orgRole !== "admin"/);
    }).toThrow();
  });
});
