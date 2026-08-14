import { describe, expect, it } from "vitest";
import {
  decodeSurveyCreationDraft,
  encodeSurveyCreationDraft,
  normalizeSurveyCreationDraft,
} from "@/lib/survey/creation-draft";

describe("survey creation draft", () => {
  it("规范化名称并去除空白及重复标签", () => {
    expect(normalizeSurveyCreationDraft({
      name: "  新员工体验  ",
      tags: [" HR ", "HR", "文化", ""],
    })).toEqual({ name: "新员工体验", tags: ["HR", "文化"] });
  });

  it("以单个值往返传递完整创建草稿", () => {
    const draft = { name: "团队健康度", tags: ["协作"], sourceModuleId: "strategy" };

    expect(decodeSurveyCreationDraft(encodeSurveyCreationDraft(draft))).toEqual(draft);
  });

  it("拒绝空名称和损坏的序列化值", () => {
    expect(normalizeSurveyCreationDraft({ name: "  ", tags: [] })).toBeNull();
    expect(decodeSurveyCreationDraft("not-json")).toBeNull();
  });
});
