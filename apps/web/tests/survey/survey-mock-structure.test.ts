import { describe, expect, it } from "vitest";
import {
  SURVEY_LIST, SURVEY_STATUS_LABEL, SURVEY_STATUS_ACTION,
  REPORT_TEMPLATE, SURVEY_QUESTIONS, mappedQuestions, qualityGateBlockers,
  surveyStatusCounts,
  type SurveyStatus,
} from "@/lib/mock/survey";

/**
 * 2026-08-09 保真度审计（问卷模块）留下的机械回归：
 * - 问卷状态必须**恰为四态**（原型列表筛选行「全部 4 / 草稿 1 / 回收中 1 / 已截止 2」，
 *   UC-12.1 R7.2）——此前实现是 `draft/collecting/analyzed/delivered`，四态里两个不对。
 * - 报告模板↔题目双向映射与质量门禁双阻断（UC-12.1 R7.5 / UC-12.2 R7.1）此前完全没有
 *   数据结构承载，本文件钉死它们的最小不变量，防止再次悄悄丢失。
 */
describe("survey mock · 四态机（UC-12.1 R7.2）", () => {
  it("状态枚举恰为四值：draft / pending_send / collecting / closed", () => {
    expect(Object.keys(SURVEY_STATUS_LABEL).sort()).toEqual(
      ["draft", "pending_send", "collecting", "closed"].sort(),
    );
  });

  it("每态都有唯一声明的主动作（R7.2 表：各态动作互斥）", () => {
    const statuses: SurveyStatus[] = ["draft", "pending_send", "collecting", "closed"];
    for (const s of statuses) {
      expect(SURVEY_STATUS_ACTION[s]).toBeTruthy();
    }
    // 四个动作互不相同——不允许两个状态共用同一个「唯一主动作」文案
    const actions = statuses.map((s) => SURVEY_STATUS_ACTION[s]);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("SURVEY_LIST 四态每态至少一条样例（回归：曾经只有 draft/collecting 有样例）", () => {
    const counts = surveyStatusCounts();
    expect(counts.draft).toBeGreaterThan(0);
    expect(counts.pending_send).toBeGreaterThan(0);
    expect(counts.collecting).toBeGreaterThan(0);
    expect(counts.closed).toBeGreaterThan(0);
  });

  it("每条问卷都带匿名/实名属性（UC-12.1 R7.3）", () => {
    for (const s of SURVEY_LIST) {
      expect(["匿名", "实名"]).toContain(s.anonymity);
    }
  });
});

describe("survey mock · 报告模板 ↔ 题目双向映射（UC-12.1 R7.5 本用例核心结构）", () => {
  it("题目侧：已映射的题能读到映射的报告章节", () => {
    const q1 = SURVEY_QUESTIONS.find((q) => q.id === "q-1")!;
    expect(q1.reportSectionId).toBe("sec-blocker");
    expect(mappedQuestions("sec-blocker").map((q) => q.id)).toContain("q-1");
  });

  it("章节侧：无题供料的章节能读出缺口描述（原型实例「按规模分群差异 · 缺分群字段」）", () => {
    const gapSection = REPORT_TEMPLATE.sections.find((s) => s.id === "sec-segment")!;
    expect(gapSection.missingField).toBeTruthy();
    expect(mappedQuestions("sec-segment")).toHaveLength(0);
  });

  it("换绑/改动映射后，两侧同时反映（数据同源，不是两份快照）", () => {
    // 章节侧的 mappedQuestions 直接从题目侧的 reportSectionId 派生，
    // 不允许存在与题目数组脱节的第二份「谁映射了谁」的清单。
    for (const sec of REPORT_TEMPLATE.sections) {
      const viaMapping = mappedQuestions(sec.id);
      const viaScan = SURVEY_QUESTIONS.filter((q) => q.reportSectionId === sec.id);
      expect(viaMapping.map((q) => q.id).sort()).toEqual(viaScan.map((q) => q.id).sort());
    }
  });
});

describe("survey mock · 质量门禁双阻断（UC-12.2 R7.1 头号硬约束）", () => {
  it("两侧都查：孤儿题（题目侧）与缺料章节（章节侧）都会产生阻断项", () => {
    const blockers = qualityGateBlockers();
    const sectionSideBlockers = blockers.filter((b) => b.type === "mapping_incomplete" && b.side === "section");
    const questionSideBlockers = blockers.filter((b) => b.type === "mapping_incomplete" && b.side === "question");
    expect(sectionSideBlockers.length).toBeGreaterThan(0);
    expect(questionSideBlockers.length).toBeGreaterThan(0);
  });

  it("诱导性表述题目会产生阻断一（原型实例「Qn 诱导性表述」措辞）", () => {
    const blockers = qualityGateBlockers();
    const leading = blockers.filter((b) => b.type === "leading_question");
    expect(leading.length).toBeGreaterThan(0);
    expect(leading[0]!.label).toMatch(/诱导性表述/);
  });

  it("门禁未清空——当前 mock 数据必须保持至少一条阻断（否则「报告模板」标签演示不出闸门效果）", () => {
    expect(qualityGateBlockers().length).toBeGreaterThan(0);
  });
});
