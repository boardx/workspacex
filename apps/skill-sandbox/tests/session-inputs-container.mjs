// Execute inside the independently tagged hardened sessions container, against its real UDS server.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire('/opt/sandbox/package.json');
const {Document,Packer,Paragraph}=require('docx');
const original=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('原始文档保持不变')]}]}));
const files=[{path:'/inputs/original.docx',contentBase64:original.toString('base64')},{path:'/inputs/original.csv',contentBase64:Buffer.from('group,value\n甲,10\n乙,40\n').toString('base64')}];
assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'1073741824');
assert.equal(readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'128');
async function call(method,path,body,token){return new Promise((resolve,reject)=>{
 const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
 let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
const created=await call('POST','/sessions',{inputs:files});assert.equal(created.status,201);const {sessionId,token}=created.body,prefix=`/sessions/${sessionId}`;
try{
 for(const file of files)assert.equal((await call('POST',`${prefix}/files`,{...file,contentBase64:''},token)).status,400);
 const script=`import csv,zipfile,shutil,hashlib,json
paths=['/inputs/original.docx','/inputs/original.csv']
before={p:hashlib.sha256(open(p,'rb').read()).hexdigest() for p in paths}
for p in paths:
 for op in (lambda:open(p,'wb'),lambda:__import__('os').unlink(p)):
  try:op();raise AssertionError('original modified')
  except OSError:pass
 shutil.copyfile(p,p.replace('/inputs/','/workspace/'))
with zipfile.ZipFile('/workspace/original.docx') as z:assert '原始文档保持不变' in z.read('word/document.xml').decode()
with open('/workspace/original.csv') as f:assert sum(int(r['value']) for r in csv.DictReader(f))==50
open('/workspace/original.csv','a').write('丙,3\\n')
assert before=={p:hashlib.sha256(open(p,'rb').read()).hexdigest() for p in paths}
print('READ_ONLY_DOCX_CSV_ORIGINALS_VERIFIED',json.dumps(before))`;
 assert.equal((await call('POST',`${prefix}/files`,{path:'/workspace/check.py',contentBase64:Buffer.from(script).toString('base64')},token)).status,200);
 const result=await call('POST',`${prefix}/executions`,{executionId:randomUUID(),command:'python3 /workspace/check.py',timeoutMs:10000},token);
 assert.equal(result.status,200);assert.equal(result.body.exitCode,0,JSON.stringify(result));assert.match(result.body.output,/READ_ONLY_DOCX_CSV_ORIGINALS_VERIFIED/);
 for(const file of files){const after=await call('GET',`${prefix}/files?path=${encodeURIComponent(file.path)}`,undefined,token);assert.equal(after.status,200);assert.equal(after.body.contentBase64,file.contentBase64);}
 console.log(result.body.output.trim());console.log('INPUTS_UID',process.getuid(),'DOCX_SHA256',createHash('sha256').update(original).digest('hex'));
}finally{assert.equal((await call('DELETE',prefix,undefined,token)).status,200);}
