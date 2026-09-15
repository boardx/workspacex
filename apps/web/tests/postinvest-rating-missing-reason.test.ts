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
import { RATING_CORRECTION_TAG, RATING_MEMO_TAG, buildMemoryProtocol } from "@/lib/postinvest-rating/rating-memo";
import { MATERIAL_KIND_LABELS, formatFileSize, guessMaterialKind } from "@/lib/postinvest-rating/material-file";

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

/**
 * R3-9 的机械表达：趋势对比要成立，写入与检索必须用同一个记忆格式，且任务书不能再
 * 把模型指回 `wx_knowledge_search`——agent 产出的文件 `source='agent_run_output'`，
 * 而索引写入只收 `source='upload'`，那条路永远搜不到（见 rating-memo.ts 头注）。
 */
describe("记忆协议", () => {
  it("任务书包含记忆协议，且搜索与写入用同一个前缀", () => {
    const prompt = buildRatingPrompt([]);
    expect(prompt).toContain(buildMemoryProtocol());
    // 前缀在协议里至少出现两次：一次用于搜，一次用于写。格式各写一遍就会对不上。
    const occurrences = buildMemoryProtocol().split(RATING_MEMO_TAG).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(prompt).toContain(RATING_CORRECTION_TAG);
  });

  it("第四步不再让模型用 wx_knowledge_search 找自己以前的产出", () => {
    const prompt = buildRatingPrompt([]);
    expect(prompt).toContain("不要用 wx_knowledge_search 找你自己以前");
    expect(prompt).toContain("wx_memory_search");
    expect(prompt).toContain("wx_memory_write");
  });

  it("主观偏差不进记忆——不把印象变成下次的规则", () => {
    expect(buildMemoryProtocol()).toContain("主观偏差那一类不写");
  });
});

/**
 * R3-2 的回显：类型是**按文件名推测**的，界面必须说明；SHA-256 是真算的，算不出就不显示，
 * 不给占位符（原型截图里的 `aaaaaaaaa…` 是 mock，真页面不许长成那样）。
 */
describe("上传材料回显", () => {
  it("按扩展名推测类型；审计报告只认名字里带审计/audit 的", () => {
    expect(guessMaterialKind("2025年度合并财务报表.xlsx")).toBe("statement");
    expect(guessMaterialKind("2025年度审计报告.pdf")).toBe("audit_report");
    expect(guessMaterialKind("FY25 Audit Report.pdf")).toBe("audit_report");
    expect(guessMaterialKind("2024年度合并财务报表.pdf")).toBe("statement");
    expect(guessMaterialKind("管理层访谈-2026Q1.m4a")).toBe("recording");
    expect(guessMaterialKind("随手记.txt")).toBe("unknown");
  });

  it("每个类型都有展示名", () => {
    for (const kind of ["statement", "audit_report", "recording", "unknown"] as const) {
      expect(MATERIAL_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("文件大小按量级换单位", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(376 * 1024)).toBe("376 KB");
    expect(formatFileSize(Math.round(1.1 * 1024 * 1024))).toBe("1.1 MB");
  });
});

/** R3-1：项目名同时是记忆检索的键，必须进任务书，否则历史对不上。 */
describe("项目绑定", () => {
  it("传了项目名就写进任务书，并说明记忆协议用它", () => {
    const prompt = buildRatingPrompt([], undefined, "海创汇某被投企业");
    expect(prompt).toContain("海创汇某被投企业");
    expect(prompt).toContain("记忆协议里的项目名就用它");
  });

  it("不传项目名时不编一个", () => {
    expect(buildRatingPrompt([])).not.toContain("记忆协议里的项目名就用它");
  });
});
