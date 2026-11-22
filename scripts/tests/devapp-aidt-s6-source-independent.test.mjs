/** Actual control closures with local ports only; not a browser or database test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-journey.mjs',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function between(from,to,start=0){const a=source.indexOf(from,start);assert.ok(a>=0,from);const b=source.indexOf(to,a);assert.ok(b>a,to);return source.slice(a,b);}
const freezeBody=between("const nextLink = page.getByTestId('aidt-stage-next');","await shot('05-prototype-question-version'",source.indexOf('const prototype = JSON.parse(frozen.prototypeReference'));
const freeze=new AsyncFunction('page','expect','owned','revision','designId','prototype','fail',`let step6Href,confirmedPrototype;${freezeBody};return {step6Href,confirmedPrototype};`);
const s6Start=source.indexOf("state.s6 = await check('s6-test-reflection'");
const creationBody=between('await page.goto(owned(step6Href));','const initialPlan =',s6Start);
const create=new AsyncFunction('page','expect','owned','step6Href','method','label','unique','confirmedPrototype','scope','click','fill','btn','captureCardCreation','output','disclosure',`${creationBody};return {testTarget,researchPath};`);
const checkBody=between('if (testRecord.method !== method || testRecord.researchPath',"if (method === 'survey')",s6Start);
const checkSaved=new Function('testRecord','method','researchPath','confirmedPrototype','proof','fields','fail',checkBody);
const fail=code=>{throw Error(code);};
const original={designId:'design-synthetic',versionId:'saved-v2',stage5Revision:12};
const href=(id=original.designId,revision=12)=>`https://devapp.boardx.us/aidt/prj-synthetic?step=6&prototypeEntity=${id}&prototypeRevision=${revision}`;
const expectPort=locator=>({async toBeVisible(){assert.notEqual(locator.visible,false);},async toHaveValue(x){assert.equal(locator.value(),x);},async toBeDisabled(){assert.equal(locator.disabled(),true);},async toBeEnabled(){assert.equal(locator.disabled(),false);},async toHaveCount(x){assert.equal(locator.count(),x);},async toContainText(x){assert.ok(locator.text().includes(x),'missing '+x);},not:{async toBeChecked(){assert.equal(locator.checked(),false);}}});
async function freezeS5({url=href(),prototype={versionId:original.versionId},revision=12}={}){const page={getByTestId(id){assert.equal(id,'aidt-stage-next');return{getAttribute:async name=>{assert.equal(name,'href');return url;}};}};return freeze(page,expectPort,x=>x,async stage=>{assert.equal(stage,5);return revision;},original.designId,prototype,fail);}
async function createGroup(method,options={}){
 const events=[],state={name:'',path:options.preselectedPath??'',checked:options.prechecked??false,preview:false,created:false},actual={...original,...options.actualSource};
 const path={value:()=>state.path,selectOption:async value=>{events.push('select:'+value);if(!options.skipSelection)state.path=value;}};
 const checkbox={checked:()=>state.checked,check:async()=>{events.push('check');if(!options.skipCheck)state.checked=true;}};
 const button={disabled:()=>!state.name.trim()||!state.path||!state.checked,click:async()=>{assert.equal(button.disabled(),false);events.push('create');state.created=true;}};
 const previewButton={click:async()=>{events.push('preview');state.preview=true;}};
 const dialog={getByRole(role,o){if(role==='combobox'){assert.equal(o.name,'研究路径');assert.equal(o.exact,true);return path;}if(role==='checkbox'){assert.equal(o.name,'确认使用所选原型的已保存版本开展本轮研究');assert.equal(o.exact,true);return checkbox;}if(role==='region'){assert.equal(o.name,'被测原型预览');assert.equal(o.exact,true);return{text:()=>{assert.equal(state.preview,true);return '固定版本 '+actual.versionId;}};}throw Error('unexpected dialog role');},text:()=>`原型 第 5 步 V${actual.stage5Revision} · Design ${actual.designId} · 版本 ${actual.versionId}`};
 const sources={getByRole(role,o){assert.equal(role,'combobox');assert.equal(o.name,'研究路径');assert.equal(o.exact,true);return path;}};
 const page={goto:async()=>events.push('goto'),getByRole(role,o){assert.equal(role,'dialog');assert.equal(o.name,'新建测试卡片');return dialog;},getByTestId(id){if(id==='aidt-new-entity-card')return{click:async()=>events.push('new-card')};if(id==='aidt-test-group-detail')return{getByRole:role=>{assert.equal(role,'textbox');return{count:()=>0};}};if(id==='aidt-test-chat-confirmation')return{};if(id==='aidt-test-group-sources')return sources;throw Error('unexpected test id');},waitForResponse:()=>{throw Error('prelude must not write a method change');}};
 const btn=(name,root)=>{assert.equal(root,dialog);if(name==='创建测试卡片')return button;if(name==='预览所选原型版本')return previewButton;throw Error('unexpected button');};
 const result=await create(page,expectPort,x=>x,href(),method,method==='survey'?'问卷':'线下访谈','synthetic',original,{projectId:'prj-synthetic'},x=>x.click(),async(name,value,root)=>{assert.equal(name,'测试名称');assert.equal(root,dialog);state.name=value;},btn,async(stage,type,action,o)=>{assert.equal(stage,6);assert.equal(type,'test');assert.equal(o.reopen,true);await action();return{target:{entityId:method+'-synthetic'}};},async()=>{},async name=>{assert.equal(name,'关联测试材料');});
 assert.equal(state.created,true);return{result,events};
}
const record=(method,change={})=>({...original,method,researchPath:method==='survey'?'survey':'offline',confirmedFromMessageId:'synthetic-reply',task:'合成任务',reflection:'合成反思',...change});
function validate(value,method){checkSaved(value,method,method==='survey'?'survey':'offline',original,{assistantMessageId:'synthetic-reply'},{reflectionConfirmed:'true',understandingChangeStatus:'insufficient',returnStep:'2'},fail);}
test('S5 freezes its confirmed stored tuple rather than following a later V3',async()=>{const current={versionId:'saved-v2'},f=await freezeS5({prototype:current});assert.deepEqual(f.confirmedPrototype,original);assert.equal(Object.isFrozen(f.confirmedPrototype),true);current.versionId='later-v3';assert.equal(f.confirmedPrototype.versionId,'saved-v2');});
for(const change of [{url:href('other-design')},{url:href(undefined,13)}])test('S5 rejects mismatched handoff '+JSON.stringify(change),async()=>{await assert.rejects(freezeS5(change),/S5_HANDOFF_VERSION_MISMATCH/);});
for(const method of ['interview','survey'])test(method+' selects its normal path, previews and explicitly checks before creation',async()=>{const r=await createGroup(method);assert.equal(r.result.researchPath,method==='survey'?'survey':'offline');assert.deepEqual(r.events,['goto','new-card','select:'+(method==='survey'?'survey':'offline'),'preview','check','create']);});
for(const options of [{prechecked:true},{preselectedPath:'offline'},{skipSelection:true},{skipCheck:true}])test('missing or prefilled state cannot bypass explicit creation '+JSON.stringify(options),async()=>{await assert.rejects(createGroup('interview',options));});
for(const actualSource of [{versionId:'later-v3'},{designId:'other-design'},{stage5Revision:13}])test('preview cannot drift from original S5 '+JSON.stringify(actualSource),async()=>{await assert.rejects(createGroup('survey',{actualSource}));});
test('both saved groups independently match the original confirmed S5 tuple',()=>{validate(record('interview'),'interview');validate(record('survey'),'survey');});
for(const change of [{versionId:'later-v3'},{designId:'other-design'},{stage5Revision:13}])test('both groups matching each other is insufficient '+JSON.stringify(change),()=>{assert.throws(()=>validate(record('interview',change),'interview'),/TEST_NATIVE_ROUND_UNVERIFIED/);assert.throws(()=>validate(record('survey',change),'survey'),/TEST_NATIVE_ROUND_UNVERIFIED/);});
test('saved path and method must remain the chosen offline or survey path',()=>{assert.throws(()=>validate(record('interview',{researchPath:'survey'}),'interview'),/TEST_NATIVE_ROUND_UNVERIFIED/);assert.throws(()=>validate(record('survey',{method:'interview'}),'survey'),/TEST_NATIVE_ROUND_UNVERIFIED/);});
