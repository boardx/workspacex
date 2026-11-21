import { describe, expect, it } from "vitest";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { projectInterviewSkillDraft } from "../../src/application/aidt-stages/interview-skill-draft";

type Draft = SharedStageValue["content"]["draft"];
const id = "15c7b5e2-9d0e-4b10-bc47-000000000001", second = "15c7b5e2-9d0e-4b10-bc47-000000000002";
const key = "interviewRecord:" + id;
const row = { version: 1, id, code: "U01", original: "", adopted: "", guideConfirmed: false, topic: "茶饮", goal: "", tags: ["学生"], consent: null };
const base: Draft = { fields: { [key]: JSON.stringify(row), ["interviewRecord:" + second]: JSON.stringify({ ...row, id: second, code: "U02" }) }, selectedIdeaId: "", ideas: [] };
const guideTurn = { messageId: "m01", user: "平时怎样选择饮品？", assistant: "### 访谈问题清单（草稿）\n研究重点：了解选择过程\n- 最近一次看菜单是什么时候？\n- 当时先看了什么？" };

describe("S2 durable Skill output", () => {
  it("projects only the current interview and records the exact student original with an unconfirmed draft", () => {
    const after = projectInterviewSkillDraft(base, id, guideTurn)!;
    expect(JSON.parse(after.fields[key]!)).toMatchObject({ original: guideTurn.user, goal: "了解选择过程", tags: ["学生"], guideConfirmed: false, adopted: "最近一次看菜单是什么时候？\n当时先看了什么？" });
    expect(after.fields["interviewRecord:" + second]).toEqual(base.fields["interviewRecord:" + second]);
    expect(projectInterviewSkillDraft(after, id, guideTurn)).toBeNull();
  });
  it("does not capture greetings as original interview questions", () => {
    expect(projectInterviewSkillDraft(base, id, { ...guideTurn, user: "你好！", assistant: "你好，先说说想了解什么。" })).toBeNull();
  });
  it("preserves a human-confirmed guide and an archived entity", () => {
    const completed = { ...base, fields: { ...base.fields, [key]: JSON.stringify({ ...row, original: "原题", adopted: "学生最终稿", guideConfirmed: true }) } };
    expect(projectInterviewSkillDraft(completed, id, guideTurn)).toBeNull();
    expect(projectInterviewSkillDraft({ ...base, fields: { ...base.fields, ["interviewArchived:" + id]: "true" } }, id, guideTurn)).toBeNull();
  });
  it("only projects student-attributable findings after consent; an unverified quote never enters output", () => {
    const fields = { ...base.fields, [key]: JSON.stringify({ ...row, original: "原题", consent: { notes: true } }) };
    const turn = { messageId: "m02", user: "我观察到他停在菜单前比较字样。", assistant: "### 人物发现卡（草稿）\n一句发现：停在菜单前比较字样\n具体情况：排队超过二十分钟\n受访者原话：我不喜欢奶茶" };
    const after = projectInterviewSkillDraft({ ...base, fields }, id, turn)!;
    expect(after.discoveryCards).toMatchObject([{ id, headlineKind: "student-summary", headline: "停在菜单前比较字样", context: "", quote: "" }]);
    expect(after.fields["interviewConfirmed:" + id]).not.toBe("true");
    expect(projectInterviewSkillDraft({ ...base, fields: { ...fields, ["interviewConfirmed:" + id]: "true" } }, id, turn)).toBeNull();
    expect(projectInterviewSkillDraft({ ...base, fields: { ...fields, [key]: JSON.stringify({ ...row, original: "原题" }) } }, id, turn)).toBeNull();
  });
});
