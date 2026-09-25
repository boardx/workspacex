import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./lib/paths";

/**
 * #1094 在 claim 这一侧的两条源级门。
 *
 * 取号本身的行为由 `lib/feature-id.test.ts` 真并发反证（含对照组）。这里守的是
 * **接线**：两个都能让取号静默失效、而且任何单测都看不见的改法。
 * 源级门是本仓既有做法（见 `verify-no-silent-claim.test.ts` 的同款形状）：
 * 要恢复被禁的写法，得先来改这条测试并在 PR 里说明为什么 #1094 错了。
 */
describe("#1094 claim 是唯一的取号点", () => {
  const src = readFileSync(join(REPO_ROOT, ".harness", "scripts", "claim.ts"), "utf8");

  it("claim.ts 调用 allocateFeatureId 取号（而不是自己算 max+1）", () => {
    expect(src).toMatch(/allocateFeatureId\(/);
    // 🔴 自己拼编号就是 #1094 本身：分配点一旦离开写盘那一刻，窗口就回来了
    expect(src).not.toMatch(/`F\$\{/);
  });

  it("🔴 取号之后必须重新读清单再回写——拿取号前的内存副本回写会把刚分配的号抹掉", () => {
    const after = src.slice(src.indexOf("allocateFeatureId("));
    expect(after).toMatch(/loadFeatureList\(phaseId\)/);
    expect(after).not.toMatch(/saveFeatureList\(phaseId,\s*fl\)/);
  });
});
