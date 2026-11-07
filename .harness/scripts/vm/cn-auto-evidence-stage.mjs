// Fixed root bridge. Runner supplies only original signed Devapp bytes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validateEnvelope,validateDevapp} from './cn-controlled-evidence.mjs';
const ROOT='/etc/workspacex-cn/candidate-configs',MAX=16*1024*1024;
const reject=()=>{throw Error('CN_AUTO_EVIDENCE_STAGE_REJECTED');};
const hash=v=>createHash('sha256').update(v).digest('hex');
export function validateHeader(v,source,attempt){
 if(!v||Object.keys(v).sort().join()!==['schemaVersion','sourceSha','attemptId','devappParentRunId','devappParentRunAttempt','evidenceRequestId','devappBytes'].sort().join()||v.schemaVersion!==1||v.sourceSha!==source||v.attemptId!==attempt||!/^([a-f0-9]{40})$/.test(source??'')||!/^gha-[0-9]+-[0-9]+$/.test(attempt??'')||![v.devappParentRunId,v.devappParentRunAttempt].every(n=>Number.isSafeInteger(n)&&n>0)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.evidenceRequestId??'')||!Number.isSafeInteger(v.devappBytes)||v.devappBytes<1||v.devappBytes>MAX)reject();return v;
}
export async function readFrame(input,source,attempt){
 let headerBytes=Buffer.alloc(0),header,body,size=0;
 for await(const chunk of input){let bytes=Buffer.from(chunk);if(!header){const at=bytes.indexOf(10);if(at<0){headerBytes=Buffer.concat([headerBytes,bytes]);if(headerBytes.length>18432)reject();continue;}headerBytes=Buffer.concat([headerBytes,bytes.subarray(0,at)]);if(headerBytes.length>18432)reject();header=validateHeader(JSON.parse(headerBytes.toString('utf8')),source,attempt);bytes=bytes.subarray(at+1);}
  body??=Buffer.allocUnsafe(header.devappBytes);if(size+bytes.length>header.devappBytes)reject();bytes.copy(body,size);size+=bytes.length;
 }if(!header||size!==header.devappBytes)reject();return {header,bytes:body};
}
function directory(target,{uid,gid,boundary,privateLeaf=true}){
 for(let current=target;;current=path.dirname(current)){const s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||s.gid!==gid||(s.mode&0o022))reject();if(current===boundary)break;if(path.dirname(current)===current)reject();}
 const s=fs.lstatSync(target);if(privateLeaf&&(s.mode&0o777)!==0o700)reject();
}
function readPrivate(file,options){directory(path.dirname(file),{...options,privateLeaf:false});const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==options.uid||s.gid!==options.gid||(s.mode&0o777)!==0o600||s.nlink!==1||s.size>MAX)reject();return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export async function stageEvidence(header,bytes,{root=ROOT,uid=0,gid=0,boundary='/',keys,signal,now=Date.now}={}){
 validateHeader(header,header.sourceSha,header.attemptId);if(bytes.length!==header.devappBytes)reject();const options={uid,gid,boundary};directory(root,options);
 const devKey=keys?.devapp??readPrivate('/etc/workspacex-cn/devapp-evidence-public.pem',options);
 const check=()=>{if(signal?.aborted)reject();};check();
 const envelope=validateEnvelope(JSON.parse(bytes),devKey,header.sourceSha,header.attemptId,'devapp',now());
 const acceptance={...validateDevapp(envelope.raw,header.sourceSha),evidenceSha256:hash(bytes)},c=envelope.raw.coordination;
 if(!c||c.source!==header.sourceSha||c.attempt!==header.attemptId||c.parentId!==header.devappParentRunId||c.parentAttempt!==header.devappParentRunAttempt||c.parentRequestId!==header.evidenceRequestId||c.runId!==acceptance.workflowRunId||c.runAttempt!==acceptance.workflowRunAttempt)reject();
 // Yield before persistence so pending cancellation remains observable.
 await Promise.resolve();check();
 // Never extend the original signed expiry window.
 validateEnvelope(JSON.parse(bytes),devKey,header.sourceSha,header.attemptId,'devapp',now());
 const shaDir=path.join(root,header.sourceSha),target=path.join(shaDir,header.attemptId);
 for(const dir of [shaDir,target]){try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}directory(dir,options);}
 const records={'devapp-evidence.bin':bytes,'devapp-acceptance.json':Buffer.from(JSON.stringify(acceptance)+'\n')};
 for(const name of Object.keys(records)){try{fs.lstatSync(path.join(target,name));reject();}catch(e){if(e.code!=='ENOENT')throw e;}}
 let temporary;const published=[];
 try{
  temporary=fs.mkdtempSync(path.join(target,'.evidence-stage-'));fs.chmodSync(temporary,0o700);
  for(const [name,raw] of Object.entries(records)){check();const fd=fs.openSync(path.join(temporary,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  check();for(const name of Object.keys(records)){const from=path.join(temporary,name),to=path.join(target,name);fs.linkSync(from,to);published.push(to);fs.unlinkSync(from);}
  const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.rmdirSync(temporary);temporary=undefined;
  return {sourceSha:header.sourceSha,attemptId:header.attemptId,devappEvidenceSha256:hash(bytes)};
 }catch(e){for(const file of published)fs.unlinkSync(file);throw e;}finally{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});}
}
export async function main(){
 const [source,attempt,...extra]=process.argv.slice(2);if(process.getuid?.()!==0||process.getgid?.()!==0||process.platform!=='linux'||extra.length)reject();
 execFileSync('/usr/bin/python3',['-I','-B','-c',LOCK_PROOF],{stdio:['ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore',9]});
 execFileSync('/usr/bin/python3',['-I','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','admit','/var/lib/workspacex-cn/runtime'],{stdio:['ignore','ignore','ignore']});
 const controller=new AbortController();for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>{controller.abort();if(!process.stdin.readableEnded)process.stdin.destroy(Error('CN_AUTO_EVIDENCE_STAGE_REJECTED'));});
 const timer=setTimeout(()=>{controller.abort();process.stdin.destroy(Error('CN_AUTO_EVIDENCE_STAGE_REJECTED'));},30000);
 let frame;try{frame=await readFrame(process.stdin,source,attempt);}finally{clearTimeout(timer);}
 await stageEvidence(frame.header,frame.bytes,{signal:controller.signal});console.log('CN_AUTO_EVIDENCE_STAGED');
}
export const LOCK_PROOF=String.raw`import os,stat,re
p='/var/lib/workspacex-cn/runtime/release.lock'
s=os.fstat(9);t=os.lstat(p)
assert os.readlink('/proc/self/fd/9')==p and stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,0,0o600,1) and (s.st_dev,s.st_ino)==(t.st_dev,t.st_ino)
assert re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+-?\d+\s+[0-9a-fA-F]+:[0-9a-fA-F]+:'+str(s.st_ino)+r'\s+0\s+EOF$',open('/proc/self/fdinfo/9').read(),re.M)
`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('CN_AUTO_EVIDENCE_STAGE_NOT_READY');process.exit(3);});
