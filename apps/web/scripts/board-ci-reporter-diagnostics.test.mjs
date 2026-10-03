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
