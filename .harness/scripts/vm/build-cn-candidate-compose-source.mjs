#!/usr/bin/env node
// BEGIN GENERATED RELEASE IDENTITIES
const admittedReleaseIdentity = i => !!i && ((i.sourceRevision === "9b25bfa65662b96c0826fe67506b562ea46aa6d0" && i.baselineRevision === "ba6343199f3c834d6a198f83d0c771614292c82b") || (i.sourceRevision === "5285bef9a6c91bbb9857ede42779aafa64b98f32" && i.baselineRevision === "a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0"));
// END GENERATED RELEASE IDENTITIES
// Local compilation/provenance only. Generated metadata does not grant production authority.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const [output,originalPath,originalSha,manifestPath,manifestSha,candidateGit]=process.argv.slice(2);
if(process.argv.length!==8||![output,originalPath,manifestPath,candidateGit].every(p=>typeof p==='string'&&isAbsolute(p))||!output.endsWith('.cjs'))throw Error('CANDIDATE_COMPOSE_BUILD_USAGE');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const blob=raw=>createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
const pinned=(path,sha)=>{if(!/^[a-f0-9]{64}$/.test(sha))throw Error('CANDIDATE_COMPOSE_BUILD_PIN');const raw=readFileSync(path);if(hash(raw)!==sha)throw Error('CANDIDATE_COMPOSE_BUILD_PIN');return{raw,value:JSON.parse(raw)};};
const original=pinned(originalPath,originalSha),manifest=pinned(manifestPath,manifestSha),plan=original.value,id=plan.identity;
if(plan.schemaVersion!==1||plan.mode!=='maintenance-all-writer-fence'||plan.productionActionsAuthorized!==true||plan.runtimeSessionBootstrapAuthorized!==true||['runtimeSourcePlanSha256','runtimePlan','controlSessions','diagnosticSessions'].some(k=>k in plan)||!id||Object.keys(id).sort().join(',')!=='attemptId,baselineRevision,migrationPlanSha256,sourceRevision'||!/^[a-f0-9]{40}$/.test(id.sourceRevision)||!admittedReleaseIdentity(id)||!/^[a-f0-9]{64}$/.test(id.migrationPlanSha256)||!/^[A-Za-z0-9-]{1,128}$/.test(id.attemptId)||!/^[a-f0-9]{40}$/.test(plan.toolRevision)||manifest.value.sourceRevision!==id.sourceRevision||manifest.value.platform!=='linux/amd64'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.value.release))throw Error('CANDIDATE_COMPOSE_BUILD_IDENTITY');
// External Git environment must never redirect the selected ordinary repository.
const gitEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
Object.assign(gitEnv,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'});
const git=(cwd,args)=>execFileSync('git',['--no-replace-objects','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',cwd,...args],{env:gitEnv,maxBuffer:16*1024*1024});
if(git(candidateGit,['rev-parse',id.sourceRevision+'^{commit}']).toString().trim()!==id.sourceRevision)throw Error('CANDIDATE_COMPOSE_APP_GIT');
const emitterSourceRevision=git(root,['rev-parse','HEAD']).toString().trim();
const sources={};
const recordTool=path=>{
 const raw=readFileSync(resolve(root,path)),committed=git(root,['show',emitterSourceRevision+':'+path]);
 if(!raw.equals(committed))throw Error('CANDIDATE_COMPOSE_UNCOMMITTED_TOOL_SOURCE');
 sources[path]={gitBlob:blob(raw),sha256:hash(raw)};
};
const native=['compose.ts','config.ts','storage-config.ts','release.ts','image-reference.ts','runtime-bundle.ts'];
for(const name of native){const path='packages/cloud-deploy/src/'+name;const raw=git(candidateGit,['show',id.sourceRevision+':'+path]);if(!readFileSync(resolve(root,path)).equals(raw))throw Error('CANDIDATE_COMPOSE_NATIVE_SOURCE_DRIFT');sources[path]={gitBlob:blob(raw),sha256:hash(raw)};}
const entry='packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts';
for(const path of ['packages/cloud-deploy/src/cn-candidate-compose-source.ts',entry,'.harness/scripts/vm/build-cn-candidate-compose-source.mjs'])recordTool(path);
const require=createRequire(resolve(root,'apps/desktop/package.json')),esbuild=require('esbuild');
if(esbuild.version!=='0.24.2')throw Error('CANDIDATE_COMPOSE_COMPILER_VERSION');
const result=await esbuild.build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:output,write:false,metafile:true,logLevel:'silent'});
const dependencies={},bundledInputs=[],dependencyRoot=realpathSync(resolve(root,'node_modules'));
for(const path of Object.keys(result.metafile.inputs)){
 const actual=realpathSync(resolve(root,path)),dep=relative(dependencyRoot,actual);
 if(dep!==''&&!dep.startsWith('..'+sep)&&dep!=='..'&&!isAbsolute(dep)){
  const canonical='node_modules/'+dep.split(sep).join('/');dependencies[canonical]=hash(readFileSync(actual));bundledInputs.push(canonical);
 }else{
  if(!path.startsWith('packages/cloud-deploy/src/'))throw Error('CANDIDATE_COMPOSE_UNPINNED_SOURCE');
  if(!sources[path])recordTool(path);bundledInputs.push(path);
 }
}

if(!sources['packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts'])throw Error('CANDIDATE_COMPOSE_AUTHORITY_SOURCE_MISSING');
const raw=result.outputFiles[0].contents,lockfile=readFileSync(resolve(root,'pnpm-lock.yaml'));
if(!lockfile.equals(git(root,['show',emitterSourceRevision+':pnpm-lock.yaml'])))throw Error('CANDIDATE_COMPOSE_UNCOMMITTED_LOCKFILE');
const closure={schemaVersion:2,sourceRevision:id.sourceRevision,identity:id,toolRevision:plan.toolRevision,originalPlanSha256:originalSha,emitterSourceRevision,release:manifest.value.release,compiler:{name:'esbuild',version:esbuild.version},sources,dependencies,lockfileSha256:hash(lockfile),bundleSha256:hash(raw),bundledInputs:[...new Set(bundledInputs)].sort()};
if(!readFileSync(originalPath).equals(original.raw)||!readFileSync(manifestPath).equals(manifest.raw))throw Error('CANDIDATE_COMPOSE_BUILD_AUTHORITY_DRIFT');
for(const [path,pin]of Object.entries(sources))if(hash(readFileSync(resolve(root,path)))!==pin.sha256)throw Error('CANDIDATE_COMPOSE_BUILD_SOURCE_DRIFT');
for(const [path,pin]of Object.entries(dependencies))if(hash(readFileSync(resolve(root,path)))!==pin)throw Error('CANDIDATE_COMPOSE_BUILD_DEPENDENCY_DRIFT');
writeFileSync(output,raw,{flag:'wx',mode:0o600});writeFileSync(output+'.source-closure.json',JSON.stringify(closure,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({bundleSha256:closure.bundleSha256,sourceClosure:output+'.source-closure.json',productionAuthorized:false}));
