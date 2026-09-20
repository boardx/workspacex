import { afterAll, beforeAll, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SurveyLibraryTemplateSchema, SurveyTemplateInputSchema, SurveyTemplateSaveInputSchema, SURVEY_TEMPLATE_REQUEST_MAX_BYTES, isSurveyTemplateRequestWithinLimit } from "@repo/contracts/survey-template-library";
import { migrateOnce, resetOrgs, seedOrg, addOrgMember, asOwner } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgSurveyRepository } from "../../src/infrastructure/survey/pg-survey-repository";
import { SurveyTemplateService } from "../../src/application/survey/survey-template-service";
import { toOrgId } from "../../src/domain/org-id";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = toOrgId("org-survey-library-3756");
const OTHER = toOrgId("org-survey-library-other-3756");
let app: NestExpressApplication;
let db: PgDatabase;
let base = "";
const input = { kind: "question" as const, title: "可复用题目", questions: [], template: { id: "t", title: "报告草稿", sections: [] } };
function request(path: string, method = "GET", body?: unknown, user = "owner", org = ORG) {
  return fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-kernel-test-principal": `${user}:${org}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeAll(async () => {
  await migrateOnce(); await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "project-library-3756" });
  await seedOrg({ orgId: OTHER, projectId: "project-library-other-3756" });
  await addOrgMember(ORG, "owner", "consultant", null);
  await addOrgMember(ORG, "other", "consultant", null);
  db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main");
  app = await createApp(); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
}, 120000);
afterAll(async () => { await app?.close(); await db?.close(); await resetOrgs(ORG, OTHER); });
it("serves two distinct template libraries with real owner-isolated CRUD and optimistic versions", async () => {
  expect((await request("/surveys/templates", "GET", undefined, "")).status).toBe(401);
  const created = await request("/surveys/templates", "POST", input);
  expect(created.status).toBe(201);
  let model = SurveyLibraryTemplateSchema.parse(await created.json());
  expect(model.description).toBe("");
  const reportResponse = await request("/surveys/templates", "POST", { ...input, kind: "report", title: "报告模板" });
  expect(reportResponse.status).toBe(201);
  const report = SurveyLibraryTemplateSchema.parse(await reportResponse.json());
  expect((await (await request("/surveys/templates?kind=question")).json()).map((r: { id: string }) => r.id)).toEqual([model.id]);
  expect((await (await request("/surveys/templates?kind=report")).json()).map((r: { id: string }) => r.id)).toEqual([report.id]);
  expect(await (await request("/surveys")).json()).toEqual([]);
  expect(await (await request("/surveys/templates?kind=question", "GET", undefined, "other")).json()).toEqual([]);
  for (const [user, org] of [["other", ORG], ["owner", OTHER]] as const) {
    expect((await request(`/surveys/templates/${model.id}`, "GET", undefined, user, org)).status).toBe(404);
    expect((await request(`/surveys/templates/${model.id}`, "PUT", { ...input, expectedVersion: 1 }, user, org)).status).toBe(404);
    expect((await request(`/surveys/templates/${model.id}?expectedVersion=1`, "DELETE", undefined, user, org)).status).toBe(404);
  }
  expect((await request(`/surveys/templates/${model.id}`, "PUT", { ...input, kind: "report", expectedVersion: 1 })).status).toBe(400);
  const duplicate = { id: "q", order: 1, chapterId: "s", title: "题目", type: "open", required: false, options: [] };
  expect((await request("/surveys/templates", "POST", { ...input, questions: [duplicate, duplicate] })).status).toBe(400);
  expect((await request("/surveys/templates", "POST", { ...input, title: "  " })).status).toBe(400);
  expect((await request("/surveys/templates?kind=unknown")).status).toBe(400);
  const updates = await Promise.all(["一", "二"].map(title => request(`/surveys/templates/${model.id}`, "PUT", { ...input, title, expectedVersion: 1 })));
  expect(updates.map(r => r.status).sort()).toEqual([200, 409]);
  model = SurveyLibraryTemplateSchema.parse(await (await request(`/surveys/templates/${model.id}`)).json());
  expect(model.version).toBe(2);
  const restarted = new SurveyTemplateService(new PgSurveyRepository(db));
  expect(await restarted.get(ORG, "owner", model.id)).toEqual(model);
  expect((await db.withTenant(OTHER, session => session.query("SELECT id FROM survey_library_templates WHERE id=$1", [model.id]))).rows).toEqual([]);
  expect((await request(`/surveys/templates/${model.id}?expectedVersion=1`, "DELETE")).status).toBe(409);
  expect((await request(`/surveys/templates/${model.id}?expectedVersion=2`, "DELETE")).status).toBe(200);
  expect((await request(`/surveys/templates/${model.id}`)).status).toBe(404);
  expect((await request(`/surveys/templates/${report.id}?expectedVersion=1`, "DELETE")).status).toBe(200);
});
it("bounds template data and rejects duplicate report identifiers while allowing incomplete drafts", () => {
  expect(SurveyTemplateInputSchema.safeParse(input).success).toBe(true);
  expect(SurveyTemplateInputSchema.safeParse({ ...input, template: { ...input.template, sections: [{ id: "t", title: "重复", blocks: [] }] } }).success).toBe(false);
  expect(SurveyTemplateInputSchema.safeParse({ ...input, description: "x".repeat(2001) }).success).toBe(false);
  expect(SurveyTemplateInputSchema.safeParse({ ...input, template: { ...input.template, sections: [{ id: "s", title: "大字段", blocks: [{ id: "b", title: "正文", type: "text", text: "x".repeat(500001) }] }] } }).success).toBe(false);
});

it("installs organization freeze restrictions on template writes while preserving reads", async () => {
  const service = new SurveyTemplateService(new PgSurveyRepository(db));
  const draft = SurveyTemplateInputSchema.parse(input);
  const model = await service.create(ORG, "owner", draft);
  await asOwner(client => client.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '30 days' WHERE id=$1", [ORG]));
  try {
    expect((await service.get(ORG, "owner", model.id)).id).toBe(model.id);
    await expect(service.save(ORG, "owner", model.id, 1, { ...draft, title: "forbidden" })).rejects.toThrow();
    await expect(service.create(ORG, "owner", draft)).rejects.toThrow();
    await expect(service.delete(ORG, "owner", model.id, 1)).rejects.toThrow();
    expect((await service.get(ORG, "owner", model.id)).title).toBe(draft.title);
  } finally {
    await asOwner(client => client.query("UPDATE organizations SET status='active',disabled_at=NULL,retention_until=NULL WHERE id=$1", [ORG]));
  }
});

function sizedTemplate(bytes: number) {
  const model = SurveyTemplateInputSchema.parse({ ...input, kind: "report", template: { ...input.template, sections: [{ id: "size-section", title: "内容", blocks: [{ id: "size-block", title: "正文", type: "text", text: "" }] }] } });
  const available = bytes - Buffer.byteLength(JSON.stringify(model));
  model.template.sections[0]!.blocks[0]!.text = "中".repeat(Math.floor(available / 3)) + "x".repeat(available % 3);
  expect(Buffer.byteLength(JSON.stringify(model))).toBe(bytes);
  return model;
}
it("measures the entire UTF-8 request including save revision, not report character length", () => {
  const boundary = sizedTemplate(SURVEY_TEMPLATE_REQUEST_MAX_BYTES - 128);
  expect(SurveyTemplateInputSchema.safeParse(boundary).success).toBe(true);
  expect(SurveyTemplateSaveInputSchema.safeParse({ ...boundary, expectedVersion: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  expect(isSurveyTemplateRequestWithinLimit({ ...boundary, unexpected: "x" }, 128)).toBe(false);
  expect(SurveyTemplateInputSchema.safeParse({ ...boundary, unexpected: "x" }).success).toBe(false);
  const savePayload = { ...sizedTemplate(SURVEY_TEMPLATE_REQUEST_MAX_BYTES), expectedVersion: 1 };
  expect(SurveyTemplateSaveInputSchema.safeParse(savePayload).success).toBe(false);
  const oversize = sizedTemplate(101 * 1024);
  expect(JSON.stringify(oversize).length).toBeLessThan(90 * 1024);
  expect(SurveyTemplateInputSchema.safeParse(oversize).success).toBe(false);
  expect(SurveyTemplateSaveInputSchema.safeParse({ ...oversize, expectedVersion: 1 }).success).toBe(false);
});
it("round-trips near-90KB multibyte templates and copies them to surveys without raising parser limits", async () => {
  const near = sizedTemplate(SURVEY_TEMPLATE_REQUEST_MAX_BYTES - 128);
  const created = await request("/surveys/templates", "POST", near);
  expect(created.status).toBe(201);
  let row = SurveyLibraryTemplateSchema.parse(await created.json());
  const saved = await request(`/surveys/templates/${row.id}`, "PUT", { ...near, expectedVersion: row.version });
  expect(saved.status).toBe(200); row = SurveyLibraryTemplateSchema.parse(await saved.json());
  const copy = { title: row.title, questions: row.questions, template: row.template };
  expect(Buffer.byteLength(JSON.stringify(copy))).toBeLessThan(100 * 1024);
  const questionnaire = await request("/surveys", "POST", copy);
  expect(questionnaire.status).toBe(201);
  const copied = await questionnaire.json();
  expect(copied.template).toEqual(row.template);
  const aboveContract = sizedTemplate(SURVEY_TEMPLATE_REQUEST_MAX_BYTES + 128);
  expect((await request("/surveys/templates", "POST", aboveContract)).status).toBe(400);
  expect((await request(`/surveys/templates/${row.id}`, "PUT", { ...aboveContract, expectedVersion: row.version })).status).toBe(400);
  const aboveParser = sizedTemplate(101 * 1024);
  // The existing global exception filter translates native body-parser errors to
  // 500. This test pins rejection/no mutation, without widening that unrelated parser.
  expect((await request("/surveys/templates", "POST", aboveParser)).ok).toBe(false);
  expect((await request(`/surveys/templates/${row.id}`, "PUT", { ...aboveParser, expectedVersion: row.version })).ok).toBe(false);
  expect(SurveyLibraryTemplateSchema.parse(await (await request(`/surveys/templates/${row.id}`)).json()).version).toBe(row.version);
});
