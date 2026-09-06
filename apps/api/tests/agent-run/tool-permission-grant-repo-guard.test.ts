/**
 * `pg-tool-permission-grant-repository.ts` 的 lint 豁免，钉在这里（Phase 14 F06）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「`tool_permission_
 * grants` 不是 `ObjectRef` 的任何一种，且三个方法都不把行内容交还给调用方，真正的裁决在
 * `decide-tool-permission.ts` 那一层」（与 `pg-admission-test-repository.ts`/
 * `pg-mcp-server-store.ts` 的豁免同一形状）。那条理由**只在三个前提成立时**有效，所以三个
 * 前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(
  new URL("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository.ts", import.meta.url),
);
const DECIDE_USE_CASE = fileURLToPath(
  new URL("../../src/application/agent-run/decide-tool-permission.ts", import.meta.url),
);
const LINT = fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url));
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

describe("(a) 只碰 tool_permission_grants，没有第二张租户表", () => {
  const ALLOWED = new Set(["tool_permission_grants"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    expect(tenant.has("tool_permission_grants"), "tool_permission_grants 不在租户表里").toBe(true);

    const named = tablesNamed(repoCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, "这个文件开始读授权表以外的租户表了，豁免理由不再成立").toEqual([]);
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

describe("(c) hasGrant 只折成布尔——从不选出授权记录的内容列", () => {
  it("唯一的 SELECT 是 EXISTS(...)，从不出现 granted_by_user_id/granted_at", () => {
    const selects = [...repoCode.matchAll(/SELECT[\s\S]*?(?=`)/gi)].map((m) => m[0]);
    expect(selects.length, "一条 SELECT 都没找到——这个断言会是空转的").toBe(1);
    for (const s of selects) {
      expect(s, "SELECT 应该是 EXISTS(...)").toMatch(/EXISTS\s*\(/i);
      expect(s, "SELECT 泄露了 granted_by_user_id").not.toMatch(/granted_by_user_id/);
      expect(s, "SELECT 泄露了 granted_at").not.toMatch(/granted_at/);
    }
  });

  it("grantForRun/grantStanding 是 void（INSERT 不 RETURNING 内容给调用方）", () => {
    expect(repoCode).toMatch(/async grantForRun\([^)]*\):\s*Promise<void>/);
    expect(repoCode).toMatch(/async grantStanding\([^)]*\):\s*Promise<void>/);
  });

  it("变异：一条选出内容列的 SELECT 会被抓到", () => {
    const planted = `SELECT granted_by_user_id, granted_at FROM tool_permission_grants`;
    expect(() => expect(planted).not.toMatch(/granted_by_user_id/)).toThrow();
  });
});

describe("(d) 上一层的可见性裁决还在——decide-tool-permission 先判定，后落库", () => {
  const decideSrc = stripComments(readFileSync(DECIDE_USE_CASE, "utf8"));

  it("visibility precedes the atomic request decision; no separate grant can escape its transaction", () => {
    const visibilityAt = decideSrc.indexOf("resolveVisibility(deps");
    const decisionAt = decideSrc.indexOf("await deps.runs.decidePermissionRequest(");
    expect(visibilityAt).toBeGreaterThanOrEqual(0);
    expect(decisionAt).toBeGreaterThan(visibilityAt);
    expect(decideSrc).not.toMatch(/deps\.grants\.grant(?:ForRun|Standing)\(/);
  });

  it("变异：把 resolveVisibility 调用整个删掉，断言必须变红", () => {
    const mutated = decideSrc.replace(/const outcome = await resolveVisibility\(deps,[\s\S]*?\}\);/, "");
    expect(mutated).not.toBe(decideSrc);
    expect(() => {
      expect(mutated).toContain("resolveVisibility(deps");
    }).toThrow();
  });
});

describe("豁免条目与本测试互相钉住", () => {
  it("ALLOWLIST 里有这一条，且点名了本文件", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/agent-run/pg-tool-permission-grant-repository.ts");
    expect(lint).toContain("tool-permission-grant-repo-guard.test.ts");
  });
});
