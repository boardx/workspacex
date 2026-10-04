import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import BoardCiReporter from './board-ci-reporter.mjs';

test('reporter preserves failed results and publishes only the first allowlisted diagnostic',()=>{
 const root=mkdtempSync(join(tmpdir(),'board-ci-reporter-diagnostic-'));
 const previous=process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
 const originalWrite=process.stderr.write;let logs='';
 process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=join(root,'report.json');
 process.stderr.write=function(chunk){logs+=String(chunk);return true;};
 try{
  const reporter=new BoardCiReporter();
  const base={expectedStatus:'passed',location:{file:'/private/secret/board-selection-layout.spec.ts',line:355},parent:{project:()=>({name:'chromium'})}};
  reporter.onTestEnd({...base,id:'first'},{status:'failed',retry:0,errors:[{message:'NO_NATIVE_BLANK_POSITION {"canvas":{"width":320},"token":"secret"}'}]});
  reporter.onTestEnd({...base,id:'second'},{status:'timedOut',retry:0,errors:[{message:'Test timeout of 600000ms exceeded; secret'}]});
  reporter.onEnd({status:'failed'});
  const report=JSON.parse(readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,'utf8'));
  assert.equal(report.firstFailure.reason,'NO_NATIVE_BLANK_POSITION');
  assert.deepEqual(report.firstFailure.geometry,{canvas:{width:320}});
  assert.equal(report.suites[0].specs[0].tests.length,2);
  assert(report.suites[0].specs[0].tests.every(row=>row.status==='unexpected'));
  assert(report.errors.some(error=>error.code==='PLAYWRIGHT_NOT_PASSED'));
  assert.equal(logs.split('TEST_FAILURE').length-1,1);
  for(const value of ['secret','token','/private/'])assert.equal((logs+JSON.stringify(report)).includes(value),false);
 }finally{
  process.stderr.write=originalWrite;
  if(previous===undefined)delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=previous;
  rmSync(root,{recursive:true});
 }
});

// --list loads the real reporter and test imports but never starts configured services.
test('custom reporter discovers real visual and journey suites without services',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {createRequire}=await import('node:module');
 const {fileURLToPath}=await import('node:url');
 const cli=createRequire(import.meta.url).resolve('@playwright/test/cli');
 const cwd=fileURLToPath(new URL('../',import.meta.url));
 const reporter=fileURLToPath(new URL('./board-ci-reporter.mjs',import.meta.url));
 const root=mkdtempSync(join(tmpdir(),'board-ci-discovery-'));
 const env={...process.env,COMPOSE_PROJECT_NAME:'discovery-only-no-services',PLAYWRIGHT_JSON_OUTPUT_FILE:join(root,'report.json')};
 const ports=['WORKSPACEX_API_PORT','WORKSPACEX_WEB_PORT','WORKSPACEX_MODEL_PROVIDER_PORT','WORKSPACEX_DEEP_AGENT_PROVIDER_PORT','WORKSPACEX_LOOPBACK_SANDBOX_PORT','WORKSPACEX_ASR_PROVIDER_PORT','WORKSPACEX_MAIL_PROVIDER_PORT','PGPORT'];
 ports.forEach((name,index)=>{env[name]=String(19000+index);});
 try{
  for(const config of ['e2e/board-visual-accessibility-acceptance.config.ts','e2e/board-journey-acceptance.config.ts']){
   const result=spawnSync(process.execPath,[cli,'test','--config',config,'--list','--reporter=list,'+reporter],{cwd,env,encoding:'utf8',timeout:10000});
   assert.equal(result.status,0,`${config}: ${result.error?.code??'DISCOVERY_FAILED'}`);
   assert.match(result.stdout,/Total: [1-9]\d* tests/);
   if(config.includes('visual'))for(const browser of ['chromium','firefox','webkit'])assert.ok(result.stdout.includes(`[${browser}]`));
   assert.deepEqual(JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE,'utf8')).errors,[]);
  }
 }finally{rmSync(root,{recursive:true});}
});
