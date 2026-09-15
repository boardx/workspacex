/**
 * `ensure-ic-review-skill.ts` 的 lint 豁免（`lint-permission-paths.mjs`）钉在这里。
 *
 * 豁免理由：唯一的导出函数 `ensureIcReviewSkillSeeded()` 不接受任何参数，每条 SQL 的
 * 租户实参都是写死的 `PLATFORM_ORG_ID`，没有调用方能左右目标是哪个租户，所以不存在
 * 「权限判定该挂在哪一层」这个问题。这条理由**只在三个前提成立时**有效，所以三个前提
 * 在这里被逐条断言，而不是留在注释里当声明——与
 * `ensure-platform-skill-catalog-guard.test.ts` 同一套做法（那个文件是本文件的原型）。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(
  new URL("../../src/infrastructure/skill/ensure-ic-review-skill.ts", import.meta.url),
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
  "skills", "skill_versions", "skill_version_files", "capability_listings",
]);

describe("(a) 只碰这四张表，不多不少", () => {
  it("没有第五张租户表", () => {
    const tenant = tenantTables();
    const named = [...tablesNamed(code)].filter((t) => tenant.has(t));
    expect(named.length).toBeGreaterThan(0); // 反空转：正则写错会让下面永远通过
    for (const t of named) expect(ALLOWED_TABLES.has(t)).toBe(true);
  });

  it("变异反证：把 ALLOWED_TABLES 换成不含 skill_versions 的集合，断言真的会红", () => {
    const shrunk = new Set([...ALLOWED_TABLES].filter((t) => t !== "skill_versions"));
    const tenant = tenantTables();
    const named = [...tablesNamed(code)].filter((t) => tenant.has(t));
    expect(named.some((t) => !shrunk.has(t))).toBe(true);
  });
});

describe("(b) 没有任何导出函数接受 org id / 租户范围参数", () => {
  const EXPORTED_FN_PATTERN = /export\s+(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g;

  it("导出函数签名里都不出现 orgId/tenantId 这类参数名", () => {
    const matches = [...code.matchAll(EXPORTED_FN_PATTERN)];
    expect(matches.length).toBeGreaterThan(0);
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

describe("(c) 每条 SQL 的 org id 实参都是字面量 PLATFORM_ORG_ID，从不来自调用方", () => {
  const SUSPICIOUS_PARAM = /\[\s*[^\]]*\b(orgId|input\.orgId|params\.orgId|args\.orgId)\b[^\]]*\]/;

  it("SQL 参数数组里没有任何调用方可控的 org id 标识符", () => {
    expect(SUSPICIOUS_PARAM.test(code)).toBe(false);
    expect(code.includes("PLATFORM_ORG_ID")).toBe(true);
  });

  it("不调用 withoutTenant（租户上下文只能是写死的 PLATFORM_ORG_ID）", () => {
    expect(code.includes("withoutTenant")).toBe(false);
    expect(code.includes("withTenant(toOrgId(PLATFORM_ORG_ID)")).toBe(true);
  });

  it("变异反证：往代码字符串里塞一个 orgId 形参传参，断言真的会抓到", () => {
    const mutated = `${code}\nconst x = [orgId, 1];`;
    expect(SUSPICIOUS_PARAM.test(mutated)).toBe(true);
  });
});

describe("(d) 豁免条目在 lint-permission-paths.mjs 里真实存在", () => {
  it("ALLOWLIST 里有这个文件的路径", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/skill/ensure-ic-review-skill.ts");
  });
});
