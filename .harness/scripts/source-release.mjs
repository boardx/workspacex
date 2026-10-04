#!/usr/bin/env node
// Source registration only. This is deliberately not an OCI manifest or a prepared receipt.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const reject=c=>{throw new Error(c);};
const sha=/^[a-f0-9]{40}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const keys=(v,k)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join()!==k.sort().join())reject('SOURCE_PLAN_SCHEMA');};
export function validatePlan(p){
 keys(p,['schemaVersion','kind','status','release','sourceTag','sourceRevision','baselineRevision','frozenMainRevision','environment','scope','dataPolicy']);
 if(p.schemaVersion!==1||p.kind!=='source-release-plan'||p.status!=='source-planned'||!/^\d{4}\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(p.release)||p.sourceTag!==`source/${p.release}`)reject('SOURCE_PLAN_IDENTITY');
 if(![p.sourceRevision,p.baselineRevision,p.frozenMainRevision].every(x=>typeof x==='string'&&sha.test(x))||p.sourceRevision===p.baselineRevision)reject('SOURCE_PLAN_REVISION');
 if(!['cn-production','devapp'].includes(p.environment))reject('SOURCE_PLAN_ENVIRONMENT');
 if(!Array.isArray(p.scope)||!p.scope.length||p.scope.length>32||new Set(p.scope).size!==p.scope.length||p.scope.some(x=>typeof x!=='string'||!/^#[1-9][0-9]*$/.test(x)))reject('SOURCE_PLAN_SCOPE');
 if(!['none','additive-migration','maintenance-required'].includes(p.dataPolicy))reject('SOURCE_PLAN_DATA_POLICY');
 return p;
}
export const serializePlan=p=>`${JSON.stringify(validatePlan(p),null,2)}\n`;
// Conservative support for the repository's block-style workflow triggers. Unknown forms stop registration.
export function assertSourceTagTriggersSafe(workflows){
 if(!workflows.length)reject('SOURCE_TRIGGER_AUDIT_EMPTY');
 for(const [file,body] of workflows){
  const text=body.split('\n').map(x=>x.replace(/\s+#.*$/,'')).join('\n');
  const lines=text.split('\n');const start=lines.findIndex(x=>/^on:\s*$/.test(x));
  if(start<0)reject(`SOURCE_TRIGGER_UNSUPPORTED:${file}`);
  let end=start+1;while(end<lines.length&&!/^[a-zA-Z_][\w-]*:/.test(lines[end]))end++;
  const blockLines=lines.slice(start+1,end).filter(x=>x.trim()&&!x.trim().startsWith('#'));
  const allowed=new Set(['push','pull_request','merge_group','workflow_dispatch','workflow_run','schedule']);
  let event;
  for(let i=0;i<blockLines.length;i++){
   const line=blockLines[i],match=line.match(/^  ([a-z_]+):\s*$/);
   if(match){event=match[1];if(!allowed.has(event))reject(`SOURCE_TRIGGER_FOLLOWON:${file}`);}
   else if(!event||!/^    /.test(line))reject(`SOURCE_TRIGGER_UNSUPPORTED:${file}`);
  }
  const pushStart=blockLines.findIndex(x=>/^  push:/.test(x));
  if(pushStart>=0){
   let stop=pushStart+1;while(stop<blockLines.length&&!/^  \S/.test(blockLines[stop]))stop++;
   const push=blockLines.slice(pushStart+1,stop).join('\n');
   if(push.split('\n').some(x=>!/^    (?:branches|tags|paths|paths-ignore):\s*\[[^\]]*\]\s*$/.test(x)))reject(`SOURCE_TRIGGER_UNSUPPORTED:${file}`);
   const tags=push.match(/^    tags:\s*\[([^\]]*)\]\s*$/m);
   if(tags){const values=tags[1].split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,''));if(!values.length||values.some(x=>x!=='v*'))reject(`SOURCE_TRIGGER_FOLLOWON:${file}`);}
   else if(!/^    branches:\s*\[[^\]]+\]/m.test(push))reject(`SOURCE_TRIGGER_FOLLOWON:${file}`);
  }
 }
}
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function verifySource(p,execute=git){
 validatePlan(p);
 for(const revision of [p.sourceRevision,p.baselineRevision,p.frozenMainRevision])execute(['cat-file','-e',`${revision}^{commit}`]);
 execute(['merge-base','--is-ancestor',p.sourceRevision,p.frozenMainRevision]);
}
export function register(p,api,workflows,sourceWorkflows,execute=git){
 verifySource(p,execute);assertSourceTagTriggersSafe(workflows);assertSourceTagTriggersSafe(sourceWorkflows);
 const bytes=serializePlan(p),fingerprint=hash(bytes);
 // GET tag refs returns annotated object or commit; always resolve to the exact source SHA.
 let ref=api('GET',`git/ref/tags/${p.sourceTag}`,undefined,true);
 if(ref){if(ref.object.type!=='tag')reject('SOURCE_TAG_ALREADY_DIFFERENT');const tag=api('GET',`git/tags/${ref.object.sha}`);if(tag.message!==`Source release ${p.release}\nplan-sha256=${fingerprint}`||tag.object.type!=='commit'||tag.object.sha!==p.sourceRevision)reject('SOURCE_TAG_ALREADY_DIFFERENT');}
 else{
  const tag=api('POST','git/tags',{tag:p.sourceTag,message:`Source release ${p.release}\nplan-sha256=${fingerprint}`,object:p.sourceRevision,type:'commit'});
  // No force/update operation; a concurrent registration receives conflict and stops.
  api('POST','git/refs',{ref:`refs/tags/${p.sourceTag}`,sha:tag.sha});
 }
 const existing=api('GET',`releases/tags/${p.sourceTag}`,undefined,true);
 if(existing){if(existing.body!==bytes||existing.target_commitish!==p.sourceRevision||!existing.draft||existing.prerelease!==true)reject('SOURCE_RELEASE_ALREADY_DIFFERENT');return {sourceRegistered:true,sourceRevision:p.sourceRevision,sourceTag:p.sourceTag,planSha256:fingerprint,url:existing.html_url,cnPrepared:false};}
 const release=api('POST','releases',{tag_name:p.sourceTag,target_commitish:p.sourceRevision,name:`Source ${p.release}`,body:bytes,draft:true,prerelease:true,make_latest:'false'});
 return {sourceRegistered:true,sourceRevision:p.sourceRevision,sourceTag:p.sourceTag,planSha256:fingerprint,url:release.html_url,cnPrepared:false};
}
function main(){
 const [mode,input,output]=process.argv.slice(2);if(!['dry-run','register'].includes(mode)||!input||(mode==='dry-run'&&!output)||(mode==='register'&&output)||process.argv.length>(mode==='dry-run'?6:5))reject('SOURCE_RELEASE_USAGE');
 const p=validatePlan(JSON.parse(fs.readFileSync(input,'utf8')));verifySource(p);
 const files=git(['ls-tree','-r','--name-only',p.frozenMainRevision,'.github/workflows']).split('\n').filter(x=>/\.ya?ml$/.test(x));
 const workflows=files.map(file=>[file,git(['show',`${p.frozenMainRevision}:${file}`])]);assertSourceTagTriggersSafe(workflows);
 const sourceFiles=git(['ls-tree','-r','--name-only',p.sourceRevision,'.github/workflows']).split('\n').filter(x=>/\.ya?ml$/.test(x));
 const sourceWorkflows=sourceFiles.map(file=>[file,git(['show',`${p.sourceRevision}:${file}`])]);assertSourceTagTriggersSafe(sourceWorkflows);
 if(mode==='dry-run'){fs.writeFileSync(output,serializePlan(p),{flag:'wx',mode:0o600});console.log(JSON.stringify({sourceRegistered:false,cnPrepared:false,planSha256:hash(serializePlan(p))}));return;}
 reject('SOURCE_REGISTRATION_REQUIRES_EXTERNAL_TRIGGER_AUDIT');
 const repo=git(['remote','get-url','origin']).match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];if(repo!=='boardx/workspacex')reject('SOURCE_REPOSITORY_TARGET');
 // Recheck live default-branch workflows before a remote write; frozen workflow audit alone can become stale.
 const api=(method,endpoint,data,missing=false)=>{
  try{return JSON.parse(execFileSync('gh',['api','--method',method,`repos/${repo}/${endpoint}`,...(data===undefined?[]:['--input','-'])],{input:data===undefined?undefined:JSON.stringify(data),encoding:'utf8',stdio:['pipe','pipe','pipe']}));}
  catch(e){if(missing&&/\(HTTP 404\)/.test(String(e.stderr)))return null;reject('SOURCE_GITHUB_API_FAILED');}
 };
 const live=api('GET','commits/main').sha;if(!sha.test(live))reject('SOURCE_LIVE_MAIN');
 const listing=api('GET',`contents/.github/workflows?ref=${live}`);
 const liveWorkflows=listing.filter(x=>/\.ya?ml$/.test(x.name)).map(x=>{const value=api('GET',`contents/${x.path}?ref=${live}`);if(value.encoding!=='base64')reject('SOURCE_WORKFLOW_ENCODING');return [x.path,Buffer.from(value.content,'base64').toString('utf8')];});
 // Known external integrations/webhooks require operator audit; this script audits repository Actions only.
 console.log(JSON.stringify(register(p,api,liveWorkflows,sourceWorkflows)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
