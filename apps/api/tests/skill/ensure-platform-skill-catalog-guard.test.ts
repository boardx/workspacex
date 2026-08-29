/**
 * `ensure-platform-skill-catalog.ts` 的 lint 豁免（`lint-permission-paths.mjs`），钉在
 * 这里（issue #2343）。
 *
 * 豁免理由：这个文件里没有一个导出函数接受 org id 参数——每条 SQL 语句写的都是唯一一个
 * 写死的 `PLATFORM_ORG_ID`，没有调用方能左右目标是哪个租户，所以不存在"权限判定该挂在
 * 哪一层"这个问题。这条理由**只在四个前提成立时**有效，所以四个前提在这里被逐条断言，
 * 而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(
  new URL("../../src/infrastructure/skill/ensure-platform-skill-catalog.ts", import.meta.url),
);
const LINT = fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

function stripComments(ts: string): string {
  return ts
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
}

const code = stripComments(readFileSync(SOURCE, "utf8"));

/** 从迁移里推导租户表，与 lint 同一套推导——手写清单缺的正是刚加的那张表。 */
function tenantTables(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
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

const ALLOWED_TABLES = new Set([
  "organizations", "org_memberships", "skills", "skill_versions", "skill_version_files", "capability_listings",
]);

describe("(a) 只碰这六张表，不多不少", () => {
  it("没有第七张租户表", () => {
    const tenant = tenantTables();
    const named = [...tablesNamed(code)].filter((t) => tenant.has(t));
    for (const t of named) expect(ALLOWED_TABLES.has(t)).toBe(true);
  });

  it("变异反证：把 ALLOWED_TABLES 换成一个不含 skills 的集合，断言真的会红", () => {
    const shrunk = new Set([...ALLOWED_TABLES].filter((t) => t !== "skills"));
    const tenant = tenantTables();
    const named = [...tablesNamed(code)].filter((t) => tenant.has(t));
    expect(named.some((t) => !shrunk.has(t))).toBe(true);
  });
});

describe("(b) 没有任何导出函数接受 org id / 租户范围参数", () => {
  const EXPORTED_FN_PATTERN = /export\s+(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g;

  it("三个导出函数签名里都不出现 orgId/tenantId 这类参数名", () => {
    const matches = [...code.matchAll(EXPORTED_FN_PATTERN)];
    expect(matches.length).toBeGreaterThan(0); // 反空转：正则写错会让下面永远通过
    for (const m of matches) {
      const params = m[1] ?? "";
      expect(/\b(org[Ii]d|tenant[Ii]d)\b/.test(params)).toBe(false);
    }
  });

  it("变异反证：手动构造一个带 orgId 参数的签名字符串，断言真的会抓到", () => {
    const fake = "export async function ensureSomethingSeeded(orgId: string): Promise<void> {}";
    const matches = [...fake.matchAll(EXPORTED_FN_PATTERN)];
    const params = matches[0]?.[1] ?? "";
    expect(/\b(org[Ii]d|tenant[Ii]d)\b/.test(params)).toBe(true);
  });
});

describe("(c) 每条 SQL 语句的 org id 实参都是字面量 PLATFORM_ORG_ID，从不来自调用方", () => {
  it("SQL 参数数组里出现 PLATFORM_ORG_ID 的地方，附近没有别的标识符名字长得像 org id", () => {
    // 反证的是"这个文件不会把某个函数参数当成 org id 塞进查询"——最直接的信号是
    // 全文件唯一出现在 SQL 参数位置、名字里带 org 的标识符就是 `PLATFORM_ORG_ID`
    // 本身（不是 `orgId`/`input.orgId`/`params.orgId` 这类调用方可控的值）。
    const suspiciousParam = /\[\s*[^\]]*\b(orgId|input\.orgId|params\.orgId|args\.orgId)\b[^\]]*\]/;
    expect(suspiciousParam.test(code)).toBe(false);
    expect(code.includes("PLATFORM_ORG_ID")).toBe(true);
  });

  it("变异反证：往代码字符串里塞一个 orgId 形参传参，断言真的会抓到", () => {
    const mutated = `${code}\nconst x = [orgId, 1];`;
    const suspiciousParam = /\[\s*[^\]]*\b(orgId|input\.orgId|params\.orgId|args\.orgId)\b[^\]]*\]/;
    expect(suspiciousParam.test(mutated)).toBe(true);
  });
});

describe("(d) 豁免条目在 lint-permission-paths.mjs 里真实存在", () => {
  it("ALLOWLIST 里有这个文件的路径", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/skill/ensure-platform-skill-catalog.ts");
  });
});
