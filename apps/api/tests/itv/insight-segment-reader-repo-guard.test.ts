/**
 * `lint-permission-paths` 白名单四条条目（F01，#1628）的守卫测试——
 * `pg-segment-reader.ts` / `pg-interview-quote-repository.ts` /
 * `pg-interview-insight-repository.ts` / `pg-consent-decline-reader.ts`。
 *
 * 与 `tests/skill/org-agent-model-reader-repo-guard.test.ts` 同一条纪律：白名单条目
 * 声称「授权在这次读之前一层完成」，本文件把这句声明变成机械事实——条目依赖的
 * 任一前提破掉，这里当场红。
 *
 * ⛔ **若本文件被删除，`scripts/lint-permission-paths.mjs` 里这四条白名单条目必须
 * 一并删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

const segmentReader = src("infrastructure/interview/pg-segment-reader.ts");
const quoteRepo = src("infrastructure/interview/pg-interview-quote-repository.ts");
const insightRepo = src("infrastructure/interview/pg-interview-insight-repository.ts");
const consentDeclineReader = src("infrastructure/interview/pg-consent-decline-reader.ts");
const extractQuotesUseCase = src("application/interview/extract-quotes.ts");
const interfaceDir = new URL("../../src/interface/", import.meta.url);

/** 从 SQL 里抠出 FROM / JOIN / INTO / UPDATE 后面的表名。 */
function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("白名单条目前提 ①：每个文件只命名它声称的租户表", () => {
  it("pg-segment-reader.ts 只命名 segment_text / interview_subjects", () => {
    expect(tablesNamedIn(segmentReader)).toEqual(new Set(["segment_text", "interview_subjects"]));
  });

  it("pg-interview-quote-repository.ts 只命名 interview_quotes", () => {
    expect(tablesNamedIn(quoteRepo)).toEqual(new Set(["interview_quotes"]));
  });

  it("pg-interview-insight-repository.ts 只命名两张洞察表", () => {
    expect(tablesNamedIn(insightRepo)).toEqual(
      new Set(["interview_insight_source_snapshots", "interview_insights"]),
    );
  });

  it("pg-consent-decline-reader.ts 只命名 interview_consent_submissions（`latest` 是 CTE 别名，不是表）", () => {
    expect(tablesNamedIn(consentDeclineReader)).toEqual(
      new Set(["interview_consent_submissions", "latest"]),
    );
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });
});

describe("白名单条目前提 ②：四个文件都不调用 withoutTenant", () => {
  it.each([
    ["pg-segment-reader.ts", segmentReader],
    ["pg-interview-quote-repository.ts", quoteRepo],
    ["pg-interview-insight-repository.ts", insightRepo],
    ["pg-consent-decline-reader.ts", consentDeclineReader],
  ])("%s", (_name, source) => {
    expect(source.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目前提 ③：extractQuotes 的授权排在片段读取/引述写入之前", () => {
  it("assertVisible 排在 segments.readSegments 之前", () => {
    const authAt = extractQuotesUseCase.indexOf("await assertVisible(");
    const readAt = extractQuotesUseCase.indexOf("deps.segments.readSegments");
    expect(authAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(readAt);
  });

  it("assertVisible 排在 quotes.insertMany 之前", () => {
    const authAt = extractQuotesUseCase.indexOf("await assertVisible(");
    const writeAt = extractQuotesUseCase.indexOf("deps.quotes.insertMany");
    expect(authAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(writeAt);
  });
});

describe("白名单条目前提 ④：pg-interview-insight-repository.ts 未被 interface/ 直接 import", () => {
  it("interface 层只经 INSIGHT_REPOSITORY DI token 拿端口类型，不 import 具体实现", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(interfaceDir);
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        const full = `${d}/${entry}`;
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("pg-interview-insight-repository")) offenders.push(full);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
