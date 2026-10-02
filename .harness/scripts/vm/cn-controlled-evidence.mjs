// Separate operator lane. Never invoked with the promotion workflow token.
// Root-owned signing key / pinned verification key are provisioned by humans.
import { createHash, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectMixedRuntime } from './devapp-runtime-identity.mjs';
const services=['api','web','agent','sandbox'];
const sha=/^[a-f0-9]{40}$/;
const fail=code=>{throw new Error(code)};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function evidenceWindow(clock=Date.now) {
 const observed=clock();
 return {observedAt:new Date(observed).toISOString(),expiresAt:new Date(observed+3600000).toISOString()};
}
export function protectedRead(file) {
 const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o600)fail('CONTROLLED_FILE_NOT_PRIVATE');
 return readFileSync(file);
}
export function validateEnvelope(envelope,publicKey,source,attempt,kind,now=Date.now()) {
 const bytes=Buffer.from(envelope.payload??'', 'base64');
 if(!verify(null,bytes,publicKey,Buffer.from(envelope.signature??'','base64')))fail('CONTROLLED_SIGNATURE');
 const value=JSON.parse(bytes);
 if(value.schemaVersion!==1||value.kind!==kind||value.repository!=='boardx/workspacex'||value.sourceSha!==source||value.attemptId!==attempt||!sha.test(source)||!Number.isFinite(Date.parse(value.observedAt))||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.observedAt)>now||Date.parse(value.expiresAt)<=now||Date.parse(value.expiresAt)-Date.parse(value.observedAt)>3600000)fail('CONTROLLED_BINDING_OR_TTL');
 return value;
}
export function validateDevapp(raw,source) {
 const r=raw.run,b=raw.browser;
 if(r?.repository?.full_name!=='boardx/workspacex'||r.head_repository?.full_name!=='boardx/workspacex'||r.path!=='.github/workflows/real-model-chat-evidence.yml'||r.head_sha!==source||r.status!=='completed'||r.conclusion!=='success'||!Number.isSafeInteger(r.id)||r.id<=0||!Number.isSafeInteger(r.run_attempt)||r.run_attempt<=0||!Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.run_started_at)))fail('CONTROLLED_DEVAPP_RUN');
 if(b?.context?.lane!=='devapp'||b.context.baseUrl!=='https://devapp.boardx.us'||!b.context.threadId||String(b.context.threadId).startsWith('<')||!Number.isFinite(Date.parse(b.context.generatedAt))||Date.parse(b.context.generatedAt)<Date.parse(r.run_started_at)||b.context.runStartObserved!==true||!Array.isArray(b.assertions)||b.assertions.length<8||b.assertions.some(a=>a.ok!==true)||![1,2,3,4,5,6,7,8].every(n=>b.assertions.some(a=>a.name.startsWith('①②③④⑤⑥⑦⑧'[n-1])))||!Array.isArray(b.pageErrors)||b.pageErrors.length)fail('CONTROLLED_DEVAPP_BROWSER');
 if(!raw.artifact||raw.artifact.workflow_run?.id!==r.id||raw.artifact.workflow_run?.head_sha!==source||raw.artifact.name!=='real-model-chat-evidence'||raw.artifact.expired!==false||!Number.isFinite(Date.parse(raw.artifact.created_at))||Date.parse(raw.artifact.created_at)<Date.parse(b.context.generatedAt)||raw.artifact.digest!=='sha256:'+digest(Buffer.from(raw.archive,'base64')))fail('CONTROLLED_DEVAPP_ARTIFACT');
 for(const k of services){const v=raw.runtime?.[k];const identity=v?.kind==='systemd'&&['api','web'].includes(k)?/^\d+$/.test(v.startTicks??'')&&Number.isSafeInteger(v.pid)&&v.pid>0&&/^[a-f0-9]{32}$/.test(v.invocationId??'')&&/^[a-f0-9]{64}$/.test(v.artifactSha256??'')&&/^[a-f0-9]{64}$/.test(v.executableSha256??'')&&!!v.bootId&&!!v.cwd&&!!v.unit&&Array.isArray(v.applicationProcesses)&&v.applicationProcesses.length>0&&v.applicationProcesses.every(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&/^[a-f0-9]{64}$/.test(p.executableSha256??'')&&Number.isFinite(Date.parse(p.startedAtUpperBound))&&Date.parse(p.startedAtUpperBound)<=Date.parse(r.run_started_at)):/^sha256:[a-f0-9]{64}$/.test(v?.imageId??'')&&!!v?.containerId;
  if(!v||v.running!==true||v.sourceSha!==source||!identity||!Number.isFinite(Date.parse(v.startedAt))||Date.parse(v.startedAt)>Date.parse(r.run_started_at))fail('CONTROLLED_DEVAPP_RUNTIME');}
 if(services.some(k=>raw.runtime[k]?.kind==='systemd')) {
  const v=raw.runtime.sandbox?.relatedContainers?.sessions;
  if(!v||v.kind!=='docker'||v.running!==true||v.sourceSha!==source||!/^sha256:[a-f0-9]{64}$/.test(v.imageId??'')||!v.containerId||!Number.isFinite(Date.parse(v.startedAt))||Date.parse(v.startedAt)>Date.parse(r.run_started_at))fail('CONTROLLED_DEVAPP_RUNTIME');
 }
 return {status:'passed',sourceSha:source,runtimeSourceShas:Object.fromEntries(services.map(k=>[k,raw.runtime[k].sourceSha])),browserAccepted:true,workflowRunId:r.id,workflowRunAttempt:r.run_attempt};
}
function api(endpoint){return JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}));}
function pages(endpoint,key){const all=[];for(let p=1;p<=100;p++){const v=api(endpoint+(endpoint.includes('?')?'&':'?')+'per_page=100&page='+p),rows=key?v[key]:v;if(!Array.isArray(rows))fail('CONTROLLED_API_SHAPE');all.push(...rows);if(rows.length<100){if(key&&v.total_count!==all.length)fail('CONTROLLED_PAGINATION');return all;}}fail('CONTROLLED_PAGINATION');}
export function collectGovernance(read=api,list=pages) {
 const p='repos/boardx/workspacex';
 const summary=list(p+'/rulesets?includes_parents=true');
 // Parent rules must be read from their owning organization, never a repository ID guess.
 const tagRules=summary.filter(v=>v.target==='tag'&&v.enforcement==='active').map(v=>{
  if(!Number.isSafeInteger(v.id)||v.id<=0)fail('CONTROLLED_RULE_OWNER');
  const endpoint=v.source_type==='Repository'&&v.source==='boardx/workspacex'?p+'/rulesets/'+v.id:v.source_type==='Organization'&&v.source==='boardx'?'orgs/boardx/rulesets/'+v.id:null;
  if(!endpoint)fail('CONTROLLED_RULE_OWNER');
  const rule=read(endpoint);if(!Array.isArray(rule.bypass_actors))fail('CONTROLLED_RULE_WRITE_VISIBILITY_REQUIRED');return rule;
 });
 return {promotion:read(p+'/environments/production-cn-promotion'),promotionPolicies:list(p+'/environments/production-cn-promotion/deployment-branch-policies','branch_policies'),activation:read(p+'/environments/production-cn'),activationPolicies:list(p+'/environments/production-cn/deployment-branch-policies','branch_policies'),tagRules};
}
export function collectDevapp(runId,source,ports={api,pages,exec:execFileSync,protectedRead}) {
 if(!Number.isSafeInteger(runId)||runId<=0)fail('CONTROLLED_DEVAPP_RUN');
 const {api:read,pages:list,exec:execute,protectedRead:privateRead}=ports;
 const p='repos/boardx/workspacex',run=read(p+'/actions/runs/'+runId);
 const artifacts=list(p+'/actions/runs/'+runId+'/artifacts','artifacts').filter(a=>a.name==='real-model-chat-evidence'&&!a.expired);
 if(artifacts.length!==1)fail('CONTROLLED_ARTIFACT_AMBIGUOUS');
 const artifact=artifacts[0],dir=mkdtempSync(join(tmpdir(),'cn-devapp-evidence-'));
 try {
  const archive=execute('gh',['api',p+'/actions/artifacts/'+artifact.id+'/zip'],{timeout:30000,maxBuffer:128*1024*1024});
  const zip=join(dir,'evidence.zip');writeFileSync(zip,archive,{mode:0o600});
  // Extract only known JSON entries to stdout, never unpack attacker-controlled paths.
  const json=name=>JSON.parse(execute('unzip',['-p',zip,name],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000}));
  const browser={context:json('00-context.json'),assertions:json('10-assertions.json'),pageErrors:json('21-page-errors.json')};
  const config=JSON.parse(privateRead('/etc/workspacex-devapp/runtime-evidence.json'));
  let runtime={};
  if(config.schemaVersion===2){
   if(typeof config.receiptPath!=='string'||!/^\/etc\/workspacex-devapp\/runtime-[a-f0-9]{40}-[a-f0-9-]{36}\.json$/.test(config.receiptPath))fail('CONTROLLED_RUNTIME_RECEIPT_PATH');
   runtime=collectMixedRuntime(JSON.parse(privateRead(config.receiptPath)),source,{run:(bin,args)=>execute(bin,args,{encoding:'utf8',timeout:30000}),fs:ports.fs??undefined,artifactDigest:ports.artifactDigest??undefined});
  } else for(const k of services){const name=config.containers?.[k];if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))fail('CONTROLLED_RUNTIME_CONFIG_REQUIRED');
   const v=JSON.parse(execute('docker',['inspect',name],{encoding:'utf8',timeout:30000}))[0];
   const image=JSON.parse(execute('docker',['image','inspect',v.Image],{encoding:'utf8',timeout:30000}))[0];
   runtime[k]={containerId:v.Id,imageId:v.Image,running:v.State.Running,startedAt:v.State.StartedAt,sourceSha:image.Config.Labels?.['org.opencontainers.image.revision']};
  }
  const raw={run,artifact,archive:archive.toString('base64'),browser,runtime};validateDevapp(raw,source);return raw;
 } finally {rmSync(dir,{recursive:true,force:true});}
}
async function main(){
 const [kind,source,attempt,output,runId]=process.argv.slice(2);
 if(process.getuid?.()!==0||!['governance','devapp','stage-devapp'].includes(kind)||!sha.test(source??'')||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(attempt??''))fail('CONTROLLED_INPUT');
 if(kind==='stage-devapp'){
  const bytes=protectedRead(output),envelope=JSON.parse(bytes);
  const value=validateEnvelope(envelope,protectedRead('/etc/workspacex-cn/devapp-evidence-public.pem'),source,attempt,'devapp');
  const acceptance={...validateDevapp(value.raw,source),evidenceSha256:digest(bytes)};
  const dir='/etc/workspacex-cn/candidate-configs/'+source+'/'+attempt;
  const state=lstatSync(dir);if(!state.isDirectory()||state.isSymbolicLink()||state.uid!==0||state.gid!==0||(state.mode&0o777)!==0o700)fail('CONTROLLED_STAGE_DIRECTORY');
  writeFileSync(join(dir,'devapp-evidence.bin'),bytes,{mode:0o600,flag:'wx'});
  writeFileSync(join(dir,'devapp-acceptance.json'),JSON.stringify(acceptance),{mode:0o600,flag:'wx'});
  console.log('CN_CONTROLLED_DEVAPP_STAGED');return;
 }
 // Credentials supplied only to this separately reviewed operator process; never serialized.
 const data=kind==='governance'?{governance:collectGovernance()}:{raw:collectDevapp(Number(runId),source)};
 const {observedAt,expiresAt}=evidenceWindow();
 const payload=Buffer.from(JSON.stringify({schemaVersion:1,kind,repository:'boardx/workspacex',sourceSha:source,attemptId:attempt,observedAt,expiresAt,...data}));
 const key=protectedRead(kind==='governance'?'/etc/workspacex-cn/governance-signing.pem':'/etc/workspacex-devapp/evidence-signing.pem');
 writeFileSync(output,JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')}),{mode:0o600,flag:'wx'});
 console.log('CN_CONTROLLED_EVIDENCE_COLLECTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('CN_CONTROLLED_EVIDENCE_NOT_READY');process.exitCode=3;});
