import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * lint-design.sh U10 规则的反证测试（F03；契约束 motion-microinteraction I-1）。
 *
 * 只验「脚本能跑」不验「脚本能抓到裸 duration/ease」等于没有门控——参照
 * tests/lint-design-gate.test.ts 的写法：对故意违规的 fixture 断言 exit 1 且
 * 报出规则号与具体命中文本，对合规 fixture（语义 token 类名）断言 exit 0。
 */
function runLint(target: string): { code: number; out: string } {
  try {
    const out = execFileSync("./scripts/lint-design.sh", [target], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("lint-design.sh U10 门控（裸 duration/easing 拦截）", () => {
  it("对合规 fixture（duration-fast/base/slow + ease-fast/base/slow）放行（exit 0）", () => {
    const r = runLint("__fixtures__/lint-motion-good.tsx");
    expect(r.code, r.out).toBe(0);
  });

  const bad = runLint("__fixtures__/lint-motion-bad.tsx");

  it("对违规 fixture 拦截（exit 1）", () => {
    expect(bad.code, bad.out).toBe(1);
  });

  it("报出规则号 U10", () => {
    expect(bad.out).toMatch(/U10/);
  });

  it("抓到裸 duration-500", () => {
    expect(bad.out).toMatch(/duration-500/);
  });

  it("抓到内建 ease-linear（未走语义 token）", () => {
    expect(bad.out).toMatch(/ease-linear/);
  });
});
