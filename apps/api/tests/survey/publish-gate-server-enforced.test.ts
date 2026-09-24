import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-survey-gate-4037";
const USER = "u-survey-gate-4037";
let app: NestExpressApplication;
let base = "";
const headers = {
  "x-kernel-test-principal": `${USER}:${ORG}`,
  "content-type": "application/json",
};
const request = (path: string, method = "GET", body?: unknown) =>
  fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const blockedDraft = {
  title: "服务端门禁",
  questions: [
    {
      id: "q-optionless",
      order: 1,
      chapterId: "section-1",
      title: "请选择",
      type: "single",
      required: true,
      options: [],
    },
    {
      id: "q-unmapped",
      order: 2,
      chapterId: "section-1",
      title: "请说明",
      type: "open",
      required: false,
      options: [],
    },
    {
      id: "q-leading",
      order: 3,
      chapterId: "section-1",
      title: "你是否同意优秀的工具显然能提升效率？",
      type: "single",
      required: true,
      options: ["同意", "不同意"],
    },
  ],
  template: {
    id: "report",
    title: "报告",
    sections: [
      {
        id: "section-1",
        title: "结果",
        blocks: [
          {
            id: "block-1",
            title: "选择",
            type: "bar",
            questionIds: ["q-optionless", "q-leading"],
            statistic: "distribution",
          },
        ],
      },
      { id: "section-empty", title: "空章节", blocks: [] },
    ],
  },
};

beforeAll(async () => {
  await migrateOnce();
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "survey-gate-project" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

describe("server-enforced survey publish gate", () => {
  it("returns every blocker without changing status, then prepares only the repaired version", async () => {
    const createdResponse = await request("/surveys", "POST", blockedDraft);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();

    const blocked = await request(`/surveys/${created.id}/prepare`, "POST", {
      expectedVersion: 1,
    });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({
      reasonCode: "SURVEY_PUBLISH_BLOCKED",
      blockers: [
        { code: "LEADING_QUESTION", subjectId: "q-leading" },
        { code: "MAPPING_INCOMPLETE", subjectId: "q-unmapped" },
        { code: "MAPPING_INCOMPLETE", subjectId: "section-empty" },
        { code: "QUESTION_OPTIONS_EMPTY", subjectId: "q-optionless" },
      ],
    });
    expect(await (await request(`/surveys/${created.id}`)).json()).toMatchObject({
      status: "draft",
      version: 1,
    });

    const repaired = {
      ...blockedDraft,
      questions: blockedDraft.questions.map((question) =>
        question.id === "q-optionless"
          ? { ...question, options: ["选项一", "选项二"] }
          : question.id === "q-leading"
            ? { ...question, title: "协作工具如何影响效率？" }
            : question,
      ),
      template: {
        ...blockedDraft.template,
        sections: [
          {
            ...blockedDraft.template.sections[0],
            blocks: [
              {
                ...blockedDraft.template.sections[0]!.blocks[0],
                questionIds: ["q-optionless", "q-unmapped", "q-leading"],
              },
            ],
          },
        ],
      },
    };
    const saved = await request(`/surveys/${created.id}`, "PUT", {
      ...repaired,
      expectedVersion: 1,
    });
    expect(saved.status).toBe(200);

    const ready = await request(`/surveys/${created.id}/prepare`, "POST", {
      expectedVersion: 2,
    });
    expect(ready.status).toBe(201);
    expect(await ready.json()).toMatchObject({ status: "ready", version: 3 });

    const staleEdit = await request(`/surveys/${created.id}`, "PUT", {
      ...repaired,
      expectedVersion: 2,
    });
    expect(staleEdit.status).toBe(409);
    expect(await staleEdit.json()).toMatchObject({
      reasonCode: "SURVEY_VERSION_CONFLICT",
    });

    const currentEdit = await request(`/surveys/${created.id}`, "PUT", {
      ...repaired,
      questions: [],
      expectedVersion: 3,
    });
    expect(currentEdit.status).toBe(200);
    expect(await currentEdit.json()).toMatchObject({
      status: "draft",
      version: 4,
    });

    const bypassAttempt = await request(
      `/surveys/${created.id}/start-collection`,
      "POST",
      { expectedVersion: 4 },
    );
    expect(bypassAttempt.status).toBe(409);
    expect(await bypassAttempt.json()).toMatchObject({
      reasonCode: "INVALID_TRANSITION",
    });
    expect(await (await request(`/surveys/${created.id}`)).json()).toMatchObject({
      status: "draft",
      version: 4,
      questions: [],
    });
  });
});
