/**
 * lint-ui-prototyper-single-source 的反证套件。
 *
 * 这道门控最容易的失效形态是**特征句写错**：消费方里永远搜不到那句话 ⇒ 门控恒绿、
 * 什么都没在管。所以判定①（特征句必须都在单源文件里）本身也要有反证。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明
import { checkSingleSource, run, RULE_SIGNATURES, SOURCE_FILE, CONSUMERS } from "./lint-ui-prototyper-single-source.mjs";

const ROOT = join(__dirname, "..", "..");
const SIGS = [{ rule: "①", text: "只有原文才有的判据句" }];
const SOURCE = `见 ${SOURCE_FILE} 的说明：只有原文才有的判据句。`;
const CLEAN = `硬规则见 ${SOURCE_FILE}，本文件不复述。`;

describe("判定②：消费方不许复述规则原文", () => {
  it("消费方抄回原文 ⇒ 红并点名是哪条规则、哪一句", () => {
    const r = checkSingleSource(SOURCE, [["a.yaml", `${CLEAN} 只有原文才有的判据句`]], SIGS);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/a\.yaml 复述了规则 ① 的原文/);
  });
  it("只引用不复述 ⇒ 绿（反向反证）", () => {
    expect(checkSingleSource(SOURCE, [["a.yaml", CLEAN]], SIGS)).toMatchObject({ ok: true, failures: [] });
  });
});

describe("判定③：只删不引等于规则对这一侧读者消失了", () => {
  it("消费方既不复述也不引用 ⇒ 红", () => {
    const r = checkSingleSource(SOURCE, [["a.yaml", "什么都没写"]], SIGS);
    expect(r.failures[0]).toMatch(/没有引用单源文件/);
  });
});

describe("空集防线：门控自己不许平凡为真", () => {
  it("特征句在单源文件里找不到 ⇒ 红（写错特征句 = 门控恒绿）", () => {
    const r = checkSingleSource("单源文件里其实没有那句话", [["a.yaml", CLEAN]], SIGS);
    expect(r.failures[0]).toMatch(/特征句在.*找不到/);
  });
  it("单源文件不存在 ⇒ 红", () => {
    expect(checkSingleSource(null, [["a.yaml", CLEAN]], SIGS).ok).toBe(false);
  });
  it("消费方文件不存在 ⇒ 红", () => {
    expect(checkSingleSource(SOURCE, [["a.yaml", null]], SIGS).ok).toBe(false);
  });
  it("特征句列表为空 ⇒ 红", () => {
    expect(checkSingleSource(SOURCE, [["a.yaml", CLEAN]], []).ok).toBe(false);
  });
});

describe("真仓库", () => {
  it("今天判绿，且覆盖全部八条硬规则", () => {
    expect(run()).toMatchObject({ ok: true });
    expect(new Set(RULE_SIGNATURES.map((s: { rule: string }) => s.rule)).size).toBe(8);
  });
  it("两个消费方都真实存在且都写了「见 X」——否则上一条会因为读不到文件而变成另一种绿", () => {
    for (const c of CONSUMERS) expect(readFileSync(join(ROOT, c), "utf8")).toContain(SOURCE_FILE);
  });
});
