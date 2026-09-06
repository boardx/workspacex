// Inject globalThis.analysisFixture from data-workflows-fixture.py before this script.
// Runs inside the hardened sessions container; talks to its actual UDS service.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'1073741824');
assert.equal(readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'128');
assert.equal(process.getuid(),1000);

const startup=Date.now();
const service=spawn(process.execPath,['/opt/sandbox/dist/main.js'],{stdio:'inherit'});
const stopped=new Promise(resolve=>service.once('exit',resolve));
async function call(method,path,body,token){return new Promise((resolve,reject)=>{
 const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
 let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
let session;
try{
 for(let i=0;i<100;i++){try{if((await call('GET','/healthz')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,20));}
 console.log('SERVICE_READY_MS',Date.now()-startup);
 const made=await call('POST','/sessions',{});assert.equal(made.status,201);session=made.body;
 const prefix=`/sessions/${session.sessionId}`;
 const upload=async(path,content)=>assert.equal((await call('POST',`${prefix}/files`,{path,contentBase64:Buffer.from(content).toString('base64')},session.token)).status,200);
 await upload('/workspace/analyze.py',globalThis.analysisFixture);
 const rows=[{id:1,group:'甲',value:10},{id:2,group:'甲',value:null},{id:3,group:'乙',value:20},{id:3,group:'乙',value:20},{id:4,group:'乙',value:'bad'},{id:5,group:'甲',value:0}];
 await upload('/workspace/input.json',JSON.stringify(rows));
 await upload('/workspace/input.csv','id,group,value\n1,甲,10\n2,甲,\n3,乙,20\n3,乙,20\n4,乙,bad\n5,甲,0\n');
 await upload('/workspace/create.cjs',`const ExcelJS=require('exceljs');(async()=>{const w=new ExcelJS.Workbook();const s=w.addWorksheet('Data');s.columns=[{header:'id',key:'id'},{header:'group',key:'group'},{header:'value',key:'value'}];s.addRows(${JSON.stringify(rows)});await w.xlsx.writeFile('/workspace/input.xlsx');})();`);
 const run=async(command)=>{
 const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command,timeoutMs:120000},session.token);
 assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result.body));return result.body.output;
 };
 await upload('/workspace/bad.csv','wrong\n1\n');
 const bad=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:'cp /workspace/input.csv /workspace/valid.csv && cp /workspace/bad.csv /workspace/input.csv && python3 /workspace/analyze.py',timeoutMs:120000},session.token);
 assert.equal(bad.status,200);assert.notEqual(bad.body.exitCode,0);assert.doesNotMatch(bad.body.output,/OFFLINE_THREE_FORMATS/);
 const absent=await call('GET',`${prefix}/files?path=/workspace/results.json`,undefined,session.token);assert.notEqual(absent.status,200);
 await run('cp /workspace/valid.csv /workspace/input.csv');
 console.log('INVALID_INPUT_NO_RESULT_FILE');
 const output=await run('test ! -e /proc/version && test ! -e /etc/passwd && node /workspace/create.cjs && python3 /workspace/analyze.py && cp /workspace/results.json /workspace/first-results.json && python3 /workspace/analyze.py && cmp /workspace/first-results.json /workspace/results.json && pdftotext /workspace/chart.pdf - && pdftoppm -png -singlefile -r 120 /workspace/chart.pdf /workspace/chart-page');
 assert.match(output,/分组金额/);assert.match(output,/XML_ENTITY_REJECTED/);assert.doesNotMatch(output,/Syntax Warning|Fontconfig error/);console.log(output);
 for(const path of ['chart.png','chart.pdf','chart-page.png','results.json','results.csv']){
 const file=await call('GET',`${prefix}/files?path=/workspace/${path}`,undefined,session.token);
 assert.equal(file.status,200);assert.ok(file.body.sizeBytes>0);console.log('ARTIFACT_BASE64',path,file.body.contentBase64);
 }
 for(const metric of ['memory.peak','pids.peak'])if(existsSync('/sys/fs/cgroup/'+metric))console.log(metric,readFileSync('/sys/fs/cgroup/'+metric,'utf8').trim());
 console.log('W18_OFFLINE_ANALYSIS_AND_REAL_CHINESE_CHART_OK');
}finally{if(session)await call('DELETE',`/sessions/${session.sessionId}`,undefined,session.token);service.kill('SIGTERM');await stopped;}
