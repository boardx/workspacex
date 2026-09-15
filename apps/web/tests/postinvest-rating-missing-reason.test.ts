/**
 * R3-3 的机械表达：缺失原因是**人工确认事实**，Agent 不得自行推断。
 *
 * 这条不变量在实现里只体现为「表单结果被渲染进任务书」——没有断言的话，一次无意的
 * 重构（比如把 `missingReason` 从 `launchRatingThread` 的入参里漏掉）会让任务书悄悄
 * 退回「让模型自己判断是保密期还是失联」，而界面上什么都看不出来。
 */
import { describe, expect, it } from "vitest";
import { postinvestRating } from "@repo/contracts";
import {
  EMPTY_MISSING_REASON,
  MISSING_REASON_CODES,
  MISSING_REASON_LABELS,
  buildMissingReasonBrief,
} from "@/lib/postinvest-rating/missing-reason";
import { buildRatingPrompt } from "@/lib/postinvest-rating/rating-prompt";
import { renderRuleBook } from "@repo/contracts/postinvest-rating-rules";

describe("missing-reason", () => {
  it("覆盖契约里每一个原因码，不多不少（契约是单一事实源）", () => {
    expect([...MISSING_REASON_CODES].sort()).toEqual(
      [...postinvestRating.MissingDataReasonCode.options].sort(),
    );
    for (const code of MISSING_REASON_CODES) {
      expect(MISSING_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it("空表单不产生任何段落——不往任务书里塞空话，也不暗示「用户确认了没有缺失」", () => {
    expect(buildMissingReasonBrief(EMPTY_MISSING_REASON)).toBeNull();
    expect(buildRatingPrompt([])).not.toContain("人工确认事实");
  });

  it("异常原因被原样写进任务书，并声明为事实而不是线索", () => {
    const brief = buildMissingReasonBrief({
      ...EMPTY_MISSING_REASON,
      reasons: ["lost_contact", "bankrupt"],
    });
    expect(brief).toContain("失联");
    expect(brief).toContain("破产");
    expect(brief).toContain("不要再自行推断缺失原因");
  });

  it("勾了「其他」就带上自由文本，而不是只写一个「其他」", () => {
    const brief = buildMissingReasonBrief({
      ...EMPTY_MISSING_REASON,
      reasons: ["other"],
      otherText: "  实控人变更中  ",
    });
    expect(brief).toContain("其他：实控人变更中");
  });

  it("三个勾选各自成句；任务书里第二步明确以这一段为准", () => {
    const prompt = buildRatingPrompt(["2025年报.xlsx"], {
      ...EMPTY_MISSING_REASON,
      standaloneOnly: true,
      operatingReportOnly: true,
      noPriorYear: true,
    });
    expect(prompt).toContain("只有未合并子公司的单体报表");
    expect(prompt).toContain("只有经营报告");
    expect(prompt).toContain("没有上年对比数据");
    expect(prompt).toContain("一律以那一段为准");
    // 不传表单时不得引用一个不存在的段落（否则模型会去找一段空气）
    expect(buildRatingPrompt([])).toContain("我没说就是没确认");
  });
});

/**
 * 任务书里的数值不得是手抄的第二份（ADR-020）——第三步那一段必须逐字来自规则手册。
 * 有人把某个阈值直接写回提示词时，这里变红。
 */
describe("rating-prompt 的评分规则来自规则手册", () => {
  it("第三步整段就是 renderRuleBook() 的输出", () => {
    expect(buildRatingPrompt([])).toContain(renderRuleBook());
  });

  it("可信渠道清单来自契约种子值，不在提示词里另记一份", () => {
    const prompt = buildRatingPrompt([]);
    for (const domain of postinvestRating.TRUSTED_SOURCE_SEED_DOMAINS) {
      expect(prompt).toContain(domain);
    }
  });
});
