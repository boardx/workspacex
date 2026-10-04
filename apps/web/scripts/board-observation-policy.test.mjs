import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateRuntimeBinding,validateBoardObservationArtifact,validateNativeCreationEvidence} from './board-observation-policy.mjs';
const sha='a'.repeat(40),context={runtimeMarker:'fresh',startedAt:'2026-09-27T00:00:00Z',endedAt:'2026-09-27T00:40:00Z'};
const identity={sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'fresh',buildId:'id',runStartedAt:context.startedAt,buildCreatedAt:'2026-09-27T00:01:00Z',chunks:[{url:'/x.js',sha256:'b'.repeat(64),localSha256:'b'.repeat(64)}]};
test('runtime is bound to exact fresh run and built chunks',()=>{
 assert.deepEqual(validateRuntimeBinding(identity,sha,context),[]);
 for(const patch of [{deploymentMarker:'old'},{runStartedAt:'invalid'},{buildCreatedAt:'2026-09-28T00:00:00Z'},{dirty:true},{buildSha:'c'.repeat(40)},{chunks:[]}])assert.ok(validateRuntimeBinding({...identity,...patch},sha,context).length);
});
test('visual cannot substitute duplicate browsers or arbitrary success metadata',async()=>{
 for(const reports of [[],[{browserName:'chromium'},{browserName:'chromium'},{browserName:'webkit'}]]){
 const result=await validateBoardObservationArtifact({version:1,kind:'board-visual-accessibility-bundle',reports},'visual',sha,context);assert.equal(result.valid,false);assert.equal(result.score,null);
 }
});
test('unsigned or invalidly signed meeting room artifacts cannot be accepted',async()=>{
 for(const key of [undefined,'x'.repeat(32)]){
 const result=await validateBoardObservationArtifact({version:1,kind:'board-meeting-room',ledger:{signature:'0'.repeat(64)},runtimeBefore:identity,runtimeAfter:identity},'meeting-room',sha,context,key);assert.equal(result.valid,false);assert.equal(result.score,null);
 }
});

test('native creation evidence accepts two separately armed creations and rejects obsolete continuous semantics',()=>{
 const report={input:[{kind:'keyboard-armed-single-creation',count:2}],canonical:{objects:[{type:'sticky'}]}};
 assert.deepEqual(validateNativeCreationEvidence(report),[]);
 for(const input of [[{kind:'keyboard-continuous-creation',count:2}],[{kind:'keyboard-armed-single-creation',count:1}],[{kind:'keyboard-armed-single-creation',count:3}],[{kind:'keyboard-armed-single-creation',count:'2'}],[],undefined]){
  assert.deepEqual(validateNativeCreationEvidence({...report,input}),['REAL_OBJECT_INPUT_REQUIRED']);
 }
 for(const canonical of [{objects:[]},{},undefined])assert.deepEqual(validateNativeCreationEvidence({...report,canonical}),['REAL_OBJECT_INPUT_REQUIRED']);
});

async function functionalBundle(){
 const {visualViewports,productionCoreToolIds}=await import('../e2e/support/board-visual-policy.ts');
 return {version:1,kind:'board-functional-accessibility-bundle',reports:['chromium','firefox','webkit'].map(browserName=>({
  version:1,kind:'board-functional-accessibility',observationMode:'functional',browserName,sha,runtimeIdentity:structuredClone(identity),
  status:'engineering-observations-pending-human',approved:false,score:null,boardId:'owned-board',browse:null,
  captures:visualViewports.flatMap(viewport=>['empty','mixed','multiselect','properties'].map(prefix=>({
   label:`${prefix}-${viewport.width}`,at:'2026-09-27T00:02:00Z',screenshot:null,failures:[],
   measurement:{viewport,canvasAvailable:.9,toolbarCount:1,toolbarHeight:44,editorReachable:true,
    controls:productionCoreToolIds.map(name=>({name,width:44,height:44,reachable:true}))}
  }))),axeResults:[{violations:[]},{violations:[]},{violations:[]}],counterproof:['button-name'],
  input:[{kind:'keyboard-armed-single-creation',count:2}],canonical:{objects:[{type:'sticky'}]}
 }))};
}
const validateFunctional=report=>validateBoardObservationArtifact(report,'accessibility',sha,context,undefined,'functional');
test('functional evidence retains all browser/state/geometry/accessibility/canonical gates and never verifies pixels',async()=>{
 const report=await functionalBundle(),result=await validateFunctional(report);
 assert.equal(result.valid,true);assert.equal(result.score,null);assert.ok(result.pending.includes('visual-heavy-deferred-not-verified'));
 assert.equal((await validateBoardObservationArtifact(report,'visual',sha,context)).valid,false,'full visual validator rejects functional artifacts');
 for(const mutate of [
  r=>r.reports.pop(),r=>r.reports[1].browserName='chromium',r=>r.reports[0].runtimeIdentity.dirty=true,
  r=>r.reports[0].captures.pop(),r=>r.reports[0].captures[0].measurement.canvasAvailable=.79,
  r=>r.reports[0].captures[0].measurement.controls[0].reachable=false,
  r=>r.reports[0].captures[0].measurement.controls[0].width=43,
  r=>r.reports[0].captures[0].measurement.editorReachable=false,
  r=>r.reports[0].captures[0].at='2026-09-28T00:00:00Z',
  r=>r.reports[0].axeResults[0].violations.push({impact:'serious'}),r=>r.reports[0].counterproof=[],
  r=>r.reports[0].input[0].count=1,r=>r.reports[0].canonical.objects=[],
  r=>r.reports[0].observationMode='all',r=>r.reports[0].kind='board-visual-accessibility',
  r=>r.reports[0].browse={path:'unread',sha256:'b'.repeat(64)},r=>delete r.reports[0].captures[0].screenshot
 ]){const changed=structuredClone(report);mutate(changed);assert.equal((await validateFunctional(changed)).valid,false);}
 const visualClaim=structuredClone(report);visualClaim.kind='board-visual-accessibility-bundle';
 for(const r of visualClaim.reports){r.kind='board-visual-accessibility';r.observationMode='all';}
 assert.equal((await validateFunctional(visualClaim)).valid,false);
 assert.equal((await validateBoardObservationArtifact(report,'visual',sha,context,undefined,'skip')).valid,false);
});

test('full visual mode still requires actual hashed PNG files and rejects functional/null substitution',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'board-observation-policy-'));
 try{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=','base64');
  const path=join(directory,'pixel.png');await writeFile(path,bytes);
  const ref={path,sha256:createHash('sha256').update(bytes).digest('hex')};
  const report=await functionalBundle();report.kind='board-visual-accessibility-bundle';
  for(const r of report.reports){r.kind='board-visual-accessibility';r.observationMode='all';r.browse=ref;for(const c of r.captures)c.screenshot=ref;}
  const validate=report=>validateBoardObservationArtifact(report,'visual',sha,context);
  assert.equal((await validate(report)).valid,true);
  for(const mutate of [r=>r.reports[0].browse=null,r=>r.reports[0].captures[0].screenshot=null,r=>r.reports[0].browse={path,sha256:'0'.repeat(64)},r=>r.reports[0].observationMode='functional']){
   const changed=structuredClone(report);mutate(changed);assert.equal((await validate(changed)).valid,false);
  }
  assert.equal((await validateFunctional(report)).valid,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
