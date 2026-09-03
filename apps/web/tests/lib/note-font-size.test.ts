/**
 * `noteFontSizePx` 的文字长度自适应——2026-09-01 人类反馈根因钉子之一：
 * 「便利贴太大装不下」有两层病灶——贴纸*本身*装不装得进区块（已改回随区块宽度/
 * 列数缩放，见 `explicit-template-layout.ts` 的 `MAX_NOTE_MM` 文档），以及贴纸
 * *内部*文字装不装得下这张（不管缩放前后的）贴纸——后者此前完全没人管：编辑器
 * 右栏「超出时」三选一（`layout.overflow`）只用来拼一句警告文案，字号算法从不看
 * 它、也从不看文字长度，长文字只能硬溢出被外层 `overflow-hidden` 悄悄裁掉。
 *
 * 本测试钉住修复后的行为：选「缩小字号」时，字号随文字长度继续收缩；短文字、
 * 或不传 `textLength` 参数时，行为与改动前逐字一致。这里传入的 `STANDARD_NOTE_MM`
 * 只是一个具体的 `noteMm` 取值用来跑函数，不代表贴纸尺寸本身固定——真实调用方
 * 传入的 `noteMm` 现在会随区块/列数变化，见上文。
 */
import { describe, expect, it } from "vitest";
import { noteFontSizePx } from "@/components/canvas/template-editor-model";
import { STANDARD_NOTE_MM } from "@/lib/canvas/explicit-template-layout";

describe("noteFontSizePx —— 不传 textLength 时与改动前逐字一致", () => {
  it("非列表型（短文本/长文本）恒为 9px，不受文字长度影响", () => {
    expect(noteFontSizePx(STANDARD_NOTE_MM, false)).toBe(9);
    expect(noteFontSizePx(STANDARD_NOTE_MM, false, 999)).toBe(9);
  });

  it("列表型、不传 textLength：clamp(noteMm × 0.115, 6.5, 10.5) 逐字复现", () => {
    expect(noteFontSizePx(STANDARD_NOTE_MM, true)).toBeCloseTo(
      Math.max(6.5, Math.min(10.5, STANDARD_NOTE_MM * 0.115)),
      1,
    );
  });
});

describe("noteFontSizePx —— 文字长度自适应（「缩小字号」选项）", () => {
  it("文字长度在舒适字数以内：与不传 textLength 时相同，不提前收缩", () => {
    const base = noteFontSizePx(STANDARD_NOTE_MM, true);
    expect(noteFontSizePx(STANDARD_NOTE_MM, true, 10)).toBe(base);
    expect(noteFontSizePx(STANDARD_NOTE_MM, true, 16)).toBe(base);
  });

  it("文字越长，字号越小——单调不增，不是拍脑袋的固定值", () => {
    const short = noteFontSizePx(STANDARD_NOTE_MM, true, 20);
    const long = noteFontSizePx(STANDARD_NOTE_MM, true, 60);
    const longer = noteFontSizePx(STANDARD_NOTE_MM, true, 200);
    expect(long).toBeLessThan(short);
    expect(longer).toBeLessThanOrEqual(long);
  });

  it("字号有下限 5.5px——不会缩到不可读，极端长文字交给「截断」/「叠放」兜底", () => {
    const extreme = noteFontSizePx(STANDARD_NOTE_MM, true, 5000);
    expect(extreme).toBeGreaterThanOrEqual(5.5);
  });

  it("字号不会因为 textLength 反而超过基准值（shrink 因子恒 ≤ 1）", () => {
    const base = noteFontSizePx(STANDARD_NOTE_MM, true);
    expect(noteFontSizePx(STANDARD_NOTE_MM, true, 1)).toBeLessThanOrEqual(base);
    expect(noteFontSizePx(STANDARD_NOTE_MM, true, 200)).toBeLessThanOrEqual(base);
  });
});
