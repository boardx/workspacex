#!/usr/bin/env node
// QA-only recovery for an already generated V2. No Design chat/variants/model request code.
import { readFileSync, writeFileSync, mkdirSync, rmdirSync, renameSync } from 'node:fs';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { assert, assertFrozen, sha256 } from './lib/aidt-design-supplement-ledger.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const Stage=await import(pathToFileURL(join(repo,'packages/contracts/src/aidt-stages.ts')).href);
const Reflection=await import(pathToFileURL(join(repo,'packages/contracts/src/aidt-return-reflection.ts')).href);
if(process.argv.includes('--self-check')){assert(Stage.operations.get.method==='GET'&&Stage.operations.save.method==='PUT'&&Stage.operations.history.method==='GET'&&typeof Reflection.isAidtReflectionConfirmed==='function','STAGE_CONTRACTS_REQUIRED');console.log(JSON.stringify({offline:true,modelRequests:0,contractsReady:true}));process.exit(0);}
const external=name=>{const value=process.env[name];assert(value&&isAbsolute(value)&&!resolve(value).startsWith(repo+'/'),`EXTERNAL_ABSOLUTE_${name}_REQUIRED`);return resolve(value);};
const fixtureFile=external('AIDT_DESIGN_RUNTIME_FIXTURE'),stateFile=external('AIDT_DESIGN_STATE');
const out=process.argv[2];assert(out&&resolve(out).startsWith('/tmp/'),'PRIVATE_TMP_OUTPUT_REQUIRED');mkdirSync(out,{recursive:true,mode:0o700});
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),state=JSON.parse(readFileSync(stateFile,'utf8'));
assert(state.schemaVersion===1&&state.v1&&state.v2&&state.v1Bound&&state.return2&&state.return5&&state.currentS5,'EXISTING_V2_AND_EXACT_PRIOR_ROUNDS_REQUIRED');
assert(state.baseURL===fixture.baseURL&&state.apiOrigin===fixture.apiOrigin,'STATE_RUNTIME_MISMATCH');
const lock=stateFile+'.phase-lock';mkdirSync(lock,{mode:0o700});
const record={schemaVersion:1,startedAt:new Date().toISOString(),completed:false,modelPostAttempts:0,observedModelPostCount:0,synthetic:true,realUserTestConducted:false};let browser;
try{
  const {chromium,expect}=createRequire(join(repo,'apps/web/package.json'))('@playwright/test');
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH??'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
  page.on('request',request=>{if(request.method()==='POST'&&/\/pm-designs\/[^/]+\/(chat|variants)$/.test(new URL(request.url()).pathname))record.observedModelPostCount++;});
  await page.goto(fixture.baseURL+'/login');await page.getByTestId('login-email').fill(fixture.fundedAdminEmail);await page.getByTestId('login-password').fill(fixture.fundedAdminPassword);await page.getByTestId('login-submit').click();await page.waitForURL('**/home');
  const actor=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wsx.session')??'null');return s?{userId:s.userId,orgId:s.currentOrgId}:null;});assert(actor?.userId===state.actor.userId&&actor.orgId===state.actor.orgId,'ACTOR_MISMATCH');
  async function api(path){const result=await page.evaluate(async path=>{const token=localStorage.getItem('wsx.sessionToken');const r=await fetch('/__fullstack_api'+path,{headers:{authorization:`Bearer ${token}`}});return {status:r.status,data:await r.json()};},path);assert(result.status===200,'READ_FAILED');return result.data;}
  for(const version of[state.v1,state.v2]){const actual=(await api(`/pm-designs/${state.designId}/versions/${version.id}`)).version;assert(actual.id===version.id&&actual.source==='model'&&sha256(JSON.stringify(actual.prototype))===version.prototypeSha256,'ACTUAL_VERSION_MISMATCH');}
  const base=`/projects/${state.projectId}/aidt/stages/6`,read=async()=>Stage.operations.get.out.parse(await api(base)).stage;
  const before=await read();assertFrozen(before.content.draft.fields.questionSnapshot,state.v1Bound.snapshotRaw);
  // Authoritative history must match before copying any saved source text into a new write.
  const oldReturn=Stage.operations.history.out.parse(await api(base+`/revisions?beforeRevision=${state.return2.revision+1}&limit=1`)).items[0];assert(JSON.stringify(oldReturn)===JSON.stringify(state.return2),'PREVIOUS_RETURN2_CHANGED');
  assert(Reflection.isAidtReflectionConfirmed(oldReturn.content.draft)&&Reflection.readAidtReturnDecision(oldReturn.content.draft).step==='2','CONFIRMED_RETURN2_REQUIRED');assertFrozen(oldReturn.content.draft.fields.questionSnapshot,state.v1Bound.snapshotRaw);
  if(!state.v2Bound){
    // The state pins the last saved return5; never overwrite an intervening student revision.
    assert(JSON.stringify(before)===JSON.stringify(state.return5),'S6_CHANGED_SINCE_RETURN5');
    assert(Reflection.isAidtReflectionConfirmed(before.content.draft)&&Reflection.readAidtReturnDecision(before.content.draft).step==='5','CONFIRMED_RETURN5_REQUIRED');
    await page.goto(`${fixture.baseURL}/aidt/${state.projectId}?step=6&tool=outcome`);await page.getByTestId('aidt-stage-output').waitFor();await expect(page.getByTestId('aidt-shared-reload')).toBeEnabled();
    await page.getByTestId('aidt-more-fields').locator('summary').click();const iteration=page.getByTestId('aidt-iteration-prototype');
    await iteration.getByRole('button',{name:'选择迭代产出原型版本',exact:true}).click();await iteration.getByRole('button',{name:state.designName,exact:true}).click();await iteration.getByRole('button',{name:new RegExp(`^选择 v${state.v2.seq}：`)}).click();
    // Editing the feedback changes selectionScope and must cancel an unresolved selection.
    await expect(iteration.getByTestId('aidt-prototype-recorded-reference')).toContainText(state.v2.id);
    const feedback=`第6步V${state.return2.revision}，被审原型 ${state.v1.id}。学生保存的静态检查原文：${state.return2.content.draft.fields.understandingEvidence}`;assert(feedback.length<=2000,'FEEDBACK_TOO_LONG');
    await iteration.getByRole('textbox',{name:'本次修改依据的反馈或未解问题引用',exact:true}).fill(feedback);await iteration.getByRole('textbox',{name:'相对旧版改了什么，为什么？',exact:true}).fill('根据旧版静态检查补“示例2→B分区”的合成设计示意并改按钮文案；按钮仍是静态占位，没有真人反馈或效果验证。');
    await iteration.getByRole('button',{name:'确认关联本次产出、旧版与反馈',exact:true}).click();await page.getByTestId('aidt-test-reflection').getByRole('button',{name:'确认本轮学习记录',exact:true}).click();
    const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith(base));await page.getByTestId('aidt-shared-save').click();const saved=await response;assert(saved.status()===200,'SHARED_SAVE_FAILED');state.v2Bound=Stage.operations.save.out.parse(await saved.json()).stage;
    await iteration.screenshot({path:join(out,'v2-relation.png')});await page.reload();await page.getByTestId('aidt-stage-output').waitFor();
  }
  const restored=await read();assert(JSON.stringify(restored)===JSON.stringify(state.v2Bound),'EXACT_RELOAD_FAILED');assertFrozen(restored.content.draft.fields.questionSnapshot,state.v1Bound.snapshotRaw);
  const fields=restored.content.draft.fields,reference=JSON.parse(fields.iterationPrototypeReference),relation=JSON.parse(fields.iterationPrototypeRelation);
  assert(reference.designId===state.designId&&reference.versionId===state.v2.id&&relation.producedVersionId===state.v2.id&&relation.questionSnapshot===state.v1Bound.snapshotRaw&&relation.feedbackReference.includes(state.v1.id)&&relation.feedbackReference.includes(`第6步V${state.return2.revision}`),'RELATION_MISMATCH');
  const historical=Stage.operations.history.out.parse(await api(base+`/revisions?beforeRevision=${state.return2.revision+1}&limit=1`)).items[0];assert(JSON.stringify(historical)===JSON.stringify(state.return2),'PREVIOUS_RETURN2_CHANGED');assert(record.observedModelPostCount===0,'UNEXPECTED_MODEL_POST');
  const tmp=`${stateFile}.${randomUUID()}.tmp`;writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600,flag:'wx'});renameSync(tmp,stateFile);
  Object.assign(record,{completed:true,stage6Revision:restored.revision,previousReturn2Revision:state.return2.revision,currentS5Revision:state.currentS5.revision,questionSnapshotUnchanged:true,previousReturn2ExactReadback:true,reloadedExact:true,relation});
}catch(error){record.error={type:error?.name??'Error',code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'REQUIRED_UI_OR_CONTRACT_CHECK_FAILED'};process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>undefined);rmdirSync(lock);record.finishedAt=new Date().toISOString();writeFileSync(join(out,'bind-continuation-result.json'),JSON.stringify(record,null,2),{mode:0o600});console.log(JSON.stringify({completed:record.completed,modelPostAttempts:0,resultFile:join(out,'bind-continuation-result.json'),error:record.error??null}));}
