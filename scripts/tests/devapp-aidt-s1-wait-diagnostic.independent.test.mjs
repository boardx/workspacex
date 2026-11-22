import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeAidtProblemOutcomeWait,assertAidtReadOnlyProblemOutput,openAidtProblemOutcome,ownedAidtProblemRoute} from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
const origin='https://devapp.boardx.us',projectId='private-project-qa',entity='11111111-1111-4111-8111-111111111111',thread='thr_aidt_private_qa';
const scope={origin,projectId},href=origin+'/aidt/'+projectId+'?step=1&entity='+entity+'&thread='+thread;
const source=readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-journey.mjs',import.meta.url),'utf8');
const prefixStart=source.indexOf('  const problemObservation = () => {'),prefixEnd=source.indexOf('  const problemName =',prefixStart);
const firstStart=source.indexOf('    const navigation = problemObservation();',prefixEnd),firstEnd=source.indexOf("    report.s1Navigation.operation = 'native-teaching-feedback';",firstStart);
assert.ok(prefixStart>0&&prefixEnd>prefixStart&&firstStart>prefixEnd&&firstEnd>firstStart);
const factory=new Function('observeAidtProblemOutcomeWait','page','scope','origin','report','expect','openAidtProblemOutcome','assertAidtReadOnlyProblemOutput','ownedAidtProblemRoute',
 'let problemRoute; let problemHref;'+source.slice(prefixStart,prefixEnd)+';return {problemObservation,openProblem,setRoute:value=>{problemRoute=value;},runInitial:async()=>{'+source.slice(firstStart,firstEnd)+';return problemHref;}};');
function fixture(failAt,options={}){
 let url=options.url??href,waits=0;const events=[],report={s1Navigation:{operation:'open-problem-outcome',entityOutcomeObserved:false,outcomeWaits:[]}},failure=Object.assign(new Error('private-error-stack-not-exportable'),{name:'TimeoutError'});
 const shape={visible:failAt!=='readonly-panel',editors:failAt==='editors'?1:0,buttons:failAt==='buttons'?1:(options.prints??0),prints:options.prints??0};
 const count=value=>({count:async()=>value});
 const panel={
  isVisible:async()=>{if(options.probeUnavailable)throw Error('private-dom-error');return shape.visible;},
  locator(selector){
   if(selector==='input,textarea,select,[contenteditable]:not([contenteditable="false"])')return count(shape.editors);
   if(selector==='button,[role="button"]')return count(shape.buttons);
   if(selector==='button[type="button"]')return 'type-button';
   throw Error('unexpected-selector');
  },
  getByRole(role,opts){
   assert.equal(role,'button');assert.deepEqual(opts,{name:'打印',exact:true});
   return {and(other){assert.equal(other,'type-button');return count(shape.prints);}};
  },
 };
 const page={url:()=>url,getByRole:(role,opts)=>{assert.equal(role,'region');assert.deepEqual(opts,{name:'工作坊问题产物'});return panel;},waitForURL:async predicate=>{waits++;events.push('thread-'+waits);if(failAt==='before-thread-wait'&&waits===1||failAt==='after-thread-wait'&&waits===2)throw failure;if(failAt==='owned-route')url=origin+'/aidt/'+projectId+'?step=1&entity=invalid-uuid&thread='+thread;assert.equal(predicate(new URL(url)),true);},goto:async(value,opts)=>{events.push('goto');assert.deepEqual(opts,{waitUntil:'domcontentloaded'});if(failAt==='goto')throw failure;url=failAt==='route-bound'?origin+'/aidt/'+projectId+'?step=1':value;}};
 const expect=value=>({toBeVisible:async()=>{assert.equal(value,panel);events.push('panel');if(!shape.visible)throw failure;},toHaveCount:async expected=>{events.push('editors');if(await value.count()!==expected)throw failure;}});
 expect.poll=(read,opts)=>{if(opts)assert.deepEqual(opts,{timeout:30000});return {toBe:async expected=>{events.push(opts?'route':'buttons');if(await read()!==expected)throw failure;}};};
 const f=factory(observeAidtProblemOutcomeWait,page,scope,origin,report,expect,openAidtProblemOutcome,assertAidtReadOnlyProblemOutput,ownedAidtProblemRoute);
 return {...f,page,panel,expect,report,events,failure,shape,setURL:value=>{url=value;}};
}
const keys=['phase','failed','failureKind','ownedRouteCaptured','gotoCompleted','routeBound','threadPredicate','projectMatches','entityMatches','toolMatches','readonlyPanelVisible','editorCount','buttonCount','printButtonCount'].sort();
function safe(data){assert.deepEqual(Object.keys(data).sort(),keys);assert.ok(['before-thread-wait','owned-route','goto','route-bound','readonly-panel','editors','buttons','after-thread-wait','ready'].includes(data.phase));assert.ok([null,'timeout','other'].includes(data.failureKind));for(const key of ['threadPredicate','projectMatches','entityMatches','toolMatches','readonlyPanelVisible'])assert.ok([null,true,false].includes(data[key]));for(const key of ['editorCount','buttonCount','printButtonCount'])assert.ok(data[key]===null||Number.isSafeInteger(data[key])&&data[key]>=0&&data[key]<=1000);for(const key of ['failed','ownedRouteCaptured','gotoCompleted','routeBound'])assert.equal(typeof data[key],'boolean');const serialized=JSON.stringify(data);for(const value of [origin,projectId,entity,thread,'private-','token','headers','error-stack'])assert.ok(!serialized.includes(value));assert.ok(Object.isFrozen(data));}
for(const phase of ['before-thread-wait','owned-route','goto','route-bound','readonly-panel','editors','buttons','after-thread-wait'])test('actual initial wrapper identifies failed '+phase+' and keeps original verdict',async()=>{
 const f=fixture(phase);await assert.rejects(f.runInitial(),error=>phase==='owned-route'?error.code==='S1_ENTITY_ROUTE_INVALID':error===f.failure);
 assert.equal(f.report.s1Navigation.outcomeWaits.length,1);const data=f.report.s1Navigation.outcomeWaits[0];assert.equal(data.phase,phase);assert.equal(data.failed,true);assert.equal(data.failureKind,phase==='owned-route'?'other':'timeout');safe(data);
 assert.equal(data.ownedRouteCaptured,!['before-thread-wait','owned-route'].includes(phase));assert.equal(data.gotoCompleted,!['before-thread-wait','owned-route','goto'].includes(phase));assert.equal(data.routeBound,['readonly-panel','editors','buttons','after-thread-wait'].includes(phase));
 assert.equal(f.report.s1Navigation.entityOutcomeObserved,phase==='after-thread-wait');
});
for(const prints of [0,1])test('actual initial wrapper accepts readonly '+prints+' Print with unchanged awaits',async()=>{
 const f=fixture(undefined,{prints});const result=await f.runInitial();assert.ok(result.includes('tool=outcome'));const data=f.report.s1Navigation.outcomeWaits[0];assert.equal(data.phase,'ready');assert.equal(data.failed,false);assert.equal(data.failureKind,null);assert.equal(data.ownedRouteCaptured,true);assert.equal(data.gotoCompleted,true);assert.equal(data.routeBound,true);assert.equal(data.readonlyPanelVisible,null);assert.equal(data.editorCount,null);safe(data);assert.deepEqual(f.events,['thread-1','goto','route','panel','editors','buttons','thread-2']);
});
test('failed DOM probe remains unknown instead of a negative visibility result',async()=>{
 const f=fixture('readonly-panel',{probeUnavailable:true});await assert.rejects(f.runInitial(),error=>error===f.failure);const d=f.report.s1Navigation.outcomeWaits[0];for(const field of ['readonlyPanelVisible','editorCount','buttonCount','printButtonCount'])assert.equal(d[field],null);safe(d);
});
test('successful negative DOM observation is distinct from unavailable probe',async()=>{const f=fixture('readonly-panel');await assert.rejects(f.runInitial());const d=f.report.s1Navigation.outcomeWaits[0];assert.equal(d.readonlyPanelVisible,false);assert.equal(d.editorCount,0);safe(d);});
test('count probes enforce null or bounded safe integers',async()=>{
 const f=fixture(),o=f.problemObservation();f.shape.editors=1001;f.shape.buttons=-1;f.shape.prints=0.5;await o.failed(f.failure);o.close();assert.equal(o.data.editorCount,null);assert.equal(o.data.buttonCount,null);assert.equal(o.data.printButtonCount,null);safe(o.data);
});
test('unreadable route remains unknown and never exports its getter error',async()=>{
 const f=fixture(),o=observeAidtProblemOutcomeWait({page:{...f.page,url:()=>{throw Error('private-route-text');}},scope});await o.failed(f.failure);o.close();for(const field of ['threadPredicate','projectMatches','entityMatches','toolMatches'])assert.equal(o.data[field],null);safe(o.data);
});
test('foreign route is observed as mismatch without leaking URL identity',async()=>{const f=fixture(),o=f.problemObservation();o.bind(ownedAidtProblemRoute(href,scope));f.setURL('https://foreign.invalid/aidt/private-other?step=1&entity='+entity+'&token=private-token');await o.failed(f.failure);o.close();assert.equal(o.data.projectMatches,false);assert.equal(o.data.entityMatches,false);safe(o.data);});
test('phase enum and passed keys are closed; observer creates no listeners or extra actions',()=>{const f=fixture();f.page.on=()=>assert.fail('listener forbidden');f.page.off=()=>assert.fail('listener forbidden');const o=f.problemObservation();o.phase('private-raw-phase');o.passed('private-key');o.close();assert.equal(o.data.phase,'owned-route');assert.equal(o.data.gotoCompleted,false);safe(o.data);assert.deepEqual(f.events,[]);});
test('actual report factory caps retained observations at eight',()=>{const f=fixture();for(let i=0;i<12;i++)f.problemObservation().close();assert.equal(f.report.s1Navigation.outcomeWaits.length,8);for(const d of f.report.s1Navigation.outcomeWaits)safe(d);});
test('late failed DOM resolution and phase/bind calls cannot mutate a closed snapshot',async()=>{
 const f=fixture();let resolve;f.panel.isVisible=()=>new Promise(done=>{resolve=done;});const o=f.problemObservation(),pending=o.failed(f.failure);o.close();const before=JSON.stringify(o.data);resolve(true);await pending;o.phase('buttons');o.passed('gotoCompleted');o.bind(ownedAidtProblemRoute(href,scope));o.close();assert.equal(JSON.stringify(o.data),before);assert.equal(o.data.readonlyPanelVisible,null);safe(o.data);
});
test('hostile error-name access is contained and raw error properties are never retained',async()=>{const f=fixture(),o=f.problemObservation(),error={get name(){throw Error('private-getter-error');},message:'private-message',stack:'private-stack',headers:'private-header'};await o.failed(error);o.close();assert.equal(o.data.failureKind,'other');safe(o.data);});
test('ordinary later openProblem wrapper records its own original failure and closes once',async()=>{const f=fixture('buttons');f.setRoute(ownedAidtProblemRoute(href,scope));await assert.rejects(f.openProblem(),error=>error===f.failure);assert.equal(f.report.s1Navigation.outcomeWaits.length,1);const d=f.report.s1Navigation.outcomeWaits[0];assert.equal(d.phase,'buttons');assert.equal(d.buttonCount,1);assert.equal(d.printButtonCount,0);safe(d);});
