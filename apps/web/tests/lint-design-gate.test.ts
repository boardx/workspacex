import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * 门控自身的测试（UC-0.4 R12 V5 —— 本 feature 最重要的一条验收）
 *
 * 只验「脚本能跑」不验「脚本能抓到违规」等于没有门控。
 * 这里对**故意违规的 fixture** 断言 exit 1 且报出每一类，对合规 fixture 断言 exit 0。
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

describe("lint-design.sh 门控", () => {
  it("对合规 fixture 放行（exit 0）", () => {
    const r = runLint("__fixtures__/lint-good.tsx");
    expect(r.code, r.out).toBe(0);
  });

  const cases: Array<[string, RegExp]> = [
    ["U5a 硬编码颜色", /U5a/],
    ["U5b 任意值像素", /U5b/],
    ["U1.1 disabled:opacity", /U1\.1/],
    ["U1.2 状态用 opacity", /U1\.2/],
    ["U4 hover 无过渡", /U4/],
    ["U7a img 缺 alt", /U7a/],
    ["U7b 裸 outline-none", /U7b/],
    ["§1.2 表外字号档位", /§1\.2/],
    ["D-35 testid 携带业务数据", /D-35/],
  ];

  const bad = runLint("__fixtures__/lint-bad.tsx");

  it("对违规 fixture 拦截（exit 1）", () => {
    expect(bad.code, bad.out).toBe(1);
  });

  it.each(cases)("抓到：%s", (_name, re) => {
    expect(bad.out).toMatch(re);
  });
});
