import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * F08 反证测试 —— U7a 规则曾经只覆盖裸 `<img>`，未覆盖 `next/image` 的 `<Image>`
 * 组件（`phases/phase-12-uiux-foundation/requirements/05-image-icon-accessibility.md#R3`
 * 第 4 步）。本测试专门断言这个漏检口已经补上：
 * - 缺 alt 的 `<Image>` 必须被 U7a 抓到（exit 1，命中 [U7a]）。
 * - 带 alt 的 `<Image>` 必须放行（exit 0）。
 * 只验「脚本能跑」不验「脚本能抓到这一类违规」等于没有门控（同 lint-design-gate.test.ts
 * 的立场）。
 */
function runLint(target?: string): { code: number; out: string } {
  const args = target ? [target] : [];
  try {
    const out = execFileSync("./scripts/lint-design.sh", args, { encoding: "utf8" });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("U7a 覆盖 next/image 的 <Image>（F08）", () => {
  it("缺 alt 的 <Image> 被 U7a 拦截", () => {
    const r = runLint("__fixtures__/lint-bad.tsx");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/U7a/);
    expect(r.out).toMatch(/y\.png/);
  });

  it("带 alt 的 <Image> 与合规 <img> 一起放行（exit 0）", () => {
    const r = runLint("__fixtures__/lint-good.tsx");
    expect(r.code, r.out).toBe(0);
  });

  it("全仓真实扫描（app/components/lib）U7a 全绿——已补齐 avatar/附件预览/组织头像的 alt 或 aria-hidden", () => {
    const r = runLint();
    expect(r.out).not.toMatch(/\[U7a\]/);
  });
});
