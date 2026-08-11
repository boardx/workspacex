/**
 * F162 —— 「取最先触发的那一条」。
 *
 * 判据（`domain/auth/limit-rule-evaluation.ts` 的长注）：`观测值 / 阈值` 最大的那条最先
 * 到达自己的上限，它就是生效的那条；界面据此说「你在 X 规则上到了 96%」，
 * 而不是笼统的「超限」。
 *
 * ## 这个文件里哪一条是反证
 *
 * 「多条命中取比值最大」在**只有一条命中**的用例里永远是绿的——那种用例证明不了任何
 * 选择逻辑。所以核心用例是 `③ 两条同时命中、比值不同`，且断言的是**具体是哪一条**，
 * 不是「有一条」。另外两条同样是会骗人的方向：停用的规则不该参与（否则事件里会记着
 * 一条已停用的规则把人拦下了），并列时必须确定（否则同一次调用在两台机器上被不同规则
 * 拦下，两条日志各自看起来都对）。
 */
import { describe, expect, it } from "vitest";
import { pickFirstTriggered, usedRatio } from "../../src/domain/auth/limit-rule-evaluation";

const rule = (
  ruleId: string, thresholdTokens: number, observedTokens: number, enabled = true,
) => ({ ruleId, thresholdTokens, observedTokens, enabled });

describe("F162 取最先触发的那一条", () => {
  it("一条都没到阈值 ⇒ null（不是「返回第一条」）", () => {
    expect(pickFirstTriggered([rule("a", 1000, 999), rule("b", 2000, 100)])).toBeNull();
  });

  it("恰好到阈值算触发（>= 而不是 >）", () => {
    expect(pickFirstTriggered([rule("a", 1000, 1000)])?.rule.ruleId).toBe("a");
  });

  it("【核心】两条同时命中 ⇒ 取比值大的那条，且答案是具体哪一条", () => {
    const hit = pickFirstTriggered([
      rule("team-month", 10_000_000, 10_400_000),  // 104%
      rule("member-5h", 800_000, 960_000),         // 120% ← 它先到
    ]);

    expect(hit?.rule.ruleId).toBe("member-5h");
    expect(hit?.usedRatio).toBeCloseTo(1.2, 5);
  });

  it("停用的规则不参与：否则事件里会记着一条已停用的规则把人拦下了", () => {
    const hit = pickFirstTriggered([
      rule("disabled-but-way-over", 100, 100_000, false),  // 比值 1000，但停用了
      rule("enabled", 1000, 1200, true),
    ]);

    expect(hit?.rule.ruleId).toBe("enabled");
  });

  it("并列时按 ruleId 升序确定 —— 同一批输入必须给同一个答案", () => {
    const a = pickFirstTriggered([rule("b-rule", 1000, 2000), rule("a-rule", 500, 1000)]);
    const b = pickFirstTriggered([rule("a-rule", 500, 1000), rule("b-rule", 1000, 2000)]);

    expect(a?.rule.ruleId).toBe("a-rule");
    // 输入顺序颠倒，答案不变——这条就是「不看运气」的那个断言。
    expect(b?.rule.ruleId).toBe(a?.rule.ruleId);
  });

  it("阈值为 0 不产生 Infinity 比值（数据库 CHECK 已挡，这里不让它变成一个假的第一名）", () => {
    expect(usedRatio(rule("zero", 0, 500))).toBe(0);
    expect(pickFirstTriggered([rule("zero", 0, 500), rule("real", 100, 150)])?.rule.ruleId)
      .toBe("real");
  });
});
