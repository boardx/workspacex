import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertBoardCiResults,boardCiProducerFailureCode} from './board-ci-result.mjs';
const report=()=>({errors:[],suites:[{specs:[{tests:[{expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]}]}]}]});
test('only a complete first-attempt real test set can pass a CI lane',()=>assert.doesNotThrow(()=>assertBoardCiResults(report(),1)));
for(const kind of ['zero','skip','retry','expected-failure','error','missing'])test(`rejects ${kind}`,()=>{const r=report(),t=r.suites[0].specs[0].tests[0];if(kind==='zero')r.suites=[];if(kind==='skip')t.results[0].status='skipped';if(kind==='retry')t.results[0].retry=1;if(kind==='expected-failure')t.expectedStatus='failed';if(kind==='error')r.errors=[{}];if(kind==='missing')t.results=[];assert.throws(()=>assertBoardCiResults(r,1));});
test('classifies producer failures without serializing private test details',()=>{
 assert.equal(boardCiProducerFailureCode(undefined,1),'REAL_PRODUCER_NO_TESTS');
 assert.equal(boardCiProducerFailureCode({errors:[{code:'PLAYWRIGHT_ERROR'}],suites:[]},1),'REAL_PRODUCER_STARTUP_FAILED');
 const failed=report();failed.suites[0].specs[0].tests[0].results[0].status='failed';
 assert.equal(boardCiProducerFailureCode(failed,1),'REAL_PRODUCER_TEST_FAILED');
 const skipped=report();skipped.suites[0].specs[0].tests[0].results[0].status='skipped';
 assert.equal(boardCiProducerFailureCode(skipped,1),'REAL_PRODUCER_INCOMPLETE');
});
import Reporter from './board-ci-reporter.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('reporter never serializes config, credentials or error text',()=>{
 const directory=mkdtempSync(join(tmpdir(),'board-reporter-')),old=process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
 try{process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=join(directory,'result.json');const reporter=new Reporter();reporter.onTestEnd({id:'private-id',title:'TOKEN_SECRET',expectedStatus:'passed'},{status:'passed',retry:0,stdout:['TOKEN_SECRET'],error:{message:'TOKEN_SECRET'}});reporter.onEnd({status:'passed'});const text=readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,'utf8');assert.ok(!text.includes('TOKEN_SECRET'));assert.ok(!text.includes('private-id'));assertBoardCiResults(JSON.parse(text),1);}finally{if(old===undefined)delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=old;rmSync(directory,{recursive:true,force:true});}
});
test('reporter persists only named evidence bodies with verified hash descriptors',()=>{
 const directory=mkdtempSync(join(tmpdir(),'board-reporter-')),old=process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
 try{process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=join(directory,'result.json');const reporter=new Reporter();const bytes=Buffer.from('{"scenario":"durable-images"}');reporter.onTestEnd({id:'id',expectedStatus:'passed'},{status:'passed',retry:0,attachments:[{name:'storage-runtime.json',contentType:'application/json',body:bytes},{name:'stdout',contentType:'text/plain',body:Buffer.from('SECRET')}]});reporter.onEnd({status:'passed'});const report=JSON.parse(readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE));const attachments=report.suites[0].specs[0].tests[0].results[0].attachments;assert.equal(attachments.length,1);assert.deepEqual(readFileSync(attachments[0].path),bytes);assert.match(attachments[0].sha256,/^[a-f0-9]{64}$/);assert.equal(attachments[0].bytes,bytes.length);}finally{if(old===undefined)delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=old;rmSync(directory,{recursive:true,force:true});}
});
