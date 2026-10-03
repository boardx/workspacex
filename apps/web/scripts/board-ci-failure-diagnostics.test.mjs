import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardCiFailureDiagnostic as diagnostic} from './board-ci-failure-diagnostics.mjs';
const spec={expectedStatus:'passed',location:{file:'/private/secret/board-selection-layout.spec.ts',line:355},parent:{project:()=>({name:'chromium'})}};
test('only known failing spec produces diagnostics',()=>{
 assert.equal(diagnostic(spec,{status:'passed'}),null);
 assert.equal(diagnostic({...spec,location:{file:'private.spec.ts'}},{status:'failed'}),null);
 assert.equal(diagnostic({...spec,expectedStatus:'failed'},{status:'failed'}),null);
});
test('geometry rejects private fields and non finite numbers',()=>{
 const result=diagnostic(spec,{status:'failed',errors:[{message:'NO_NATIVE_BLANK_POSITION '+JSON.stringify({canvas:{x:0,y:1,width:320,height:900,url:'secret'},zoom:1,margin:120,unobstructedCenters:27,chrome:[{x:0,y:800,width:320,height:100,text:'secret'}],token:'secret'})}]});
 assert.deepEqual(result.geometry,{canvas:{x:0,y:1,width:320,height:900},zoom:1,margin:120,unobstructedCenters:27,chrome:[{x:0,y:800,width:320,height:100}]});
 assert.equal(JSON.stringify(result).includes('secret'),false);
 const invalid=diagnostic(spec,{status:'failed',errors:[{message:'NO_NATIVE_BLANK_POSITION {"canvas":{"width":1e999},"zoom":"secret"}'}]});
 assert.deepEqual(invalid.geometry,{canvas:{}});
});
test('raw errors and unknown projects never leak',()=>{
 const result=diagnostic({...spec,parent:{project:()=>({name:'secret'})}},{status:'timedOut',errors:[{message:'Test timeout of 600000ms exceeded; token secret'}]});
 assert.equal(result.reason,'TEST_TIMEOUT');assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('outbox replay failure retains only fixed code and same-spec numeric locations',()=>{
 const file='board-shared-outbox.spec.ts';
 const result=diagnostic({...spec,location:{file:`/private/secret/${file}`,line:19},parent:{project:()=>({name:'board-api-ws-objectstore'})}},{status:'failed',errors:[{message:'Peer must replay the actual held-ACK receipt after its durable claim expires: token=secret https://private.invalid',location:{file:`/private/secret/${file}`,line:100,column:12},stack:'secret'}]});
 assert.deepEqual(result,{spec:file,status:'failed',project:'board-api-ws-objectstore',testLine:19,reason:'PEER_HELD_ACK_REPLAY_FAILED',errorLine:100});
});
test('actual visual specs expose assertion or timeout codes without private error text',()=>{
 for(const file of ['board-visual-accessibility-acceptance.spec.ts','board-compact-chrome-acceptance.spec.ts']){
  const result=diagnostic({...spec,location:{file:`C:\\private\\secret\\${file}`,line:20}},{status:'failed',errors:[{message:'Error: expect(locator).toBeVisible() token=secret',location:{file:`C:\\private\\secret\\${file}`,line:68}}]});
  assert.deepEqual(result,{spec:file,status:'failed',project:'chromium',testLine:20,reason:'ASSERTION_FAILED',errorLine:68});
  const timeout=diagnostic({...spec,location:{file,line:20}},{status:'timedOut',errors:[{message:'Test timeout of 600000ms exceeded secret'}]});
  assert.equal(timeout.reason,'TEST_TIMEOUT');assert.equal(JSON.stringify(timeout).includes('secret'),false);
 }
});
test('external specs and foreign or invalid error locations cannot enter diagnostics',()=>{
 for(const file of ['foreign.spec.ts','board-shared-outbox.spec.ts.secret','board-visual-accessibility-acceptance.spec.ts.bak'])assert.equal(diagnostic({...spec,location:{file,line:10}},{status:'failed',errors:[{message:'expect(secret)'}]}),null);
 for(const location of [{file:'private.spec.ts',line:100},{file:'board-shared-outbox.spec.ts',line:Infinity},{file:'board-shared-outbox.spec.ts',line:-1},{file:'board-shared-outbox.spec.ts',line:'secret'}]){
  const result=diagnostic({...spec,location:{file:'board-shared-outbox.spec.ts',line:19}},{status:'failed',errors:[{message:'expect(secret)',location}]});
  assert.equal(result.errorLine,undefined);assert.equal(JSON.stringify(result).includes('secret'),false);
 }
});

test('complete geometry is extracted before stack and source tail',()=>{
 const payload=JSON.stringify({canvas:{x:0,y:0,width:320,height:900},margin:120,unobstructedCenters:7,private:'quoted } brace { and escaped " slash \\'});
 const result=diagnostic(spec,{status:'failed',errors:[{message:'Error: NO_NATIVE_BLANK_POSITION '+payload+'\n    at blankPoint (/private/secret.ts:41)\n'+ 'token=secret'.repeat(1000)}]});
 assert.deepEqual(result.geometry,{canvas:{x:0,y:0,width:320,height:900},margin:120,unobstructedCenters:7});
 assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('malicious suffix never supplies geometry and oversized or unfinished JSON is rejected',()=>{
 const suffix=diagnostic(spec,{status:'failed',errors:[{message:'NO_NATIVE_BLANK_POSITION {"canvas":{"width":320}}\n {"zoom":99,"token":"secret"}'}]});
 assert.deepEqual(suffix.geometry,{canvas:{width:320}});
 for(const message of ['NO_NATIVE_BLANK_POSITION {"canvas":{"width":320}', 'NO_NATIVE_BLANK_POSITION '+JSON.stringify({private:'x'.repeat(8200),canvas:{width:320}})]){
  const result=diagnostic(spec,{status:'failed',errors:[{message}]});
  assert.equal(result.geometry,undefined);assert.equal(result.reason,'NO_NATIVE_BLANK_POSITION');
 }
});

test('navigation edge publishes finite chrome geometry without strings or a second payload',()=>{
 const data={navigation:{x:1482,y:867,width:174,height:54,secret:'private'},innerWidth:1672,innerHeight:941,documentClientWidth:1672,ancestors:[{depth:2,bounds:{x:0,y:0,width:1672,height:941},clientWidth:1672,scrollWidth:1677,scrollLeft:5,scrollTop:0,position:'private'}],token:'private'};
 const result=diagnostic({...spec,location:{file:'board-compact-chrome-acceptance.spec.ts',line:15}},{status:'failed',errors:[{message:'NAVIGATION_RIGHT_EDGE '+JSON.stringify(data)+' {"token":"private","innerWidth":1}'}]});
 assert.equal(result.reason,'NAVIGATION_RIGHT_EDGE');assert.equal(result.geometry.innerWidth,1672);assert.equal(result.geometry.ancestors[0].scrollLeft,5);assert.equal(JSON.stringify(result).includes('private'),false);
 const malformed=diagnostic({...spec,location:{file:'board-compact-chrome-acceptance.spec.ts',line:15}},{status:'failed',errors:[{message:'NAVIGATION_RIGHT_EDGE '+JSON.stringify({navigation:{x:Infinity,width:'private'},ancestors:Array(9).fill({scrollLeft:'private'})})}]});
 assert.deepEqual(malformed.geometry.navigation,{});assert.equal(malformed.geometry.ancestors.length,5);assert.equal(JSON.stringify(malformed).includes('private'),false);
});

test('hit diagnostics retain only fixed controls and tags with finite geometry',()=>{
 const result=diagnostic(spec,{status:'failed',errors:[{message:'NO_NATIVE_BLANK_POSITION '+JSON.stringify({candidateCenters:36,hits:[{tag:'DIV',control:'board-live-surface',rect:{x:0,y:0,width:320,height:720},isCanvas:false,secret:'private'},{tag:'private',control:'object-private',rect:{x:null,width:'private'},isCanvas:'private'}]})}]});
 assert.equal(result.geometry.candidateCenters,36);assert.deepEqual(result.geometry.hits,[{tag:'DIV',control:'board-live-surface',rect:{x:0,y:0,width:320,height:720},isCanvas:false},{tag:'OTHER',control:'OTHER',rect:{}}]);assert.equal(JSON.stringify(result).includes('private'),false);
});
