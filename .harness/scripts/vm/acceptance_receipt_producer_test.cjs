const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
// Test wrapper transport locally. Stub the expensive six-journey source execution;
// this verifies SSE/persisted extraction, and is not business/browser acceptance.
const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'local'};
function fixture(failed=false){
 const source=fs.readFileSync(__dirname+'/acceptance_receipt_producer.cjs','utf8');
 const {finishedRun}=require('./cn-maintenance-browser.cjs');
 const sandbox={module:{exports:{}},require:name=>{assert.equal(name,'compiled_maintenance_browser');return {finishedRun,run:async(plan,chromium)=>{const b=await chromium.launch({});const c=await b.newContext({});const page=await c.newPage();for(let n=0;n<3;n++){const r=await page.waitForResponse(n);await r.text();await page.evaluate(()=>{},'/api/agent-runs/run'+n);}return {login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true};}}}};
 vm.runInNewContext(source,sandbox);
 const page={waitForResponse:async n=>({text:async()=>`data: ${JSON.stringify({type:'CUSTOM',name:'execution_event',value:{runId:'run'+n}})}\ndata: ${JSON.stringify({type:'RUN_FINISHED'})}`}),evaluate:async()=>({status:failed?'failed':'succeeded',resultMessageId:'message'})};
 const chromium={launch:async()=>({newContext:async()=>({newPage:async()=>page})})};
 return {produce:sandbox.module.exports.browserReceipt,chromium};
}
test('extracts actual stream IDs only when same persisted reads succeed',async()=>{const f=fixture();const r=await f.produce({deploymentMarker:'marker'},identity,f.chromium,()=>new Date('2026-10-04T17:00:00Z'));assert.deepEqual(Array.from(r.ownedAcceptanceRunIds),['run0','run1','run2']);assert.equal(r.kind,'browser-acceptance-completed');});
test('six passed flags cannot replace failed persisted owned runs',async()=>{const f=fixture(true);await assert.rejects(f.produce({deploymentMarker:'marker'},identity,f.chromium),/ACTUAL_BROWSER_OWNED_RUNS_REQUIRED/);});
