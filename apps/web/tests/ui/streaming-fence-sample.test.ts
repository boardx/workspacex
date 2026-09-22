import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAMPLE_INTERVAL_MS, fenceRenderSignature, nextSample, shouldResample,
} from "@/lib/canvas/streaming-fence-sample";

const HEAD = "模板: bmc\n";
const withSections = (n: number, bulletsEach = 2) =>
  HEAD + Array.from({ length: n }, (_, i) =>
    `## 分区${i}\n` + Array.from({ length: bulletsEach }, (_, j) => `- 便签${i}-${j}`).join("\n"),
  ).join("\n");

describe("内容签名只反映「画布上会多出东西」", () => {
  it("同一条便签被补完，签名不变", () => {
    expect(fenceRenderSignature("## A\n- 客户细分是")).toBe(fenceRenderSignature("## A\n- 客户细分是中小制造企业"));
  });
  it("多一条便签、多一个分区、多一个表头字段，签名都变", () => {
    const base = "## A\n- x";
    expect(fenceRenderSignature(base + "\n- y")).not.toBe(fenceRenderSignature(base));
    expect(fenceRenderSignature(base + "\n## B")).not.toBe(fenceRenderSignature(base));
    expect(fenceRenderSignature("模板: bmc\n" + base)).not.toBe(fenceRenderSignature(base));
  });
});

describe("取样规则", () => {
  it("第一帧尽快给", () => {
    expect(shouldResample(null, withSections(1), false, 1000)).toBe(true);
  });

  it("闭合时立即跟上，不等间隔", () => {
    const prev = nextSample(withSections(2), 1000);
    expect(shouldResample(prev, withSections(9), true, 1001)).toBe(true);
  });

  it("闭合且内容一字未变时不做无谓重画", () => {
    const code = withSections(2);
    expect(shouldResample(nextSample(code, 1000), code, true, 5000)).toBe(false);
  });

  it("签名没变就不重画——哪怕过了很久（模型在补某条便签的后半句）", () => {
    const prev = nextSample("## A\n- 客户细分是", 1000);
    expect(shouldResample(prev, "## A\n- 客户细分是中小制造企业", false, 1000 + 10 * DEFAULT_SAMPLE_INTERVAL_MS)).toBe(false);
  });

  it("签名变了但间隔没到，先不重画", () => {
    const prev = nextSample(withSections(1), 1000);
    expect(shouldResample(prev, withSections(2), false, 1000 + DEFAULT_SAMPLE_INTERVAL_MS - 1)).toBe(false);
  });

  it("签名变了且间隔到了，重画", () => {
    const prev = nextSample(withSections(1), 1000);
    expect(shouldResample(prev, withSections(2), false, 1000 + DEFAULT_SAMPLE_INTERVAL_MS)).toBe(true);
  });

  it("整条流：30 tok/s 写 35 秒的画布，重建次数是个位数而不是上千次", () => {
    // 逐 token 追加，模拟真实流式；统计会触发几次重建。
    const target = withSections(9, 4);
    let prev: ReturnType<typeof nextSample> | null = null;
    let rebuilds = 0;
    let now = 0;
    for (let i = 1; i <= target.length; i += 1) {
      now += 33;                                   // ≈30 tok/s，一个字符一帧是更严苛的上界
      const chunk = target.slice(0, i);
      if (shouldResample(prev, chunk, false, now)) { prev = nextSample(chunk, now); rebuilds += 1; }
    }
    if (shouldResample(prev, target, true, now + 1)) rebuilds += 1;
    expect(rebuilds).toBeGreaterThan(3);           // 得真的边长边画，不能只画一次
    expect(rebuilds).toBeLessThan(60);             // 也不能一秒三十次
  });
});
