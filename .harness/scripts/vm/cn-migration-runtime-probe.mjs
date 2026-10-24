#!/usr/bin/env node
// Real HTTP boundary probe. Root provider owns isolation, fixture seeding, image
// inspection, database readback and teardown; this program never runs SQL/Docker.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
class Rejected extends Error {}
const requireThat=(value,code)=>{if(!value)throw new Rejected(code);};
export function validateProbeInput(input){
 requireThat(input?.schemaVersion===1 && /^[a-f0-9]{32}$/.test(input.nonce??''),'INPUT');
 for(const key of ['baselineSourceRevision','sourceRevision'])requireThat(/^[a-f0-9]{40}$/.test(input[key]??''),'INPUT');
 for(const key of ['migrationPlanSha256','pendingSha256'])requireThat(/^[a-f0-9]{64}$/.test(input[key]??''),'INPUT');
 requireThat(input.orgId===`cn-probe-${input.nonce}` && input.userId===`cn-probe-user-${input.nonce}` && input.email===`cn-probe-${input.nonce}@example.invalid`,'FIXTURE_IDENTITY');
 requireThat(typeof input.password==='string' && input.password.length>=16 && input.password.length<=256,'INPUT');
 for(const [runtime,origin] of [['old','http://old-api:3200'],['candidate','http://api:3200']]){
  const binding=input[runtime];
  requireThat(binding?.origin===origin && uuid.test(binding.deploymentMarker??'') && /^[a-f0-9]{64}$/.test(binding.containerId??'') && /^sha256:[a-f0-9]{64}$/.test(binding.imageId??''),'RUNTIME_BINDING');
 }
 requireThat(input.old.containerId!==input.candidate.containerId && input.old.deploymentMarker!==input.candidate.deploymentMarker,'RUNTIME_ALIAS');
 return input;
}
export async function runRuntimeProbe(raw,{fetchImpl=globalThis.fetch}={}){
 const transcript=[],owned=new Map(),tokens={};
 let input,errorCode=null,cleanupPassed=false;
 const results=Object.fromEntries(['oldRead','oldWrite','candidateRead','candidateWrite'].map(key=>[key,{status:'failed',evidenceSha256:hash([]),evidenceLength:0}]));
 const finish=key=>{results[key]={status:'passed',evidenceSha256:hash(transcript),evidenceLength:transcript.length};};
 const request=async(runtime,operation,path,method='GET',body,expected=200)=>{
  let response;
  try {response=await fetchImpl(input[runtime].origin+path,{method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(tokens[runtime]?{Authorization:`Bearer ${tokens[runtime]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch {throw new Rejected(`${runtime.toUpperCase()}_${operation}_TRANSPORT`);}
  transcript.push({runtime,operation,status:response.status});
  requireThat(response.status===expected && !response.redirected,`${runtime.toUpperCase()}_${operation}_STATUS`);
  requireThat(response.headers.get('content-type')?.split(';')[0].trim()==='application/json',`${runtime.toUpperCase()}_${operation}_CONTENT_TYPE`);
  let text='';const decoder=new TextDecoder();
  try {for await(const chunk of response.body){text+=decoder.decode(chunk,{stream:true});requireThat(Buffer.byteLength(text)<=65536,'RESPONSE_LIMIT');}text+=decoder.decode();return JSON.parse(text);}
  catch(error){if(error instanceof Rejected)throw error;throw new Rejected(`${runtime.toUpperCase()}_${operation}_JSON`);}
 };
 const list=async(runtime,id,name,status)=>{
  const rows=await request(runtime,'LIST',`/projects?orgId=${encodeURIComponent(input.orgId)}`);
  requireThat(Array.isArray(rows),'LIST_SCHEMA');
  const matches=rows.filter(row=>row?.id===id);
  requireThat(matches.length===1 && matches[0].name===name && matches[0].kind==='general' && matches[0].status===status && matches[0].readOnlyReason===(status==='archived'?'archived':null) && Array.isArray(matches[0].tags),'OWNED_PROJECT_READBACK');
  transcript.push({runtime,operation:'OWNED_PROJECT_READBACK',id,status,kind:'general',nameSha256:hash(name),readOnlyReason:matches[0].readOnlyReason,tagsArray:true});
  return matches[0];
 };
 const create=async(runtime)=>{
  const name=`cn-drill-${input.nonce}-${runtime}`;
  const project=await request(runtime,'CREATE','/projects','POST',{orgId:input.orgId,name,kind:'general',blueprintVersionId:null},201);
  requireThat(typeof project?.id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(project.id) && project.kind==='general' && project.status==='active' && !owned.has(project.id),'CREATE_SCHEMA');
  await list(runtime,project.id,name,'active');
  // Ownership is established by exact nonce name + id readback before cleanup.
  owned.set(project.id,{runtime,name,archived:false});
  return project.id;
 };
 const archive=async(runtime,id)=>{
  const project=owned.get(id);requireThat(project,'ARCHIVE_OWNERSHIP');
  await list(runtime,id,project.name,'active');
  const result=await request(runtime,'ARCHIVE',`/projects/${encodeURIComponent(id)}/archive`,'POST',{},201);
  requireThat(result?.projectId===id && result.status==='archived','ARCHIVE_SCHEMA');
  project.archived=true;
 };
 try{
  input=validateProbeInput(raw);
  for(const runtime of ['old','candidate']){
   const health=await request(runtime,'HEALTH','/healthz');
   requireThat(health?.trustworthy===true && health.rlsForced===true && health.appRoleIsOwner===false && /^[a-zA-Z0-9_.-]{1,160}$/.test(health.migrationVersion??'') && health.deploymentMarker===input[runtime].deploymentMarker,'HEALTH_IDENTITY');
   transcript.push({runtime,operation:'HEALTH_IDENTITY',deploymentMarker:health.deploymentMarker,migrationVersion:health.migrationVersion,trustworthy:true,rlsForced:true,appRoleIsOwner:false,imageId:input[runtime].imageId,containerId:input[runtime].containerId});
   const session=await request(runtime,'LOGIN','/auth/login','POST',{email:input.email,password:input.password});
   requireThat(session?.userId===input.userId && Array.isArray(session.orgs) && session.orgs.length===1 && session.orgs[0]===input.orgId && typeof session.sessionToken==='string' && session.sessionToken.length>=16 && session.sessionToken.length<=512 && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt)>Date.now(),'LOGIN_IDENTITY');
   tokens[runtime]=session.sessionToken;
   transcript.push({runtime,operation:'LOGIN_IDENTITY',expectedFixtureUser:true,soleFixtureOrg:true,unexpired:true});
   const identity=await request(runtime,'IDENTITY',`/identity/me?orgId=${encodeURIComponent(input.orgId)}`);
   requireThat(identity?.org?.id===input.orgId && identity.orgRole==='lead','ORG_IDENTITY');
   transcript.push({runtime,operation:'ORG_IDENTITY',expectedFixtureOrg:true,orgRole:'lead'});
  }
  requireThat(tokens.old!==tokens.candidate,'SESSION_ALIAS');
  const oldId=await create('old');finish('oldWrite');
  await list('candidate',oldId,owned.get(oldId).name,'active');finish('candidateRead');
  const candidateId=await create('candidate');
  await list('old',candidateId,owned.get(candidateId).name,'active');finish('candidateWrite');finish('oldRead');
  await archive('old',candidateId);await list('candidate',candidateId,owned.get(candidateId).name,'archived');
  await archive('candidate',oldId);await list('old',oldId,owned.get(oldId).name,'archived');
  cleanupPassed=true;
 }catch(error){errorCode=error instanceof Rejected?error.message:'INTERNAL';}
 // Best effort archive only exact nonce projects whose ownership we established.
 // A partial/unknown create stays failed and is removed by provider clone teardown.
 if(input && !cleanupPassed && owned.size){
  for(const [id,project] of owned){
   if(project.archived)continue;
   try{await archive(project.runtime,id);await list(project.runtime,id,project.name,'archived');}catch{}
  }
 }
 const projectIds=Object.fromEntries([...owned].map(([id,project])=>[project.runtime,id]));
 const identity=input?{nonce:input.nonce,baselineSourceRevision:input.baselineSourceRevision,sourceRevision:input.sourceRevision,migrationPlanSha256:input.migrationPlanSha256,pendingSha256:input.pendingSha256}:{};
 return {schemaVersion:1,scope:'restored-baseline-runtime',...identity,...results,cleanupPassed,probeProjectIds:projectIds,httpEvidence:transcript,evidenceSha256:hash(transcript),...(errorCode?{reasonCode:`CN_MIGRATION_PROBE_${errorCode}`}:{})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let text='';for await(const chunk of process.stdin){text+=chunk;requireThat(Buffer.byteLength(text)<=65536,'INPUT_LIMIT');}
  const result=await runRuntimeProbe(JSON.parse(text));
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.reasonCode || !result.cleanupPassed || ['oldRead','oldWrite','candidateRead','candidateWrite'].some(key=>result[key].status!=='passed'))process.exitCode=1;
 }catch{console.error('CN_MIGRATION_PROBE_INPUT_REJECTED');process.exitCode=1;}
}
