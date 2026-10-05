'use strict';
// Source wrapper calls the actual six-journey runner; supplied passed JSON cannot
// produce a receipt. It records the same SSE/persisted reads the runner consumes.
const {run,finishedRun}=require('compiled_maintenance_browser');
async function browserReceipt(plan,identity,chromium,now=()=>new Date()) {
 const keys=['sourceRevision','baselineRevision','migrationPlanSha256','attemptId'];
 if(!identity||Object.keys(identity).sort().join('|')!==keys.sort().join('|')||identity.sourceRevision!=='9b25bfa65662b96c0826fe67506b562ea46aa6d0'||identity.baselineRevision!=='ba6343199f3c834d6a198f83d0c771614292c82b'||!/^[a-f0-9]{64}$/.test(identity.migrationPlanSha256)||!/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId))throw Error('BROWSER_RECEIPT_FIXED_IDENTITY');
 identity=Object.freeze({...identity}); plan=Object.freeze({...plan});
 const streamRuns=new Set(),persistedRuns=new Set();
 const wrapped={launch:async options=>{
  const browser=await chromium.launch(options);
  return new Proxy(browser,{get(target,key){if(key!=='newContext'){const v=target[key];return typeof v==='function'?v.bind(target):v;}
   return async options=>{const context=await target.newContext(options);return new Proxy(context,{get(c,key){if(key!=='newPage'){const v=c[key];return typeof v==='function'?v.bind(c):v;}
    return async()=>{const page=await c.newPage();return new Proxy(page,{get(p,key){
     if(key==='waitForResponse')return async(...args)=>{const response=await p.waitForResponse(...args);return new Proxy(response,{get(r,key){if(key==='text')return async()=>{const text=await r.text();streamRuns.add(finishedRun(text));return text;};const v=r[key];return typeof v==='function'?v.bind(r):v;}});};
     if(key==='evaluate')return async(fn,arg)=>{const value=await p.evaluate(fn,arg);if(typeof arg==='string'&&arg.startsWith('/api/agent-runs/')){const id=arg.slice('/api/agent-runs/'.length);if(streamRuns.has(id)&&value?.status==='succeeded'&&typeof value.resultMessageId==='string')persistedRuns.add(id);}return value;};
     const v=p[key];return typeof v==='function'?v.bind(p):v;
    }});};
   }});};
  }});
 }};
 const checks=await run(plan,wrapped);
 if(streamRuns.size!==3||persistedRuns.size!==3||[...streamRuns].some(id=>!persistedRuns.has(id)))throw Error('ACTUAL_BROWSER_OWNED_RUNS_REQUIRED');
 return {schemaVersion:1,kind:'browser-acceptance-completed',identity,deploymentMarker:plan.deploymentMarker,observedAt:now().toISOString(),ownedAcceptanceRunIds:[...persistedRuns].sort(),checks};
}
module.exports={browserReceipt};
