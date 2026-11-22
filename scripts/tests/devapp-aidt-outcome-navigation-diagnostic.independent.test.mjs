import test from 'node:test';
import assert from 'node:assert/strict';
import {aidtOutcomeNavigationRequestKind as kind,observeAidtOutcomeNavigation as observe,openAidtEntityOutcome as open} from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
const ORIGIN='https://devapp.boardx.us',ORG='qa-org',THREAD='thr_aidt_qa',ENTITY='11111111-1111-4111-8111-111111111111';
const target={origin:ORIGIN,projectId:'qa-project',stage:2,entityId:ENTITY,href:ORIGIN+'/aidt/qa-project?step=2&entity='+ENTITY+'&thread='+THREAD};
const scope={target,threadId:THREAD,orgId:ORG};
const endpoint=()=>ORIGIN+'/api/projects/qa-project/aidt/stages/2/entities/'+ENTITY+'/thread';
const req=(url,method='GET')=>({url:()=>url,method:()=>method,headers:()=>{throw Error('private-header');},postData:()=>{throw Error('private-body');},failure:()=>{throw Error('private-failure');}});
function fakePage({visible={},probeError=false}={}){
 const listeners=new Map(),all=[],calls=[];let url=target.href;
 const page={url:()=>url,goto:async(value,options)=>{calls.push(['goto',options]);url=value;},on:(event,fn)=>{all.push([event,fn]);const set=listeners.get(event)??new Set();set.add(fn);listeners.set(event,set);},off:(event,fn)=>{listeners.get(event)?.delete(fn);},getByText:()=>({isVisible:async()=>{if(probeError)throw Error('private-dom');return visible.preparing??false;}}),getByTestId:id=>({isVisible:async()=>{if(probeError)throw Error('private-dom');return visible[id]??false;}})};
 return {page,calls,listeners,all,setURL:value=>{url=value;},emit:(event,value)=>{for(const fn of listeners.get(event)??[])fn(value);}};
}
function bounded(data){
 assert.deepEqual(Object.keys(data).sort(),['phase','completed','failed','routeObserved','sameOrigin','projectMatches','stageMatches','entityMatches','threadMatches','sourceMatches','toolMatches','domObserved','preparingVisible','composerVisible','inspectorVisible','outcomeVisible','requestObservationAvailable','requests','requestsTruncated'].sort());
 assert.deepEqual(Object.keys(data.completed).sort(),['goto','routeBound','inspectorReady'].sort());
 assert.ok(['goto','route-bound','inspector-ready'].includes(data.phase));assert.ok(data.requests.length<=32);
 for(const row of data.requests){assert.deepEqual(Object.keys(row).sort(),['kind','phase','state','httpStatus'].sort());assert.ok(['catalog','entityThread','threadRead','mountRead','mountWrite'].includes(row.kind));assert.ok(['goto','route-bound','inspector-ready'].includes(row.phase));assert.ok(['pending','response','requestfailed'].includes(row.state));assert.ok(row.httpStatus===null||Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599);}
 const serialized=JSON.stringify(data);for(const value of [ORIGIN,ORG,THREAD,ENTITY,'private-','Bearer','token=','errorText','header','body'])assert.ok(!serialized.includes(value));
}
const entries=[
 ['catalog',ORIGIN+'/api/skills?orgId='+ORG+'&entry=library','GET'],
 ['catalog',ORIGIN+'/api/capabilities?orgId='+ORG+'&kind=agent','GET'],
 ['entityThread',endpoint(),'PUT'],
 ['threadRead',ORIGIN+'/api/chat/threads/'+THREAD+'?projectId=qa-project','GET'],
 ['mountRead',ORIGIN+'/api/threads/'+THREAD+'/skill-deviations?projectId=qa-project','GET'],
 ['mountWrite',ORIGIN+'/api/threads/'+THREAD+'/skill-mounts?projectId=qa-project','POST'],
];
for(const [expected,url,method]of entries)test('classifies only actual operation '+expected+' '+method,()=>assert.equal(kind({url,method},scope),expected));
test('does not classify nonexistent entity-thread POST',()=>assert.equal(kind({url:endpoint(),method:'POST'},scope),undefined));
for(const [name,url,method]of [
 ['foreign origin','https://other.invalid/api/skills?orgId='+ORG,'GET'],
 ['foreign org',ORIGIN+'/api/skills?orgId=other-org','GET'],
 ['foreign project',ORIGIN+'/api/chat/threads/'+THREAD+'?projectId=other-project','GET'],
 ['foreign thread',ORIGIN+'/api/chat/threads/thr_other?projectId=qa-project','GET'],
 ['foreign entity',endpoint().replace(ENTITY,'other-entity'),'PUT'],
 ['token query',ORIGIN+'/api/skills?orgId='+ORG+'&token=private-token','GET'],
 ['duplicate query',ORIGIN+'/api/skills?orgId='+ORG+'&orgId='+ORG,'GET'],
 ['username',ORIGIN.replace('https://','https://private-user@')+'/api/skills?orgId='+ORG,'GET'],
 ['fragment',ORIGIN+'/api/skills?orgId='+ORG+'#private-text','GET'],
 ['invalid URL','not a URL','GET'],
 ['wrong catalog method',ORIGIN+'/api/skills?orgId='+ORG,'POST'],
])test('ignores '+name,()=>assert.equal(kind({url,method},scope),undefined));
for(const [name,extra]of [['invalid thread',{threadId:'../../private-thread'}],['invalid org',{orgId:'bad/private-org'}]])test('invalid identity prevents metadata observation: '+name,()=>assert.equal(kind({url:ORIGIN+'/api/skills?orgId='+ORG,method:'GET'},{...scope,...extra}),undefined));
test('without navigation no listeners/probes are attached and original call order/return stays exact',async()=>{
 const f=fakePage();const order=[];f.page.on=()=>assert.fail('no diagnostics listener');f.page.off=()=>assert.fail('no diagnostics detach');
 const goto=f.page.goto;f.page.goto=async(...args)=>{order.push('goto');await goto(...args);};
 const result=await open({page:f.page,target,activate:async()=>order.push('activate'),waitForRoute:async predicate=>{order.push('wait');assert.equal(predicate(),true);},assertDetail:async()=>order.push('detail'),assertReady:async()=>order.push('ready')});
 assert.deepEqual(order,['activate','wait','detail','goto','wait','ready']);assert.equal(result.entityId,ENTITY);assert.deepEqual(f.calls,[['goto',{waitUntil:'domcontentloaded'}]]);
});
test('successful navigation keeps ordering and detaches all three listeners in finally',async()=>{
 const f=fakePage(),diagnostics={},order=[];const goto=f.page.goto;f.page.goto=async(...args)=>{order.push('goto');await goto(...args);};
 await open({page:f.page,target,navigation:{diagnostics,threadId:THREAD,orgId:ORG},waitForRoute:async predicate=>{order.push('wait');assert.equal(predicate(),true);},assertReady:async()=>order.push('ready')});
 assert.deepEqual(order,['goto','wait','ready']);const d=diagnostics.outputNavigation;assert.deepEqual(d.completed,{goto:true,routeBound:true,inspectorReady:true});assert.equal(d.failed,false);assert.equal(d.domObserved,false);bounded(d);for(const set of f.listeners.values())assert.equal(set.size,0);assert.ok(Object.isFrozen(d));
});
for(const stage of ['goto','route-bound','inspector-ready'])test('preserves original error and exact failed phase '+stage,async()=>{
 const f=fakePage({visible:{preparing:true}}),diagnostics={},failure=new Error('private-original-error');
 if(stage==='goto')f.page.goto=async()=>{throw failure;};
 await assert.rejects(open({page:f.page,target,navigation:{diagnostics,threadId:THREAD,orgId:ORG},waitForRoute:async()=>{if(stage==='route-bound')throw failure;},assertReady:async()=>{throw failure;}}),error=>error===failure);
 const d=diagnostics.outputNavigation;assert.equal(d.phase,stage);assert.equal(d.failed,true);assert.equal(d.domObserved,true);assert.equal(d.preparingVisible,true);assert.equal(d.composerVisible,false);assert.equal(d.completed.goto,stage!=='goto');assert.equal(d.completed.routeBound,stage==='inspector-ready');assert.equal(d.completed.inspectorReady,false);bounded(d);for(const set of f.listeners.values())assert.equal(set.size,0);
});
test('route mismatch keeps original strict failure and never calls ready',async()=>{
 const f=fakePage(),diagnostics={};f.page.goto=async()=>f.setURL(ORIGIN+'/aidt/qa-project?step=2&entity=other&tool=outcome');let ready=0;
 await assert.rejects(open({page:f.page,target,navigation:{diagnostics,threadId:THREAD,orgId:ORG},waitForRoute:async()=>{},assertReady:async()=>{ready++;}}),error=>error.code==='ENTITY_OUTCOME_UNVERIFIED');assert.equal(ready,0);bounded(diagnostics.outputNavigation);
});
test('unavailable DOM probe is unknown, rather than an observed negative',async()=>{
 const f=fakePage({probeError:true}),o=observe({...scope,page:f.page,tool:'outcome'});await o.failed();o.close();assert.equal(o.data.domObserved,false);for(const key of ['preparingVisible','composerVisible','inspectorVisible','outcomeVisible'])assert.equal(o.data[key],false);bounded(o.data);
});
test('observed all-false DOM is distinct from unavailable DOM',async()=>{
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'});await o.failed();o.close();assert.equal(o.data.domObserved,true);assert.equal(o.data.preparingVisible,false);bounded(o.data);
});
test('records only bounded enum/status rows without requesting body/header/failure text',()=>{
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'});
 const a=req(entries[0][1]),b=req(entries[3][1]),c=req(entries[4][1]);f.emit('request',a);o.phase('route-bound');f.emit('request',b);o.phase('inspector-ready');f.emit('request',c);
 f.emit('response',{request:()=>a,status:()=>200});f.emit('requestfailed',b);f.emit('response',{request:()=>c,status:()=>999});o.close();
 assert.deepEqual(o.data.requests,[{kind:'catalog',phase:'goto',state:'response',httpStatus:200},{kind:'threadRead',phase:'route-bound',state:'requestfailed',httpStatus:null},{kind:'mountRead',phase:'inspector-ready',state:'response',httpStatus:null}]);bounded(o.data);
});
test('ring is capped at 32 without retaining the extra request identity',()=>{
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'});for(let i=0;i<41;i++)f.emit('request',req(entries[3][1]));o.close();assert.equal(o.data.requests.length,32);assert.equal(o.data.requestsTruncated,true);bounded(o.data);
});
test('foreign/unrecognized events and responses never enter report',()=>{
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'});const request=req('https://foreign.invalid/private-path?token=private-text');f.emit('request',request);f.emit('response',{request:()=>request,status:()=>403});o.close();assert.deepEqual(o.data.requests,[]);bounded(o.data);
});
test('closed observation is immutable even if retained late handlers fire',()=>{
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'}),request=req(entries[3][1]);f.emit('request',request);const old=[...f.all];o.close();const before=JSON.stringify(o.data);
 for(const [event,handler]of old){if(event==='request')handler(req(entries[0][1]));if(event==='response')handler({request:()=>request,status:()=>500});if(event==='requestfailed')handler(request);}
 o.phase('goto');o.close();assert.equal(JSON.stringify(o.data),before);bounded(o.data);
});
test('unavailable event APIs produce no request claims',()=>{
 const f=fakePage();delete f.page.on;delete f.page.off;const o=observe({...scope,page:f.page,tool:'outcome'});o.close();assert.equal(o.data.requestObservationAvailable,false);assert.deepEqual(o.data.requests,[]);bounded(o.data);
});
test('a partial listener registration failure detaches what attached and preserves diagnosis unknown',()=>{
 const f=fakePage(),on=f.page.on;f.page.on=(event,handler)=>{if(event==='response')throw Error('private-attach-error');on(event,handler);};const o=observe({...scope,page:f.page,tool:'outcome'});assert.equal(o.data.requestObservationAvailable,false);o.close();for(const set of f.listeners.values())assert.equal(set.size,0);bounded(o.data);
});
test('late DOM completion after close cannot mutate frozen observation',async()=>{
 const f=fakePage();let finish;f.page.getByText=()=>({isVisible:()=>new Promise(resolve=>{finish=resolve;})});const o=observe({...scope,page:f.page,tool:'outcome'}),pending=o.failed();o.close();const before=JSON.stringify(o.data);finish(true);await pending;assert.equal(JSON.stringify(o.data),before);assert.equal(o.data.domObserved,false);bounded(o.data);
});
test('listener cleanup errors cannot replace the original navigation failure',async()=>{
 const f=fakePage(),diagnostics={},original=new Error('private-navigation');f.page.goto=async()=>{throw original;};f.page.off=()=>{throw Error('private-cleanup');};await assert.rejects(open({page:f.page,target,navigation:{diagnostics,threadId:THREAD,orgId:ORG},waitForRoute:async()=>{},assertReady:async()=>{}}),error=>error===original);bounded(diagnostics.outputNavigation);
});
test('activation failure remains before observer attachment or goto',async()=>{
 const f=fakePage(),diagnostics={},original=new Error('private-activation');await assert.rejects(open({page:f.page,target,navigation:{diagnostics,threadId:THREAD,orgId:ORG},activate:async()=>{throw original;},waitForRoute:async()=>{},assertDetail:async()=>{},assertReady:async()=>{}}),error=>error===original);assert.equal(f.all.length,0);assert.equal(f.calls.length,0);assert.equal(Object.hasOwn(diagnostics,'outputNavigation'),false);
});
test('org enters internal journey port only; public scope and diagnostic snapshots remain unchanged',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs',import.meta.url),'utf8');
 const marker=source.indexOf('await selectedJourney({');assert.ok(marker>0);const call=source.slice(marker,source.indexOf('checkpoint, capture,',marker));
 assert.ok(call.includes('scope: { projectId, projectName: identity.projectName'));assert.ok(!call.includes('outcomeDiagnosticOrgId'));assert.ok(!call.includes('guard.identity().org'));
 assert.ok(source.slice(marker,marker+1000).includes('outcomeDiagnosticOrgId: guard.identity().org'));
 const f=fakePage(),o=observe({...scope,page:f.page,tool:'outcome'});o.close();bounded(o.data);assert.ok(!JSON.stringify(o.data).includes(ORG));
});
