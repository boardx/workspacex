/**
 * 「端口只在一处声明」的机械门控。
 *
 * 2026-09-10 之前，两份 playwright config 各自用 `Number(webPort) + 5_000 / + 6_000 /
 * + 7_000 / + 10_000 / + 14_000 / + 15_000 / − 35_000` 现算五个替身端口。后果三条，
 * 都不是理论上的（完整推理见 `lib/test-isolation.ts` 的 `PORT_BASE` 头注）：
 *   ① `webPort + 5_000` 与 `SKILL_SANDBOX_PORT` 逐位相同；
 *   ② 这些端口从来没被 OS 探测过；
 *   ③ 它们全部落在内核临时端口区里（run 34454123556 attempt 1：`EADDRINUSE :::47474`，
 *      零用例执行仍报 failure）。
 *
 * 修好一次不够——同样的算法当年是被两份 config 各自"顺手"写出来的。这道门让第三次
 * 顺手当场变红：端口只许从隔离外壳的环境变量里 `required()` 出来。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PORT_BASE } from "./lib/test-isolation";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_E2E_DIR = join(REPO_ROOT, "apps/web");

/** 端口算术：对隔离外壳给的端口做加减，等于凭空造一个没人探测过的第二事实源。 */
const PORT_ARITHMETIC = /Number\(\s*(?:webPort|apiPort|pgPort)\s*\)\s*[+\-]|\b(?:webPort|apiPort)\s*\)\s*[+\-]\s*\d/;

function playwrightConfigs(): string[] {
  return readdirSync(WEB_E2E_DIR)
    .filter((name) => name.startsWith("playwright.") && name.endsWith(".config.ts"))
    .map((name) => join(WEB_E2E_DIR, name));
}

describe("隔离端口只有一处声明", () => {
  it("测试前置：确实扫到了 playwright config（空集合会让本门控空转）", () => {
    expect(playwrightConfigs().length).toBeGreaterThan(3);
  });

  it("没有任何 playwright config 用端口算术现算第二份端口", () => {
    const offenders = playwrightConfigs().filter((file) => {
      const source = readFileSync(file, "utf8")
        // 头注里逐字引用旧写法是**故意保留的**教训记录，不是活代码。
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/)/.test(line))
        .join("\n");
      return PORT_ARITHMETIC.test(source);
    });
    expect(offenders.map((f) => f.slice(REPO_ROOT.length)), "端口只许从隔离外壳 required() 出来").toEqual([]);
  });

  it("反证：这条正则确实认得出旧写法", () => {
    expect(PORT_ARITHMETIC.test('const p = String(Number(webPort) + 5_000);')).toBe(true);
    expect(PORT_ARITHMETIC.test('const p = String(Number(webPort) - 35_000);')).toBe(true);
    expect(PORT_ARITHMETIC.test('const p = required("WORKSPACEX_MODEL_PROVIDER_PORT");')).toBe(false);
  });

  it("每个角色的段起点两两不同，且段与段不重叠", () => {
    const bases = Object.values(PORT_BASE).sort((a, b) => a - b);
    expect(new Set(bases).size).toBe(bases.length);
    for (let i = 1; i < bases.length; i += 1) expect(bases[i]! - bases[i - 1]!).toBeGreaterThanOrEqual(1_000);
  });
});
