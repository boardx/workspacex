import { afterAll, beforeAll, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { addOrgMember, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-survey-source-http";
const OTHER = "org-survey-source-http-other";
const USER = "u-survey-source-http";
const INTRUDER = "u-survey-source-http-intruder";
let app: NestExpressApplication;
let base = "";
const auth = (user = USER, org = ORG) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});
const request = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = auth()) =>
  fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  await migrateOnce();
  await resetOrgs(ORG, OTHER);
  const fixture = await seedOrg({ orgId: ORG, projectId: "survey-source-http-project" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, INTRUDER, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER, projectId: "survey-source-http-other-project" });
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);
afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); });

it("reads and saves Markdown source with tenancy, syntax, and version protection", async () => {
  const draft = {
    title: "HTTP Markdown 私有问卷",
    questions: [{ id: "Q1", order: 1, chapterId: "general", title: "会推荐吗？", type: "single", required: true, options: ["会", "不会"] }],
    template: { id: "report", title: "报告", sections: [] },
  };
  const created = await request("/surveys", "POST", draft);
  expect(created.status).toBe(201);
  let model: SurveyRuntime = SurveyRuntimeSchema.parse(await created.json());
  const id = model.id;

  const source = await request(`/surveys/${id}/source`);
  expect(source.status).toBe(200);
  const previous = await source.json();
  expect(previous.documents.design.markdown).toContain("# HTTP Markdown 私有问卷");
  const previousDocuments = {
    design: previous.documents.design.markdown,
    publication: previous.documents.publication.markdown,
    reportTemplate: previous.documents.reportTemplate.markdown,
  };
  expect((await request(`/surveys/${id}/source`, "GET", undefined, auth(INTRUDER))).status).toBe(404);
  expect((await request(`/surveys/${id}/source`, "GET", undefined, auth(USER, OTHER))).status).toBe(404);

  const invalid = await request(`/surveys/${id}/source`, "PUT", {
    expectedVersion: model.version,
    documents: { ...previousDocuments, design: "# 无效\n\n## Q1 [single]\n没有选项\n" },
  });
  expect(invalid.status).toBe(400);
  expect(await (await request(`/surveys/${id}/source`)).json()).toEqual(previous);

  const saved = await request(`/surveys/${id}/source`, "PUT", {
    expectedVersion: model.version,
    documents: {
      design: "# HTTP Markdown 已保存\n\n## Q1 [single, required]\n会推荐吗？\n- 会\n- 不会\n",
      publication: "# 发布设置\n",
      reportTemplate: "# 报告模板\n",
    },
  });
  expect(saved.status).toBe(200);
  model = SurveyRuntimeSchema.parse(await saved.json());
  expect(model.title).toBe("HTTP Markdown 已保存");
  expect((await request(`/surveys/${id}/source`, "PUT", { expectedVersion: 1, documents: previousDocuments })).status).toBe(409);
});
