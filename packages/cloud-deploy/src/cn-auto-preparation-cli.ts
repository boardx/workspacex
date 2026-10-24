/** Root-only composition bridge. Actual operations run through the fixed Python
 * dispatcher; absent policy/provider is NOT_READY, never a prepared receipt. */
import { constants } from 'node:fs';
import { open,readlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { renderAutoIsolated } from './cn-auto-preparation-render';
import { assertTrustedPath } from './trusted-path';
import { produceAutoPreparation,autoEvidenceHash } from './cn-auto-preparation';
import { autoIdentitySchema,type AutoPreparationActions,type ProtectedRaw,type StageRequest } from './cn-auto-preparation-protocol';
import {PreparationProcesses} from './cn-auto-preparation-process';
const processes=new PreparationProcesses();
let lastRequest:StageRequest|undefined,cleanupSucceeded=false;
async function protectedRead(path:string) {
 await assertTrustedPath(path,{trustedRoot:'/',kind:'file',private:true});
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const before=await fd.stat();if(!before.isFile()||before.nlink!==1||before.size>16*1024*1024)throw new Error();const bytes=await fd.readFile();const after=await fd.stat();if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error();return bytes;}finally{await fd.close();}
}
async function artifact(ref:{path:string;sha256:string}):Promise<ProtectedRaw>{
 if(!/^\/(?:etc|var\/lib)\/workspacex-cn\//.test(ref.path)||ref.path.slice(1).split('/').some(v=>!v||v==='.'||v==='..'))throw new Error();
 const bytes=await protectedRead(ref.path);if(autoEvidenceHash(bytes)!==ref.sha256)throw new Error();return {...ref,bytes};
}
async function stage(name:string,request:StageRequest){
 if(name!=='cleanupIsolated')processes.check();
 lastRequest=request;
 const driver='/usr/local/lib/workspacex-cn/cn_auto_prepare.py';
 await assertTrustedPath(driver,{trustedRoot:'/',kind:'file'});
 const raw=await new Promise<Buffer>((resolve,reject)=>{
  // The release-lock descriptor remains FD9 through both process boundaries.
  const child=spawn('/usr/bin/python3',['-I','-S','-B',driver,'--stage',name],{stdio:['pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore',9],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent'},detached:true});
  processes.track(child,name==='cleanupIsolated');
  const chunks:Buffer[]=[];let size=0,invalid=false;
  const timer=setTimeout(()=>{invalid=true;try{process.kill(-child.pid!,'SIGTERM');}catch{}},1810000);
  child.stdout!.on('data',(v:Buffer)=>{size+=v.length;if(size>65536){invalid=true;try{process.kill(-child.pid!,'SIGTERM');}catch{}}else chunks.push(v);});
  child.once('error',()=>{clearTimeout(timer);reject(new Error('CN_AUTO_DRIVER_UNAVAILABLE'));});
  child.once('close',code=>{clearTimeout(timer);if(code!==0||invalid)reject(new Error('CN_AUTO_DRIVER_NOT_READY'));else resolve(Buffer.concat(chunks));});
  child.stdin!.on('error',()=>{});child.stdin!.end(JSON.stringify(request));
 });
 const result=await artifact(JSON.parse(raw.toString('utf8')));
 if(name==='cleanupIsolated')cleanupSucceeded=true;
 else processes.check();
 return result;
}
async function collectPreactivate(identity:StageRequest['identity']){
 for(const name of ['collect-cn-release-preflight.sh','verify-cn-release-preflight.sh']){
  processes.check();
  const script='/usr/local/lib/workspacex-cn/'+name;
  await assertTrustedPath(script,{trustedRoot:'/',kind:'file'});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn('/usr/bin/bash',[script,'preactivate',identity.sourceRevision,identity.release,identity.attemptId],{stdio:['ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore',9],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent'},detached:true});
   processes.track(child);
   const timer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGTERM');}catch{}},1800000);
   child.once('error',()=>{clearTimeout(timer);reject(new Error('CN_AUTO_PREFLIGHT_UNAVAILABLE'));});
   child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('CN_AUTO_PREFLIGHT_REJECTED'));});
  });
 }
 const root=`/var/lib/workspacex-cn/preflight-receipts/${identity.sourceRevision}/${identity.attemptId}`;
 const read=async(path:string)=>{const bytes=await protectedRead(path);return {path,bytes,sha256:autoEvidenceHash(bytes)};};
 return {evidence:await read(root+'/preactivate.json'),validation:await read(root+'/preactivate.validated.json')};
}
async function exclusive(path:string,bytes:Uint8Array){
 await assertTrustedPath(dirname(path),{trustedRoot:'/',kind:'directory',private:true});
 const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
try{
 if(process.argv[2]==='--render-isolated'){
  if(process.getuid?.()!==0||process.getgid?.()!==0||process.platform!=='linux'||process.argv.length!==3)throw new Error();
  const chunks:Buffer[]=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>65536)throw new Error();chunks.push(Buffer.from(chunk));}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const identity=autoIdentitySchema.parse(payload.request.identity);
  const directory=`/var/lib/workspacex-cn/auto-preparation/${identity.sourceRevision}/${identity.attemptId}/runtime`;
  await assertTrustedPath(dirname(directory),{trustedRoot:'/',kind:'directory',private:true});
  process.stdout.write(JSON.stringify(await renderAutoIsolated(payload.request,payload.policy,payload.state,directory))+'\n');
  process.exit(0);
 }
 const [sha,attempt,...extra]=process.argv.slice(2);
 processes.install();processes.check();
 if(process.getuid?.()!==0||process.getgid?.()!==0||process.platform!=='linux'||extra.length||!/^[a-f0-9]{40}$/.test(sha??'')||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(attempt??''))throw new Error();
 if(await readlink('/proc/self/fd/9')!=='/var/lib/workspacex-cn/runtime/release.lock')throw new Error();
 const request=JSON.parse((await protectedRead(`/etc/workspacex-cn/auto-preparation-requests/${sha}/${attempt}.json`)).toString('utf8'));
 const identity=autoIdentitySchema.parse(request.identity);if(identity.sourceRevision!==sha||identity.attemptId!==attempt)throw new Error();
 const pf=async(v:any)=>({evidence:await artifact(v.evidence),validation:await artifact(v.validation)});
 const input={identity,manifest:await artifact(request.manifest),seal:await artifact(request.seal),migrationPlan:await artifact(request.migrationPlan),prebuild:await pf(request.prebuild),preactivate:request.preactivate?await pf(request.preactivate):undefined};
 const actions:AutoPreparationActions={backup:v=>stage('backup',v),restoreIsolated:v=>stage('restoreIsolated',v),shadowReadiness:v=>stage('shadowReadiness',v),shadowBusiness:v=>stage('shadowBusiness',v),cleanupIsolated:v=>stage('cleanupIsolated',v)};
 actions.collectPreactivate=()=>collectPreactivate(identity);
 const result=await produceAutoPreparation(input,actions);
 processes.check();
 const evidencePath=`/var/lib/workspacex-cn/auto-preparation/${sha}/${attempt}/index.json`;
 await exclusive(evidencePath,result.indexBytes);
 processes.check();
 await exclusive(`/etc/workspacex-cn/preparations/${sha}.json`,Buffer.from(JSON.stringify(result.receipt)+'\n'));
 processes.check();
 process.stdout.write(JSON.stringify({status:'prepared',sourceRevision:sha,attemptId:attempt,evidencePath,evidenceSha256:result.indexSha256})+'\n');
}catch{
 await processes.stop();
 if(lastRequest&&!cleanupSucceeded){try{await stage('cleanupIsolated',lastRequest);}catch{process.stderr.write('CN_AUTO_PREPARATION_CLEANUP_UNPROVEN\n');}}
 process.stderr.write('CN_AUTO_PREPARATION_NOT_READY\n');process.exitCode=3;
}finally{processes.dispose();}
