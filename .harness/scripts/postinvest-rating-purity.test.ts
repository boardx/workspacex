/**
 * A7 的另一半（`docs/agents/team2-acceptance-rubric.md`）—— 评分引擎必须是**纯的**。
 *
 * 为什么光靠「连跑两次比对」不够：2026-09-15 实测，把 `Date.now() % 2` 注进 `cashScore`
 * 之后，验收脚本连跑两次**照样 exit 0**——两次调用落在同一毫秒，时间依赖在那个尺度上
 * 看起来完全确定。双跑抓得住 `Math.random()` 和迭代顺序问题，抓不住时间依赖，而时间
 * 依赖恰恰是最阴的一种：今天两次一致，跨天重跑就变了分。
 *
 * 所以这里换一种证明方式——不证明「两次相同」，而证明「不可能不同」：评分模块里不许
 * 出现任何非确定性来源。这是 R7 业务规则 2（同一输入两次运行得分逐位一致）与 R9
 * 可复现（任何版本可原样重跑并得到相同分数）的机械表达。
 *
 * 只扫 `domain/postinvest-rating/`：那是评分路径本身。上层应用/接口层做 I/O 是它们的
 * 职责，不在此列。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCORING = resolve(import.meta.dirname, "../../apps/api/src/domain/postinvest-rating/scoring.ts");
const source = readFileSync(SCORING, "utf8");

/** 去掉注释与字符串字面量：注释里提到 `Date.now()` 是在讲道理，不是在调用它。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "")
  .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bDate\s*\.\s*now\b/, why: "时间依赖：同一份报表跨天重跑会得到不同的分" },
  { pattern: /\bnew\s+Date\b/, why: "时间依赖：同上" },
  { pattern: /\bMath\s*\.\s*random\b/, why: "随机：同一输入两次运行不一致" },
  { pattern: /\bcrypto\b/, why: "随机/环境依赖" },
  { pattern: /\bprocess\s*\.\s*env\b/, why: "环境依赖：换台机器就换个分数" },
  { pattern: /\bfetch\s*\(|\brequire\s*\(|\bfs\b/, why: "I/O：评分不该读外部状态" },
];

describe("评分引擎是纯函数", () => {
  for (const { pattern, why } of FORBIDDEN) {
    it(`不出现 ${pattern.source} —— ${why}`, () => {
      expect(code).not.toMatch(pattern);
    });
  }

  it("只 import 规则手册常量，不 import 任何运行时依赖", () => {
    const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["@repo/contracts/postinvest-rating-rules"]);
  });
});
