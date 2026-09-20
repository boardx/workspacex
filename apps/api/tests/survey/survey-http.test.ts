import { afterAll, beforeAll, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { migrateOnce, resetOrgs, seedOrg, addOrgMember } from '../support/db';
import { SurveyRuntimeSchema, type SurveyRuntime } from '@repo/contracts/survey-runtime';
process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const ORG='org-survey-http-3754';const OTHER='org-survey-http-other-3754';const USER='u-survey-http-3754';
let app:NestExpressApplication;let base='';
const auth=(user=USER,org=ORG)=>({'x-kernel-test-principal':`${user}:${org}`,'content-type':'application/json'});
const request=(path:string,method='GET',body?:unknown,headers:Record<string,string>=auth())=>fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeAll(async()=>{await migrateOnce();await resetOrgs(ORG,OTHER);const f=await seedOrg({orgId:ORG,projectId:'survey-http-project'});await addOrgMember(ORG,USER,'consultant',f.teams.energy!);await addOrgMember(ORG,'intruder-survey-http','consultant',f.teams.energy!);await seedOrg({orgId:OTHER,projectId:'survey-http-other-project'});const {createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();},120000);
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER);});
it('wires real HTTP authentication, persistence, public submission, review, report, and a non-spoofable rate limit',async()=>{
  expect((await request('/surveys','GET',undefined,{})).status).toBe(401);
  const draft={title:'HTTP私有问卷',questions:[{id:'q1',order:1,chapterId:'s',title:'评分',type:'scale',required:true,options:['1','2','3','4','5']}],template:{id:'t',title:'HTTP报告',sections:[{id:'s',title:'结果',blocks:[{id:'b',title:'均分',type:'metric',questionIds:['q1']}]}]}};
  const created=await request('/surveys','POST',draft);expect(created.status).toBe(201);let m:SurveyRuntime=SurveyRuntimeSchema.parse(await created.json());const id=m.id;
  expect((await request(`/surveys/${id}`,'GET',undefined,auth('intruder-survey-http'))).status).toBe(404);
  expect((await request(`/surveys/${id}`,'GET',undefined,auth(USER,OTHER))).status).toBe(404);
  const saved=await request(`/surveys/${id}`,'PUT',{...draft,title:'HTTP已保存',expectedVersion:m.version});expect(saved.status).toBe(200);m=SurveyRuntimeSchema.parse(await saved.json());
  expect((await request(`/surveys/${id}`,'PUT',{...draft,expectedVersion:1})).status).toBe(409);
  const published=await request(`/surveys/${id}/publish`,'POST',{expectedVersion:m.version});expect(published.status).toBe(201);m=SurveyRuntimeSchema.parse(await published.json());const token=m.publication!.token;
  const publicView=await request(`/public/surveys/${token}`,'GET',undefined,{});expect(publicView.status).toBe(200);const visible=await publicView.json();expect(visible.title).toBe('HTTP已保存');expect(visible).not.toHaveProperty('template');expect(visible).not.toHaveProperty('responses');expect(visible).not.toHaveProperty('publication');
  expect((await request(`/public/surveys/${token}x`,'GET',undefined,{})).status).toBe(404);
  const submission={submissionId:'http-request-3754',answers:[{questionId:'q1',value:'4'}]};const publicHeaders={'content-type':'application/json'};
  for(const metadata of [{role:''},{companySize:'   '}]) {
    const invalid=await request(`/public/surveys/${token}/responses`,'POST',{...submission,...metadata},publicHeaders);
    expect(invalid.status).toBe(400);
    const stillValid=SurveyRuntimeSchema.parse(await (await request(`/surveys/${id}`)).json());
    expect(stillValid.responses).toHaveLength(0);
  }

  const submitted=await request(`/public/surveys/${token}/responses`,'POST',submission,publicHeaders);expect(submitted.status).toBe(201);const receipt=await submitted.json();
  const replay=await request(`/public/surveys/${token}/responses`,'POST',submission,publicHeaders);expect(replay.status).toBe(201);expect(await replay.json()).toEqual({...receipt,replayed:true});
  const editorVersion=m.version;
  m=SurveyRuntimeSchema.parse(await (await request(`/surveys/${id}`)).json());expect(m.responses).toHaveLength(1);
  expect(m.version).toBe(editorVersion);expect(m.answerRevision).toBe(1);
  expect(m.responses[0]).toMatchObject({role:'未填写',companySize:'未填写'});
  const saveWhileCollecting=await request(`/surveys/${id}`,'PUT',{...draft,expectedVersion:editorVersion});
  expect(saveWhileCollecting.status).toBe(200);m=SurveyRuntimeSchema.parse(await saveWhileCollecting.json());expect(m.responses).toHaveLength(1);
  const report=await request(`/surveys/${id}/report`,'POST',{expectedVersion:m.version});expect(report.status).toBe(201);m=SurveyRuntimeSchema.parse(await report.json());expect(m.report!.sections[0]!.blocks[0]!.rows[0]!.value).toBe(4);
  const reviewed=await request(`/surveys/${id}/responses/${receipt.responseId}`,'PATCH',{expectedVersion:m.version,quality:'review'});expect(reviewed.status).toBe(200);m=SurveyRuntimeSchema.parse(await reviewed.json());expect(m.responses[0]!.quality).toBe('review');
  // Changing caller-controlled forwarding headers cannot reset the direct peer-IP key.
  expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(false);
  for(let n=0;n<16;n++)expect((await request(`/public/surveys/${token}/responses`,'POST',submission,{...publicHeaders,'x-forwarded-for':`198.51.100.${n}`})).status).toBe(201);
  expect((await request(`/public/surveys/${token}/responses`,'POST',submission,{...publicHeaders,'x-forwarded-for':'203.0.113.99'})).status).toBe(429);
  const close=await request(`/surveys/${id}/close`,'POST',{expectedVersion:m.version});expect(close.status).toBe(201);expect((await request(`/public/surveys/${token}`,'GET',undefined,{})).status).toBe(410);
});
