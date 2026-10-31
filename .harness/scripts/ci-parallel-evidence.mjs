/** Verify current-attempt parallel producer artifacts; no cross-source reuse. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateShardEvidence as webValidate} from './ci-web-shards.mjs';
import {validateShardEvidence as chatValidate} from './ci-chat-shards.mjs';
const root=resolve(import.meta.dirname,'../..');
const hash=data=>createHash('sha256').update(data).digest('hex');
export function identity(env=process.env){
 const x={sha:env.GITHUB_SHA,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT};
 if(!/^[a-f0-9]{40}$/.test(x.sha??'')||!/^\d+$/.test(x.run??'')||!/^\d+$/.test(x.attempt??''))throw Error('INVALID_PRODUCER_IDENTITY');return x;
}
export function stamp(file,env=process.env){writeFileSync(`${file}.identity.json`,JSON.stringify({...identity(env),hash:hash(readFileSync(file))}));}
export function verify(kind,directory,env=process.env){
 if(!['web','chat'].includes(kind))throw Error('INVALID_KIND');const expected=identity(env);
 const file=resolve(directory,'coverage','coverage.json'),bytes=readFileSync(file),proof=JSON.parse(readFileSync(`${file}.identity.json`,'utf8'));
 if(Object.keys(expected).some(k=>proof[k]!==expected[k])||proof.hash!==hash(bytes))throw Error('WRONG_COVERAGE_IDENTITY');
 const coverage=JSON.parse(bytes),count=JSON.parse(readFileSync(resolve(root,`.harness/${kind==='web'?'web-test':'chat-test'}-shards.json`))).count;
 if(coverage.partitions?.length!==count)throw Error('WRONG_PARTITION_COUNT');
 const outputs=Array.from({length:count},(_,i)=>{const d=resolve(directory,String(i+1));return kind==='web'?{manifest:JSON.parse(readFileSync(resolve(d,'manifest.json'),'utf8')),report:readFileSync(resolve(d,'report.json'),'utf8'),log:readFileSync(resolve(d,'run.log'),'utf8')}:JSON.parse(readFileSync(resolve(d,'result.json'),'utf8'));});
 if(kind==='web')webValidate(coverage,outputs,{sourceSHA:expected.sha,run:expected.run,attempt:expected.attempt});
 else chatValidate(coverage,outputs,{sha:expected.sha,runId:expected.run,attempt:expected.attempt});
 return {kind,...expected,count,status:'verified'};
}
export function download(kind,directory,env=process.env){
 if(!['web','chat'].includes(kind)||!/^boardx\/workspacex$/.test(env.GITHUB_REPOSITORY??''))throw Error('INVALID_DOWNLOAD_CONTEXT');
 const x=identity(env),count=JSON.parse(readFileSync(resolve(root,`.harness/${kind==='web'?'web-test':'chat-test'}-shards.json`))).count;
 for(const part of ['coverage',...Array.from({length:count},(_,i)=>String(i+1))]){
  const target=resolve(directory,part);mkdirSync(target,{recursive:true});
  execFileSync('gh',['run','download',x.run,'--repo',env.GITHUB_REPOSITORY,'--name',`parallel-${kind}-${part}-${x.run}-${x.attempt}`,'--dir',target],{stdio:'inherit',timeout:120000});
 }
}
export function combineBase(directory,output){
 const walk=d=>readdirSync(d).flatMap(name=>{const p=resolve(d,name),st=lstatSync(p);if(st.isSymbolicLink())throw Error('UNTRUSTED_LOG_LINK');return st.isDirectory()?walk(p):[p];});
 const packages=walk(resolve(directory,'package-evidence')).filter(p=>p.endsWith('/non-api-tests.log'));
 if(packages.length!==1)throw Error('MISSING_PACKAGE_LOG');
 const web=walk(resolve(directory,'web-evidence')).filter(p=>p.endsWith('/run.log'));
 const count=JSON.parse(readFileSync(resolve(root,'.harness/web-test-shards.json'))).count;
 if(web.length!==count)throw Error('MISSING_WEB_LOG');
 const files=[packages[0],resolve(directory,'api-tests.log'),...web];
 const logs=files.map(p=>{const text=readFileSync(p,'utf8');if(!text.trim())throw Error('EMPTY_TEST_LOG');return text;});
 writeFileSync(output,logs.join('\n'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,kind,directory]=process.argv.slice(2);
 if(command==='combine-base')combineBase(kind,directory);
 else if(command==='chat-prerequisites'){
  const needs=JSON.parse(process.env.CI_CHAT_NEEDS??'null');
  if(!needs||Object.keys(needs).sort().join()!=='chat-test-plan,chat-test-shards'||Object.values(needs).some(v=>v?.result!=='success'))throw Error('INCOMPLETE_CHAT_PRODUCERS');
 }
 else if(command==='stamp')stamp(kind);
 else if(command==='bundle'){download(kind,directory);console.log(JSON.stringify(verify(kind,directory)));}
 else throw Error('INVALID_COMMAND');
}
