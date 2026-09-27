import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertBoardCiResults} from './board-ci-result.mjs';
const report=()=>({errors:[],suites:[{specs:[{tests:[{expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]}]}]}]});
test('only a complete first-attempt real test set can pass a CI lane',()=>assert.doesNotThrow(()=>assertBoardCiResults(report(),1)));
for(const kind of ['zero','skip','retry','expected-failure','error','missing'])test(`rejects ${kind}`,()=>{const r=report(),t=r.suites[0].specs[0].tests[0];if(kind==='zero')r.suites=[];if(kind==='skip')t.results[0].status='skipped';if(kind==='retry')t.results[0].retry=1;if(kind==='expected-failure')t.expectedStatus='failed';if(kind==='error')r.errors=[{}];if(kind==='missing')t.results=[];assert.throws(()=>assertBoardCiResults(r,1));});
import Reporter from './board-ci-reporter.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('reporter never serializes config, credentials or error text',()=>{
 const directory=mkdtempSync(join(tmpdir(),'board-reporter-')),old=process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
 try{process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=join(directory,'result.json');const reporter=new Reporter();reporter.onTestEnd({id:'private-id',title:'TOKEN_SECRET',expectedStatus:'passed'},{status:'passed',retry:0,stdout:['TOKEN_SECRET'],error:{message:'TOKEN_SECRET'}});reporter.onEnd({status:'passed'});const text=readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,'utf8');assert.ok(!text.includes('TOKEN_SECRET'));assert.ok(!text.includes('private-id'));assertBoardCiResults(JSON.parse(text),1);}finally{if(old===undefined)delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=old;rmSync(directory,{recursive:true,force:true});}
});
