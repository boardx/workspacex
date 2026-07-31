/**
 * F72 · uc-5-1 R7 / domain.md I-19 -- 「转写落库前自动遮盖邮箱/手机号/身份证号/银行卡号/详细
 * 住址」是FIVE separate acceptance lines, not one generalised "sensitive info filter" -- this
 * file asserts each type on its own `it`, so a regression in ONE detector (e.g. the address
 * heuristic starts over- or under-firing) fails ONE test, not a merged assertion that stays
 * green as long as most of the five still work.
 *
 * Also asserts the two invariants a masking kernel can silently violate without any single
 * type's test catching it:
 *   · I-19: the returned TEXT never contains the matched plaintext -- checked as a genuine
 *     absence, not merely "the placeholder appears" (a masker could append the placeholder
 *     and leave the original in place).
 *   · I-22: masking does not eat the sentence -- everything before and after the PII survives
 *     byte-for-byte, so the segment still participates in search/citation.
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";
import { maskPii, PII_MASK_TOKEN, PII_TYPES, type PiiType } from "../../src/domain/recording/pii-mask";

describe("F72 · the five types are read off the contract, not restated", () => {
  it("PII_TYPES is exactly the contract's PiiType.options, in the same order", () => {
    expect(PII_TYPES).toEqual(C.PiiType.options);
    expect(PII_TYPES).toEqual(["email", "phone", "id-card", "bank-card", "address"]);
  });
});

interface Case {
  readonly type: PiiType;
  readonly before: string;
  readonly hit: string;
  readonly after: string;
}

// One isolated example per type, each surrounded by non-adjacent-digit text so the detectors
// cannot claim each other's territory (e.g. the bank-card case is not 17-19 digits, so it
// cannot also be read as an id-card).
const CASES: readonly Case[] = [
  { type: "email", before: "联系方式：", hit: "zhang.wei@example.com", after: "，随时可发。" },
  { type: "phone", before: "手机号是 ", hit: "13812345678", after: "，工作日可接听。" },
  { type: "id-card", before: "身份证号 ", hit: "110105199003078515", after: "，已核验一次。" },
  { type: "bank-card", before: "对公账户 ", hit: "6222021234567890", after: "，走对公转账。" },
  { type: "address", before: "邮寄地址：", hit: "北京市朝阳区建国路88号", after: "，麻烦签收一下。" },
];

describe("F72 · PII 五类遮盖 —— 逐类断言 (I-19)", () => {
  for (const c of CASES) {
    describe(`类型：${c.type}`, () => {
      const raw = `${c.before}${c.hit}${c.after}`;
      const result = maskPii(raw);

      it("命中且只命中这一类", () => {
        expect(result.findings.map((f) => f.type)).toEqual([c.type]);
      });

      it("遮盖后文本不再包含原文明文 (I-19)", () => {
        expect(result.text).not.toContain(c.hit);
      });

      it("占位符出现且句子首尾原样保留 (I-22 前提：遮盖不吃字)", () => {
        expect(result.text).toBe(`${c.before}${PII_MASK_TOKEN}${c.after}`);
      });

      it("finding 的 span 精确指向遮盖后文本里的占位符", () => {
        const finding = result.findings[0]!;
        expect(result.text.slice(finding.span.start, finding.span.end)).toBe(PII_MASK_TOKEN);
      });

      it("finding 里没有任何字段携带明文（只有 findingId/type/span）", () => {
        const finding = result.findings[0]!;
        expect(Object.keys(finding).sort()).toEqual(["findingId", "span", "type"]);
        expect(JSON.stringify(finding)).not.toContain(c.hit);
      });
    });
  }

  it("反证：一段不含任何 PII 的文本，五类全部命中数为 0", () => {
    const raw = "我们先把欧洲三个候选市场的进入门槛过一遍。";
    const result = maskPii(raw);
    expect(result.findings).toEqual([]);
    expect(result.text).toBe(raw);
  });

  it("五类同一段文本内可以同时命中，各自产生独立 finding", () => {
    const raw =
      "邮箱 zhang.wei@example.com，手机 13812345678，身份证 110105199003078515，" +
      "卡号 6222021234567890，地址 北京市朝阳区建国路88号。";
    const result = maskPii(raw);
    expect(result.findings.map((f) => f.type)).toEqual([
      "email", "phone", "id-card", "bank-card", "address",
    ]);
    for (const hit of ["zhang.wei@example.com", "13812345678", "110105199003078515", "6222021234567890", "北京市朝阳区建国路88号"]) {
      expect(result.text).not.toContain(hit);
    }
  });

  it("contract 的 PiiFinding.type 接受这五个字面量，且拒绝一个第六个的假值", () => {
    for (const t of PII_TYPES) expect(C.PiiType.safeParse(t).success).toBe(true);
    expect(C.PiiType.safeParse("passport").success).toBe(false);
  });
});
