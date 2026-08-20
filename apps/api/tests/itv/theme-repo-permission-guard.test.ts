/**
 * `lint-permission-paths` 白名单条目（F04，#1649）的守卫测试——`pg-theme-repository.ts`。
 *
 * 与 `tests/itv/insight-segment-reader-repo-guard.test.ts`（F01 的同型条目）同一纪律：
 * 白名单条目声称的三条前提在这里变成机械断言。
 *
 * ⛔ **若本文件被删除，`scripts/lint-permission-paths.mjs` 里 `pg-theme-repository.ts`
 * 那条白名单条目必须一并删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const themeRepo = readFileSync(new URL("../../src/infrastructure/interview/pg-theme-repository.ts", import.meta.url), "utf8");
const interfaceDir = fileURLToPath(new URL("../../src/interface/", import.meta.url));

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("白名单条目前提 ①：pg-theme-repository.ts 只命名它声称的四张租户表", () => {
  it("只命名 interview_themes / interview_theme_operations / interview_quotes / interview_insights", () => {
    // `LATERAL` 是 `JOIN LATERAL` 的关键字，不是表名——`unnest(...)` 之后的 `eq(quote_id)`
    // 是列别名，同样不是表；把它们从"发现的表名"里剔除,不然这条断言会把 SQL 语法词
    // 误判成第五张表。
    expect(tablesNamedIn(themeRepo)).toEqual(
      new Set(["interview_themes", "interview_theme_operations", "interview_quotes", "interview_insights", "lateral"]),
    );
  });
});

describe("白名单条目前提 ②：pg-theme-repository.ts 不调用 withoutTenant", () => {
  it("不出现 withoutTenant", () => {
    expect(themeRepo.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目前提 ③：src/interface/ 下没有文件直接 import pg-theme-repository.ts", () => {
  it("本 feature 未接 HTTP controller（has_ui:false，见 theme-ports.ts 头注）", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        const full = `${d}/${entry}`;
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("pg-theme-repository")) offenders.push(full);
      }
    };
    walk(interfaceDir);
    expect(offenders).toEqual([]);
  });
});
