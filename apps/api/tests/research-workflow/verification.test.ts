/**
 * 第三步验证回填的领域规则。
 *
 * 重点不在"能不能算出几条兑现"——那是加法。重点在两条会**改变下一次研判**的规则：
 * ① 未兑现必须给根因（否则复盘产不出改进）；
 * ② 只有框架性根因才让判断逻辑版本 +1（否则血缘里会出现假的分水岭）。
 */
import { describe, expect, it } from "vitest";
import { researchWorkflow as C } from "@repo/contracts";
import {
  allPredictionsFilled,
  decideFill,
  shouldBumpLogicVersion,
  summarize,
  type PredictionSnapshot,
} from "../../src/domain/research-workflow/verification";

const p = (
  verdict: C.PredictionVerdictName | null,
  rootCause: C.RootCauseName | null = null,
): PredictionSnapshot => ({ verdict, rootCause });

describe("decideFill：未兑现必须给根因", () => {
  it.each(["partial", "missed"] as const)(
    "%s 而不给根因 ⇒ ROOT_CAUSE_REQUIRED（可选的字段在赶时间那天一定是空的）",
    (verdict) => {
      expect(decideFill(verdict, null)).toEqual({ ok: false, refusal: "ROOT_CAUSE_REQUIRED" });
    },
  );

  it.each(["partial", "missed"] as const)("%s 给了根因就放行", (verdict) => {
    expect(decideFill(verdict, "framework")).toEqual({ ok: true });
  });

  it("matched 时根因可空——兑现了没有「根因」可言，硬要求只会得到一堆「无」", () => {
    expect(decideFill("matched", null)).toEqual({ ok: true });
  });

  it("穷举所有 (判定 × 根因) 组合：被拒的恰好是「非兑现且无根因」那两个", () => {
    const refused: string[] = [];
    for (const v of C.PREDICTION_VERDICTS) {
      for (const rc of [null, ...C.ROOT_CAUSES] as const) {
        if (!decideFill(v, rc).ok) refused.push(`${v}/${rc}`);
      }
    }
    expect(refused.sort()).toEqual(["missed/null", "partial/null"]);
  });
});

describe("allPredictionsFilled：留一条没填就不算完", () => {
  it("全部填了 ⇒ true", () => {
    expect(allPredictionsFilled([p("matched"), p("missed", "framework")])).toBe(true);
  });

  it("留一条没填 ⇒ false（人天然把最难填的留到最后，而那条往往最关键）", () => {
    expect(allPredictionsFilled([p("matched"), p(null)])).toBe(false);
  });

  it("一条预测都没有 ⇒ false（空集不算「全部填完」）", () => {
    expect(allPredictionsFilled([])).toBe(false);
  });
});

describe("summarize", () => {
  it("逐档计数，并把框架性单独拎出来", () => {
    expect(
      summarize([
        p("matched"),
        p("partial", "execution"),
        p("missed", "framework"),
        p("missed", "framework"),
      ]),
    ).toEqual({ total: 4, matched: 1, partial: 1, missed: 2, framework: 2, execution: 1 });
  });

  it("空集不炸", () => {
    expect(summarize([])).toEqual({ total: 0, matched: 0, partial: 0, missed: 0, framework: 0, execution: 0 });
  });
});

describe("shouldBumpLogicVersion：只有框架性问题才改判断逻辑", () => {
  it("有框架性根因 ⇒ 逻辑版本 +1（判断逻辑本身要改，影响以后每一次）", () => {
    expect(shouldBumpLogicVersion(summarize([p("missed", "framework")]))).toBe(true);
  });

  it("只有执行性根因 ⇒ 不加（逻辑一个字没变，加一会在血缘里造出假的分水岭）", () => {
    expect(shouldBumpLogicVersion(summarize([p("missed", "execution"), p("partial", "execution")]))).toBe(false);
  });

  it("全部兑现 ⇒ 不加", () => {
    expect(shouldBumpLogicVersion(summarize([p("matched"), p("matched")]))).toBe(false);
  });
});
