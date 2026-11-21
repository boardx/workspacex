import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurveyCollectionGuard, nativeSurveyTemplateDigest, surveyFixture } from '../../apps/web/e2e/support/devapp-aidt-survey.mjs';

const project = 'prj-synthetic', id = 'sv-synthetic', token = 'synthetic.' + 'x'.repeat(43), run = '123';
const fixture = surveyFixture(run);
const survey = value => createSurveyCollectionGuard(value, nativeSurveyTemplateDigest(draft));
const titles = ['会议名称','会议日期','会议目标和议程清晰。','会议内容与我的工作相关。','参会者有足够机会表达意见。','会议时长是否合适？','会后行动项、负责人和时间明确。','下次会议最值得改进的地方是什么？'];
const types = ['short','date','scale','scale','scale','single','scale','open'];
const questions = titles.map((title, i) => ({id: 'meeting-feedback-q' + (i + 1), title, type: types[i], options: i === 5 ? ['过短','合适'] : ['1','2','3','4','5'], provenance: {source:'template',sourceId:'builtin-survey-meeting-feedback'}}));
const draft = { title: fixture.title, tags: [], template: { id:'meeting-feedback-report' }, questions };
const created = {id,title:fixture.title,status:'draft',responses:[],publication:null,version:1};
const link = {kind:'survey',resourceId:id,projectId:project};
const req = (g, path, body, method = 'POST') => g.decide(method, new URL(path,'https://devapp.boardx.us'),body,project);
function published() {
  const g = survey(run); g.arm();
  g.observe(req(g, '/api/surveys', draft).kind, 201, created);
  g.observe(req(g, '/api/projects/' + project + '/resources', link).kind, 201, {});
  g.observe(req(g, '/api/surveys/' + id + '/publish', {expectedVersion:1}).kind,201,{id,version:2,publication:{questions,token,status:'collecting'}});
  return g;
}
const submit = {submissionId:'00000000-0000-4000-8000-000000000001',durationSeconds:12,answers:questions.map((q,i)=>({questionId:q.id,value:fixture.values[i]}))};
test('ordinary UI publication admits exactly one synthetic response and can close its token',()=>{
  const g = published();
  assert.equal(req(g, '/surveys/' + token, undefined, 'GET').allow,true);
  assert.equal(req(g, '/api/public/surveys/unknown/responses', submit),undefined);
  const path = '/api/public/surveys/' + token + '/responses';
  g.observe(req(g,path,submit).kind,201,{responseId:'owned-response',replayed:false});
  assert.deepEqual(g.receipt(),{id,responseId:'owned-response'});
  assert.throws(()=>req(g,path,submit),/NATIVE_SURVEY/);
  g.observe(req(g,'/api/surveys/' + id + '/close',{expectedVersion:2}).kind,200,{id,publication:{status:'closed'}});
  assert.equal(req(g, '/surveys/' + token, undefined, 'GET'),undefined);
});
test('foreign survey, template, publication version, participant content, and unarmed writes fail closed',()=>{
  const g=survey(run);
  assert.equal(req(g,'/api/surveys',draft),undefined);
  g.arm();
  assert.throws(()=>req(g,'/api/surveys',{...draft,title:'someone else'}),/NATIVE_SURVEY/);
  assert.throws(()=>req(g,'/api/surveys',{...draft,template:{...draft.template,extra:'foreign content'}}),/NATIVE_SURVEY/);
  g.observe(req(g,'/api/surveys',draft).kind,201,created);
  assert.throws(()=>req(g,'/api/projects/' + project + '/resources',{...link,resourceId:'foreign'}),/NATIVE_SURVEY/);
  assert.throws(()=>req(g,'/api/surveys/' + id + '/publish',{expectedVersion:1}),/NATIVE_SURVEY/);
  const active=published(), path='/api/public/surveys/' + token + '/responses';
  assert.throws(()=>req(active,path,{...submit,answers:[...submit.answers.slice(0,-1),{questionId:questions[7].id,value:'unrelated data'}]}),/NATIVE_SURVEY/);
  assert.equal(req(active,'/api/surveys/not-owned',undefined,'GET'),undefined);
  assert.equal(req(active,'/api/surveys',undefined,'GET'),undefined);
});
