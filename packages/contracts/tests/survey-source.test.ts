import { describe, expect, it } from "vitest";
import {
  parseSurveyDesignMarkdown,
  serializeSurveyDesignMarkdown,
  sourceContentHash,
} from "../src/survey-source";

describe("survey Markdown source compiler", () => {
  it("parses design Markdown into a title, questions, and source ranges", () => {
    const result = parseSurveyDesignMarkdown(
      "# 客户满意度\n\n## Q1 [single, required]\n您会推荐我们吗？\n- 会\n- 不会\n",
    );

    expect(result).toMatchObject({
      ok: true,
      draft: {
        title: "客户满意度",
        questions: [
          {
            id: "Q1",
            type: "single",
            required: true,
            options: ["会", "不会"],
          },
        ],
      },
    });
    if (!result.ok) throw new Error("expected successful parse");
    expect(result.sourceRanges.Q1).toEqual({ line: 3, column: 1 });
  });

  it("reports a question-line diagnostic instead of compiling a choice without options", () => {
    const result = parseSurveyDesignMarkdown(
      "# 标题\n\n## Q1 [single]\n没有选项\n",
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ line: 3, code: "OPTIONS_REQUIRED" }),
      ],
    });
  });

  it("canonicalizes a structured draft before hashing source documents", () => {
    const markdown = serializeSurveyDesignMarkdown({
      title: "客户满意度",
      questions: [
        {
          id: "Q1",
          order: 1,
          chapterId: "general",
          title: "您会推荐我们吗？",
          type: "single",
          required: true,
          options: ["会", "不会"],
        },
      ],
      template: { id: "rt-1", title: "报告", sections: [] },
    });
    const first = sourceContentHash([
      { kind: "design", markdown, revision: 1, updatedAt: "2026-09-26T00:00:00.000Z" },
      { kind: "publication", markdown: "# 发布设置\n", revision: 1, updatedAt: "2026-09-26T00:00:00.000Z" },
    ]);
    const second = sourceContentHash([
      { kind: "publication", markdown: "# 发布设置\n", revision: 9, updatedAt: "2026-09-26T01:00:00.000Z" },
      { kind: "design", markdown, revision: 3, updatedAt: "2026-09-26T01:00:00.000Z" },
    ]);

    expect(parseSurveyDesignMarkdown(markdown)).toMatchObject({ ok: true });
    expect(first).toBe(second);
  });

  it("rejects unsupported types, duplicate identifiers, and unknown visibility references", () => {
    const result = parseSurveyDesignMarkdown(
      "# 标题\n\n## Q1 [unknown]\n题干\n\n## Q2 [single]\n选择\n- 是\n- 否\n> visibleWhen: Q9 equals 是\n\n## Q2 [open]\n重复编号\n",
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "QUESTION_TYPE_UNSUPPORTED", line: 3 }),
        expect.objectContaining({ code: "QUESTION_ID_DUPLICATE", line: 12 }),
        expect.objectContaining({ code: "QUESTION_SYNTAX", line: 10 }),
      ]),
    });
  });
});
