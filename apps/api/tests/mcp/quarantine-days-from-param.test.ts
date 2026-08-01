import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeQuarantineUntil, defaultQuarantineDays } from "../../src/domain/mcp/quarantine";
import { THRESHOLDS } from "@repo/contracts/thresholds";

/**
 * F131 (UC-21.1 R3 步骤 3 补 / I-30′) -- 隔离期天数读组织参数，代码中不存在裸字面量 14.
 *
 * 验收动作逐字（domain I-30′）："把参数改成另一个值，断言到期时间随之变化 + 代码扫描无裸 14"。
 * 这份文件既做行为断言（把 14 改成 3，`quarantineUntil` 必须跟着变），也做静态扫描断言，
 * 直接读本 feature 新增的源文件文本，确保没有裸的 `14` 字面量代表隔离期天数——
 * 与 `customer-data-trace-retention-param.test.ts` 对 180 的扫描同一形状。
 */

describe("F131 · defaultQuarantineDays -- 唯一事实源是 THRESHOLDS.mcpQuarantineDays", () => {
  it("默认值取自 thresholds.ts，不是本文件另开的常量", () => {
    expect(defaultQuarantineDays()).toBe(14);
    expect(THRESHOLDS.mcpQuarantineDays.value).toBe(14);
  });

  it("该默认值有原型出处（区别于无出处的默认值）", () => {
    expect(THRESHOLDS.mcpQuarantineDays.known).toBe(true);
    expect(THRESHOLDS.mcpQuarantineDays.source).toContain("16,683,800");
  });
});

describe("F131 · 把组织参数从 14 改成 3 ⇒ quarantineUntil 随之变化", () => {
  const registeredAt = new Date("2026-08-01T00:00:00Z");

  it("14 天参数：截止时刻是注册时刻之后整整 14 天", () => {
    const until14 = computeQuarantineUntil(registeredAt, 14);
    expect(until14).toBe("2026-08-15T00:00:00.000Z");
  });

  it("把参数从 14 改成 3：截止时刻随之变化——不是恒定输出", () => {
    const until14 = computeQuarantineUntil(registeredAt, 14);
    const until3 = computeQuarantineUntil(registeredAt, 3);
    expect(until3).not.toBe(until14);
    expect(until3).toBe("2026-08-04T00:00:00.000Z");
  });

  it("新注册服务器的截止时刻随组织参数变化，不是「先算好再看要不要用」", () => {
    const daysOptions = [1, 3, 7, 14, 30];
    const results = daysOptions.map((d) => computeQuarantineUntil(registeredAt, d));
    // 五个不同天数产出五个不同的截止时刻——不存在两个不同参数算出同一个时间戳的塌缩。
    expect(new Set(results).size).toBe(daysOptions.length);
  });
});

describe("F131 · 静态断言：代码中不存在硬编码 14 代表隔离期天数", () => {
  const filesToScan = [
    "src/domain/mcp/quarantine.ts",
    "src/application/mcp/record-quarantine-call.ts",
  ];

  it("这些源文件里没有裸的数字 14（只允许出现在注释里引用原型出处时）", () => {
    for (const rel of filesToScan) {
      const abs = join(__dirname, "../../", rel);
      const text = readFileSync(abs, "utf8");
      const codeOnly = text
        .split("\n")
        .filter((line) => !/^\s*\*/.test(line) && !line.trim().startsWith("//"))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(codeOnly, `${rel} 的可执行代码部分不应包含裸字面量 14`).not.toMatch(/\b14\b/);
    }
  });

  it("唯一允许存在字面量 14 的地方是 thresholds.ts 的 `value: 14`（有 source 出处的登记项）", () => {
    const abs = join(__dirname, "../../../../packages/contracts/src/thresholds.ts");
    const text = readFileSync(abs, "utf8");
    const idx = text.indexOf("mcpQuarantineDays");
    expect(idx).toBeGreaterThan(-1);
    const entryBlock = text.slice(idx, idx + 400);
    expect(entryBlock).toContain("value: 14");
    expect(entryBlock).toContain("source:");
  });
});
