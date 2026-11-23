/** ENTRY-01 is a bounded checkpoint inside the existing writer, never a second account/session/run. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
export const ENTRY01_MAX_MS=8*60*1000;
export const ENTRY01_SCREEN_NAMES=Object.freeze(['00-created-six-stage-overview.png','00-created-reentry-overview.png']);
const PROJECT=/^prj-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new ProbeFailure(code);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function createEntryClock({now=Date.now,tick=()=>performance.now()}={}){
  const startedAt=new Date(now()).toISOString(),start=tick();let completed=false;
  const check=()=>{const elapsed=tick()-start;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>ENTRY01_MAX_MS)fail('ENTRY01_EIGHT_MINUTE_DEADLINE');return Math.round(elapsed);};
  return Object.freeze({check,failed:code=>({status:'FAILED',startedAt,finishedAt:new Date(now()).toISOString(),durationMs:Math.max(0,Math.round(tick()-start)),maximumMs:ENTRY01_MAX_MS,code:/^[A-Z0-9_]{1,90}$/.test(code??'')?code:'ENTRY01_NOT_COMPLETED'}),complete(){if(completed)fail('ENTRY01_CLOCK_ALREADY_COMPLETED');const durationMs=check();completed=true;return {status:'PASSED',startedAt,finishedAt:new Date(now()).toISOString(),durationMs,maximumMs:ENTRY01_MAX_MS};}});
}
export function assertEntryGeometry(value){
  if(!exact(value,['x','y','width','height','viewportWidth','viewportHeight','workspaceScrollWidth','workspaceClientWidth'])||Object.values(value).some(n=>!Number.isFinite(n))||value.viewportWidth<320||value.viewportHeight<240||Math.abs(value.x)>1||Math.abs(value.y)>1||Math.abs(value.width-value.viewportWidth)>2||Math.abs(value.height-value.viewportHeight)>2||value.workspaceClientWidth<1||value.workspaceScrollWidth>value.workspaceClientWidth+1)fail('ENTRY01_FULLSCREEN_OR_OVERFLOW_REQUIRED');return true;
}
/** Real normal UI read; no CSS class assertion stands in for the viewport measurement. */
export async function verifyEntryWorkspace({page,expect,origin,projectId,clock}){
  clock.check();const url=new URL(page.url());if(!PROJECT.test(projectId??'')||url.origin!==origin||url.pathname!==`/aidt/${projectId}`||url.search||url.hash||url.username||url.password)fail('ENTRY01_SAME_PROJECT_ROUTE_REQUIRED');
  const workspace=page.getByTestId('aidt-project-workspace');await expect(workspace).toBeVisible();await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
  for(let n=1;n<=6;n++){clock.check();const card=page.getByTestId(`aidt-step-${n}`);await expect(card).toHaveCount(1);await expect(card).toBeVisible();const href=new URL(await card.getAttribute('href'),origin);if(href.origin!==origin||href.pathname!==url.pathname||href.searchParams.get('step')!==String(n))fail('ENTRY01_SIX_STAGE_LINK_SCOPE_REQUIRED');}
  await expect(page.getByTestId('shell-rail')).toHaveCount(0);await expect(page.getByTestId('shell-main')).toBeVisible();
  const geometry=await page.getByTestId('app-shell').evaluate(shell=>{const r=shell.getBoundingClientRect(),workspace=document.querySelector('[data-testid="aidt-project-workspace"]');return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,workspaceScrollWidth:workspace?.scrollWidth??0,workspaceClientWidth:workspace?.clientWidth??0};});assertEntryGeometry(geometry);clock.check();
  return {projectId,overview:true,sixStages:[1,2,3,4,5,6],fullscreen:true,railAbsent:true,geometry};
}
function checkIdentity(identity){if(!identity||!SHA.test(identity.source??'')||!SHA.test(identity.controlSource??'')||!/^[1-9]\d*-[1-9]\d*$/.test(identity.tag??'')||!/^[1-9]\d*$/.test(identity.run??'')||!/^[1-9]\d*$/.test(identity.attempt??''))fail('ENTRY01_VERSION_BINDING_REQUIRED');}
function checkOutput(out){const value=lstatSync(out);if(!value.isDirectory()||value.isSymbolicLink()||(value.mode&0o777)!==0o700||value.uid!==process.getuid()||realpathSync(out)!==resolve(out))fail('ENTRY01_PRIVATE_OUTPUT_REQUIRED');}
function checkedScreen(out,receipt,index){
  const name=ENTRY01_SCREEN_NAMES[index];if(!receipt||receipt.filename!==name||receipt.region!=='workspace'||receipt.stage!==null||!HEX.test(receipt.sha256??'')||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<512||receipt.bytes>8388608||!Number.isSafeInteger(receipt.width)||!Number.isSafeInteger(receipt.height)||receipt.width<320||receipt.height<200)fail('ENTRY01_SCREEN_RECEIPT_REJECTED');
  const file=resolve(out,name);let fd;try{const before=lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||(before.mode&0o777)!==0o600||before.uid!==process.getuid())fail('ENTRY01_SCREEN_FILE_REJECTED');fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const after=fstatSync(fd);if(before.ino!==after.ino||before.dev!==after.dev||after.size!==receipt.bytes)fail('ENTRY01_SCREEN_FILE_CHANGED');const bytes=readFileSync(fd);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||sha(bytes)!==receipt.sha256)fail('ENTRY01_SCREEN_HASH_REJECTED');}finally{if(fd!==undefined)closeSync(fd);}return {file,safe:{filename:name,sha256:receipt.sha256,bytes:receipt.bytes,width:receipt.width,height:receipt.height}};
}
export function buildEntryReceipt({identity,projectId,ordinaryRole,timing,observations,screenshots,out,assertSafe}){
  checkIdentity(identity);checkOutput(out);if(!PROJECT.test(projectId??'')||ordinaryRole!=='consultant'||typeof assertSafe!=='function'||!exact(timing,['status','startedAt','finishedAt','durationMs','maximumMs'])||timing.status!=='PASSED'||timing.maximumMs!==ENTRY01_MAX_MS||!Number.isSafeInteger(timing.durationMs)||timing.durationMs<0||timing.durationMs>ENTRY01_MAX_MS||!Number.isFinite(Date.parse(timing.startedAt))||!Number.isFinite(Date.parse(timing.finishedAt))||Date.parse(timing.finishedAt)<Date.parse(timing.startedAt))fail('ENTRY01_ORDINARY_TIMED_PROOF_REQUIRED');
  if(!Array.isArray(observations)||observations.length!==2||observations.some(value=>!exact(value,['projectId','overview','sixStages','fullscreen','railAbsent','geometry'])||value.projectId!==projectId||value.overview!==true||value.fullscreen!==true||value.railAbsent!==true||JSON.stringify(value.sixStages)!=='[1,2,3,4,5,6]'||!assertEntryGeometry(value.geometry))||!Array.isArray(screenshots)||screenshots.length!==2)fail('ENTRY01_TWO_OWNED_OVERVIEWS_REQUIRED');
  const screens=screenshots.map((receipt,index)=>checkedScreen(out,receipt,index));
  const receipt={schemaVersion:1,kind:'aidt-entry-01-proof',scope:'ENTRY-01 only; no later stage/model/classroom/full-112 assertion',status:'PASSED',appSource:identity.source,controlSource:identity.controlSource,tag:identity.tag,workflowRunId:identity.run,workflowAttempt:identity.attempt,projectId,orgRole:'consultant',normalUiCreateAndOwnershipVerified:true,refreshedListAndSameProjectReentry:true,timing,observations,screenshots:screens.map(value=>value.safe)};
  const text=JSON.stringify(receipt,null,2)+'\n';if(Buffer.byteLength(text)>32768)fail('ENTRY01_RECEIPT_BOUND');assertSafe(text);return {receipt,text,screens};
}
async function actionUpload({name,files,root}){const {DefaultArtifactClient}=await import('@actions/artifact');return new DefaultArtifactClient().uploadArtifact(name,files,root,{retentionDays:1,compressionLevel:0});}
/** Exactly one independent artifact attempt; no H03 nonce/request slots and no account/session serialization. */
export function createEntryPublisher({identity,out,assertSafe,upload=actionUpload,timeoutMs=60000}={}){
  checkIdentity(identity);checkOutput(out);if(typeof upload!=='function'||typeof assertSafe!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)fail('ENTRY01_PUBLISH_OPTIONS_INVALID');let attempted=false;
  return Object.freeze({async publish(input){if(attempted)fail('ENTRY01_UPLOAD_RETRY_FORBIDDEN');const proof=buildEntryReceipt({...input,identity,out,assertSafe});const file=resolve(out,'entry-01.json');writeFileSync(file,proof.text,{flag:'wx',mode:0o600});const files=[file,...proof.screens.map(value=>value.file)];const name=`aidt-entry-01-${identity.run}-${identity.attempt}`;attempted=true;let timer;try{const result=await Promise.race([upload({name,files,root:out}),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new ProbeFailure('ENTRY01_UPLOAD_OUTCOME_UNKNOWN')),timeoutMs);})]);if(!Number.isSafeInteger(result?.id)||result.id<1)return {receipt:proof.receipt,delivery:{status:'UNKNOWN',attempted:true,retryAllowed:false,name}};return {receipt:proof.receipt,delivery:{status:'UPLOADED',artifactId:result.id,attempted:true,retryAllowed:false,name}};}catch{return {receipt:proof.receipt,delivery:{status:'UNKNOWN',attempted:true,retryAllowed:false,name}};}finally{clearTimeout(timer);}}});
}
