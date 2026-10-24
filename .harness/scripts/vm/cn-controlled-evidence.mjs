// Separate operator lane. Never invoked with the promotion workflow token.
// Root-owned signing key / pinned verification key are provisioned by humans.
import { createHash, verify } from 'node:crypto';
import { writeFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {evidenceWindow,protectedRead,validateDevapp,collectDevapp,boundedEnvelope} from './devapp-runtime-identity.mjs';
export {evidenceWindow,protectedRead,validateDevapp,collectDevapp,boundedEnvelope};
const sha=/^[a-f0-9]{40}$/;
const fail=code=>{throw new Error(code)};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateEnvelope(envelope,publicKey,source,attempt,kind,now=Date.now()) {
 const bytes=Buffer.from(envelope.payload??'', 'base64');
 if(!verify(null,bytes,publicKey,Buffer.from(envelope.signature??'','base64')))fail('CONTROLLED_SIGNATURE');
 const value=JSON.parse(bytes);
 if(value.schemaVersion!==1||value.kind!==kind||value.repository!=='boardx/workspacex'||value.sourceSha!==source||value.attemptId!==attempt||!sha.test(source)||!Number.isFinite(Date.parse(value.observedAt))||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.observedAt)>now||Date.parse(value.expiresAt)<=now||Date.parse(value.expiresAt)-Date.parse(value.observedAt)>3600000)fail('CONTROLLED_BINDING_OR_TTL');
 return value;
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
 writeFileSync(output,JSON.stringify(boundedEnvelope(payload,key)),{mode:0o600,flag:'wx'});
 console.log('CN_CONTROLLED_EVIDENCE_COLLECTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('CN_CONTROLLED_EVIDENCE_NOT_READY');process.exitCode=3;});
