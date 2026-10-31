/** Execute/aggregate current-source selected UI suites. Rollout policy remains authoritative. */
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyTargetedPlan} from './ci-targeted-ui.mjs';
import {invoke} from './ci-chat-shards.mjs';
import {unitEvidence,browserEvidence,verifyEvidence} from './ci-targeted-evidence.mjs';
const root=resolve(import.meta.dirname,'../..');
export function runIdentity(env=process.env){
 const x={sha:env.GITHUB_SHA,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT};
 if(!/^[a-f0-9]{40}$/.test(x.sha??'')||!['run','attempt'].every(k=>/^[1-9]\d*$/.test(x[k]??'')))throw Error('INVALID_TARGETED_RUN');return x;
}
export function runUnit(plan,directory,cwd=resolve(root,'apps/web'),context=runIdentity()){
 cwd=realpathSync(cwd);mkdirSync(directory,{recursive:true});const path=resolve(directory,'report.json');
 const files=plan.suites.find(x=>x.id==='web-unit')?.files.map(x=>x.file);
 if(!files?.length)throw Error('MISSING_UNIT_SELECTION');
 const result=spawnSync(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run','--bail=1','--reporter=json',`--outputFile=${path}`,...files],{cwd,env:{...process.env,GH_TOKEN:undefined,GITHUB_TOKEN:undefined},encoding:'utf8',maxBuffer:32*1024*1024,timeout:20*60_000});
 writeFileSync(resolve(directory,'run.log'),(result.stdout??'')+(result.stderr??''));
 if(result.error||result.status!==0)throw Error('TARGETED_UNIT_FAILED');
 const evidence=unitEvidence(plan,JSON.parse(readFileSync(path,'utf8')),cwd,context);
 writeFileSync(resolve(directory,'evidence.json'),JSON.stringify(evidence));return evidence;
}
export function runBrowser(plan,directory,cwd=resolve(root,'apps/web'),context=runIdentity(),options={}){
 cwd=realpathSync(cwd);mkdirSync(directory,{recursive:true});
 const files=plan.suites.find(x=>x.id==='chat-ui')?.files.map(x=>x.file);
 if(!files?.length)throw Error('MISSING_BROWSER_SELECTION');
 const discovery=invoke(null,1,true,{...options,cwd,files,stripTokens:true}).report;
 const result=invoke(null,1,false,{...options,cwd,files,stripTokens:true});
 writeFileSync(resolve(directory,'report.json'),JSON.stringify(result.report));
 if(result.status!==0)throw Error('TARGETED_BROWSER_FAILED');
 const evidence=browserEvidence(plan,discovery,result.report,cwd,context,result.status);
 writeFileSync(resolve(directory,'evidence.json'),JSON.stringify(evidence));return evidence;
}
function download(name,directory,context,env){
 if(env.GITHUB_REPOSITORY!=='boardx/workspacex')throw Error('UNTRUSTED_REPOSITORY');
 mkdirSync(directory,{recursive:true});
 execFileSync('gh',['run','download',context.run,'--repo',env.GITHUB_REPOSITORY,'--name',`${name}-${context.run}-${context.attempt}`,'--dir',directory],{stdio:'inherit',timeout:120000});
}
export function verifyDirectory(directory,env=process.env){
 const context=runIdentity(env),plan=JSON.parse(readFileSync(resolve(directory,'plan/plan.json'),'utf8'));
 verifyTargetedPlan(plan,{baseSha:env.CI_SCOPE_BASE_SHA,headSha:context.sha});
 const evidence=['web-unit','chat-ui'].map(suite=>{
  const record=JSON.parse(readFileSync(resolve(directory,suite,'evidence.json'),'utf8'));
  return {...record,report:JSON.parse(readFileSync(resolve(directory,suite,'report.json'),'utf8'))};
 });
 verifyEvidence(plan,evidence,context);
 const receipt={schemaVersion:1,mode:plan.mode,...context,planDigest:plan.planDigest,policyDigest:plan.policyDigest,suites:evidence.map(x=>x.suite),status:'success'};
 writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt));return receipt;
}
export function bundleCurrent(directory,env=process.env){
 const context=runIdentity(env);
 for(const name of ['plan','web-unit','chat-ui'])download(name==='plan'?'regression-plan':`targeted-ui-${name}`,resolve(directory,name),context,env);
 return verifyDirectory(directory,env);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,directory]=process.argv.slice(2);if(!directory)throw Error('ARTIFACT_DIRECTORY_REQUIRED');
 const context=runIdentity();
 if(command==='bundle'){
  console.log(JSON.stringify(bundleCurrent(directory)));
 }else if(['web-unit','chat-ui'].includes(command)){
  const planDirectory=resolve(directory,'plan');download('regression-plan',planDirectory,context,process.env);
  const plan=JSON.parse(readFileSync(resolve(planDirectory,'plan.json'),'utf8'));
  verifyTargetedPlan(plan,{baseSha:process.env.CI_SCOPE_BASE_SHA,headSha:context.sha});
  const output=resolve(directory,'suite');
  const evidence=command==='web-unit'?runUnit(plan,output):runBrowser(plan,output);
  console.log(JSON.stringify({suite:evidence.suite,sha:evidence.sha,planDigest:evidence.planDigest,status:'success'}));
 }else throw Error('INVALID_TARGETED_COMMAND');
}
