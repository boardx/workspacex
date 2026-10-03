import {test} from 'node:test';import assert from 'node:assert/strict';
import {boardLifecycleDiagnostic as parse} from './board-lifecycle-diagnostics.mjs';
const source={location:{file:'/private/board-shared-outbox.spec.ts'},parent:{project:()=>({name:'chromium'})}};
const emit=data=>'OWNED_LIFECYCLE_VISIBILITY '+JSON.stringify(data)+'\n';
const good={stage:'native-visibilitychange',state:'hidden',trustedChanges:1,untrustedChanges:0,sameDocument:1};
test('rebuilds numeric payload and strips credentials, paths and raw stdout',()=>{const rows=parse('secret prefix\n'+emit({...good,token:'private-token',url:'https://private.example',document:'private DOM'}),source);assert.deepEqual(rows,[{stage:'native-visibilitychange',state:1,trustedChanges:1,untrustedChanges:0,sameDocument:1}]);assert.ok(!JSON.stringify(rows).includes('private'));});
test('rejects foreign spec and project',()=>{assert.deepEqual(parse(emit(good),{...source,location:{file:'foreign.spec.ts'}}),[]);assert.deepEqual(parse(emit(good),{...source,parent:{project:()=>({name:'foreign'})}}),[]);assert.deepEqual(parse(emit(good)),[]);});
test('rejects malformed, arbitrary state/stage and unsafe numeric data',()=>{for(const bad of [{state:'secret'},{stage:'secret'},{trustedChanges:-1},{trustedChanges:0.5},{trustedChanges:1_000_001},{sameDocument:true},{untrustedChanges:'0'}])assert.deepEqual(parse(emit({...good,...bad}),source),[]);assert.deepEqual(parse('OWNED_LIFECYCLE_VISIBILITY nope',source),[]);assert.deepEqual(parse('x'.repeat(4097),source),[]);});
test('preserves changed-document counterproof and all three safe stages',()=>{for(const stage of ['before-freeze','native-visibilitychange','after-active'])assert.equal(parse(emit({...good,stage,sameDocument:0}),source)[0].sameDocument,0);});

test('rejects forbidden frozen Runtime sampling stages',()=>{for(const stage of ['after-freeze','before-active'])assert.deepEqual(parse(emit({...good,stage}),source),[]);});

test('staged lifecycle ordering keeps Runtime diagnostics outside frozen interval and after cleanup restore',async()=>{
 const {readFile}=await import('node:fs/promises');
 const text=await readFile(new URL('../e2e/board-shared-outbox.spec.ts',import.meta.url),'utf8');
 const frozen=text.indexOf("ownerFrozen=true;await ownerLifecycle.send('Page.setWebLifecycleState',{state:'frozen'})");
 const active=text.indexOf("await ownerLifecycle.send('Page.setWebLifecycleState',{state:'active'})",frozen);
 assert.ok(frozen>0&&active>frozen);
 const normalResume=text.indexOf("ownerFrozen=false;mark('original-tab-resumed')",active);
 const normalSample=text.indexOf("captureVisibility('after-active')",active);
 assert.ok(normalResume>active&&normalSample>normalResume);
 assert.ok(!text.slice(frozen,active).includes('captureVisibility('));
 assert.ok(!text.slice(frozen,active).includes("send('Runtime.evaluate'"));
 const cleanup=text.slice(text.indexOf('const lifecycleCleanupErrors:string[]=[];'));
 assert.ok(cleanup.indexOf("send('Page.setWebLifecycleState',{state:'active'})")<cleanup.indexOf("captureVisibility('after-active')"));
 assert.ok(cleanup.includes("ownerLifecycle&&!ownerFrozen&&!ownerWindowChanged)await captureVisibility('after-active')"));
 assert.ok(cleanup.includes("if(ownerFrozen)lifecycleCleanupErrors.push('counts: OWNER_STILL_FROZEN_NOT_READ');\n  else try"));
 assert.ok(cleanup.includes("if(ownerFrozen)lifecycleCleanupErrors.push('listeners: OWNER_STILL_FROZEN_NOT_REMOVED');\n  else try"));
 assert.ok(cleanup.indexOf("restoreOwnerWindow(5000)")<cleanup.indexOf("captureVisibility('after-active')"));
 assert.ok(text.includes("if(!ownerHiddenObserved&&!ownerFrozen)await captureVisibility('after-active')"));
 assert.ok(text.includes("!ownerHiddenObserved||(nativeVisibility.trustedChanges??0)>=2"));
 assert.ok(!cleanup.includes("captureVisibility('before-active')"));
 assert.ok(text.includes("notify(JSON.stringify({type:'visibilitychange',state:document.visibilityState"));
});
