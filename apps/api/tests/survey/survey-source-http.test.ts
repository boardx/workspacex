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

it('exposes authenticated bounded AI proposals and refuses inaccessible transcripts',async()=>{
  expect((await request('/surveys/markdown-proposals','POST',{text:'客户反馈'} , {'content-type':'application/json'})).status).toBe(401);
  expect((await request('/surveys/markdown-proposals','POST',{text:''})).status).toBe(400);
  expect((await request('/surveys/markdown-proposals','POST',{transcriptionId:'not-owned-transcript'})).status).toBe(404);
  expect((await request('/surveys/markdown-proposals','POST',{text:'客户反馈'})).status).toBe(503);
});
it('accepts bounded file envelopes above the default JSON parser limit',async()=>{
 const response=await request('/surveys/markdown-proposals','POST',{file:{name:'source.md',base64:Buffer.from('a'.repeat(81920)).toString('base64')}});
 expect(response.status).toBe(400); // Converted text exceeds the 20K bound, not transport 413.
});
it('does not let another member generate a proposal from an owned transcription',async()=>{
 const created=await request('/recording/realtime-asr/sessions','POST',{name:'本人研究目标',tags:[]});expect(created.status).toBe(201);
 const recording=await created.json();
 expect((await request('/surveys/markdown-proposals','POST',{text:'客户体验',transcriptionId:recording.sessionId},auth(INTRUDER))).status).toBe(404);
 expect((await request('/surveys/markdown-proposals','POST',{text:'客户体验',transcriptionId:recording.sessionId})).status).toBe(503);
});

it('issues an HttpOnly publication cookie and serializes concurrent browser submissions', async () => {
  const created=await request('/surveys','POST',{title:'浏览器限答',questions:[{id:'q1',order:1,chapterId:'general',title:'意见',type:'open',required:true}],template:{id:'r',title:'报告',sections:[]}});
  let model:SurveyRuntime=await created.json();
  const source=model.source!.documents;
  model=await (await request(`/surveys/${model.id}/source`,'PUT',{expectedVersion:model.version,documents:{design:source.design.markdown,reportTemplate:source.reportTemplate.markdown,publication:'# 发布设置\n\n```survey-publication\n{"responseLimitScope":"browser","successMessageMarkdown":"# 感谢参与"}\n```\n'}})).json();
  model=await (await request(`/surveys/${model.id}/publish`,'POST',{expectedVersion:model.version})).json();
  const path=`/public/surveys/${model.publication!.token}`;
  const opened=await request(path); expect(opened.status).toBe(200);
  const cookie=opened.headers.get('set-cookie')!; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
  const browserHeaders={...auth(),cookie:cookie.split(';')[0]!};
  const body={submissionId:'browser-first-submission',answers:[{questionId:'q1',value:'真实意见'}]};
  const attempts=await Promise.all([request(path+'/responses','POST',body,browserHeaders),request(path+'/responses','POST',{...body,submissionId:'browser-second-submission'},browserHeaders)]);
  expect(attempts.map(response=>response.status).sort()).toEqual([201,409]);
  const accepted=attempts.findIndex(response=>response.status===201);
  expect((await request(path+'/responses','POST',{...body,submissionId:accepted===0?'browser-first-submission':'browser-second-submission'},browserHeaders)).status).toBe(201);
  expect(await (await request(path,'GET',undefined,browserHeaders)).json()).toMatchObject({alreadySubmitted:true,successMessageMarkdown:'# 感谢参与'});
  expect((await request(path+'/responses','POST',{...body,submissionId:'missing-proof-submission'})).status).toBe(400);
  const forged={...browserHeaders,cookie:cookie.split('=')[0]+'=forged'};
  expect((await request(path+'/responses','POST',{...body,submissionId:'forged-proof-submission'},forged)).status).toBe(400);
  const other=await request(path); const otherHeaders={...auth(),cookie:other.headers.get('set-cookie')!.split(';')[0]!};
  expect((await request(path+'/responses','POST',{...body,submissionId:'different-browser-submission'},otherHeaders)).status).toBe(201);
});

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
      reportTemplate: previousDocuments.reportTemplate,
    },
  });
  expect(saved.status).toBe(200);
  model = SurveyRuntimeSchema.parse(await saved.json());
  expect(model.title).toBe("HTTP Markdown 已保存");
  expect((await request(`/surveys/${id}/source`, "PUT", { expectedVersion: 1, documents: previousDocuments })).status).toBe(409);
});
