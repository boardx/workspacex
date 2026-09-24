import { describe, expect, it, vi } from "vitest";
import {
  createSurveyQuestion,
  surveyChoices,
  SURVEY_QUESTION_TYPES,
} from "@repo/contracts/survey-question-types";
import type { SurveyAnswerValue } from "@repo/contracts/survey-question-types";
import type { SurveyDraftInput } from "@repo/contracts/survey-runtime";
import {
  SurveyService,
  SurveyError,
  type SurveyRepository,
  type SurveyRecord,
  type SurveyTransaction,
} from "../../src/application/survey/survey-service";
import { toOrgId } from "../../src/domain/org-id";
const org = toOrgId("survey-types-test");
function setup(claim = vi.fn(async () => {})) {
  const rows = new Map<string, SurveyRecord>();
  const repo: SurveyRepository = {
    async list() {
      return [];
    },
    async create(_org, row) {
      rows.set(row.model.id, structuredClone(row));
    },
    async delete() {},
    async transact(_org, id, fn) {
      const saved = rows.get(id);
      if (!saved) throw new SurveyError("not_found");
      const row = structuredClone(saved);
      const value = await fn(row, {
        claimAttachments: claim,
      } as SurveyTransaction);
      rows.set(id, row);
      return structuredClone(value);
    },
  };
  return { service: new SurveyService(repo), rows, claim };
}
function sample(q: ReturnType<typeof createSurveyQuestion>): SurveyAnswerValue {
  const choices = surveyChoices(q).map((c) => c.id);
  const c = q.config ?? {};
  switch (q.type) {
    case "multi":
    case "image_multi":
      return choices.slice(0, 1);
    case "ranking":
      return choices;
    case "single":
    case "dropdown":
    case "image_single":
    case "scale":
      return choices[0]!;
    case "number":
      return String(c.min ?? 0);
    case "rating":
      return "4";
    case "nps":
      return "9";
    case "slider":
      return String(c.min ?? 0);
    case "date":
      return "2026-09-21";
    case "time":
      return "09:30";
    case "datetime":
      return "2026-09-21T09:30";
    case "email":
      return "person@example.test";
    case "phone":
      return "13800138000";
    case "cascade":
      return c.cascadePaths?.[0] ?? [];
    case "multiple_text":
    case "address":
      return Object.fromEntries(
        (c.fields ?? []).map((f) => [f.id, "有效内容"]),
      );
    case "matrix_single":
    case "matrix_dropdown":
    case "matrix_scale":
      return Object.fromEntries((c.rows ?? []).map((r) => [r.id, choices[0]!]));
    case "matrix_multi":
      return Object.fromEntries(
        (c.rows ?? []).map((r) => [r.id, choices.slice(0, 1)]),
      );
    case "matrix_input":
      return Object.fromEntries((c.rows ?? []).map((r) => [r.id, "有效内容"]));
    case "allocation":
      return Object.fromEntries(
        choices.map((id, i) => [id, String(i === 0 ? (c.total ?? 100) : 0)]),
      );
    case "file":
    case "signature":
      return ["attachment-1"];
    default:
      return "有效回答";
  }
}
const reportTemplate = (...questionIds: string[]) => ({
  id: "t",
  title: "报告",
  sections: [
    {
      id: "results",
      title: "结果",
      blocks: [
        {
          id: "answers",
          title: "回答",
          type: "text" as const,
          questionIds,
          statistic: "responses" as const,
          samplePolicy: "valid" as const,
          minGroupSize: 5,
        },
      ],
    },
  ],
});
describe("real survey question type lifecycle", () => {
  for (const entry of SURVEY_QUESTION_TYPES.filter(
    (e) => !["description", "page_break"].includes(e.type),
  )) {
    it(`${entry.type} persists structured answers through publication and idempotent submission`, async () => {
      const { service: s, claim } = setup();
      const q = createSurveyQuestion(entry.type, "q1", 1);
      if (q.type === "image_single" || q.type === "image_multi")
        q.config = {
          ...q.config,
          images: Object.fromEntries(
            surveyChoices(q).map((c) => [
              c.id,
              { url: "https://example.test/image.png", alt: c.label },
            ]),
          ),
        };
      let model = await s.create(org, "owner", {
        title: "完整题型",
        questions: [q],
        template: reportTemplate(q.id),
      } as SurveyDraftInput);
      model = await s.publish(org, "owner", model.id, model.version);
      const token = model.publication!.token;
      await expect(
        s.submit(token, {
          submissionId: "empty-0001",
          answers: [],
          durationSeconds: 1,
          role: "未填写",
          companySize: "未填写",
        }),
      ).rejects.toThrow("invalid_answers");
      const value = sample(q);
      const input = {
        submissionId: "valid-0001",
        uploadSessionToken: "upload-secret",
        answers: [{ questionId: q.id, value }],
        durationSeconds: 1,
        role: "未填写",
        companySize: "未填写",
      };
      const receipt = await s.submit(token, input);
      expect((await s.submit(token, input)).replayed).toBe(true);
      const saved = await s.get(org, "owner", model.id);
      expect(saved.responses).toHaveLength(1);
      expect(saved.responses[0]!.answers[0]!.value).toEqual(value);
      if (q.type === "file" || q.type === "signature")
        expect(claim).toHaveBeenCalledWith(
          expect.objectContaining({
            responseId: receipt.responseId,
            references: [{ questionId: "q1", attachmentIds: ["attachment-1"] }],
          }),
        );
    });
  }
  it("rolls back answer and receipt when attachment ownership claim fails", async () => {
    const { service: s } = setup(
      vi.fn(async () => {
        throw new SurveyError("invalid_answers");
      }),
    );
    const q = createSurveyQuestion("file", "file", 1);
    let m = await s.create(org, "owner", {
      title: "附件",
      questions: [q],
      template: reportTemplate(q.id),
    });
    m = await s.publish(org, "owner", m.id, m.version);
    await expect(
      s.submit(m.publication!.token, {
        submissionId: "file-request",
        answers: [{ questionId: q.id, value: ["foreign-file"] }],
        durationSeconds: 1,
        role: "未填写",
        companySize: "未填写",
      }),
    ).rejects.toThrow("invalid_answers");
    expect((await s.get(org, "owner", m.id)).responses).toHaveLength(0);
  });
  it("rejects stale hidden answers but accepts unanswered hidden required questions", async () => {
    const { service: s } = setup();
    const q = createSurveyQuestion("single", "parent", 1);
    const child = createSurveyQuestion("short", "child", 2);
    const choices = surveyChoices(q);
    child.config = {
      ...child.config,
      visibleWhen: [
        { questionId: q.id, operator: "equals", value: choices[0]!.id },
      ],
    };
    let m = await s.create(org, "owner", {
      title: "条件",
      questions: [q, child],
      template: reportTemplate(q.id, child.id),
    });
    m = await s.publish(org, "owner", m.id, m.version);
    const input = {
      submissionId: "hidden-test",
      answers: [{ questionId: q.id, value: choices[1]!.id }],
      durationSeconds: 1,
      role: "未填写",
      companySize: "未填写",
    };
    await expect(
      s.submit(m.publication!.token, {
        ...input,
        answers: [...input.answers, { questionId: child.id, value: "旧答案" }],
      }),
    ).rejects.toThrow("invalid_answers");
    await expect(s.submit(m.publication!.token, input)).resolves.toMatchObject({
      replayed: false,
    });
  });
});
