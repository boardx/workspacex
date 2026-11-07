/** Full regression receipt: frozen source and every declared producer must succeed. */
import {readFileSync,appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from './vendor/yaml-2.9.0/parser.mjs';
import {requireFrozenDevelop} from './ci-lightweight.mjs';
export function requireHourlyResults(needs,{expected,sha}={}){
 if(!Array.isArray(expected)||!expected.length||new Set(expected).size!==expected.length||!expected.includes('freeze-source')||!needs||Object.keys(needs).sort().join()!==[...expected].sort().join()||expected.some(name=>needs[name]?.result!=='success')||needs['freeze-source'].outputs?.sha!==sha||!/^[a-f0-9]{40}$/.test(sha??''))throw Error('HOURLY_FULL_PRODUCERS_REJECTED');
 return {mode:'full',verifiedSha:sha,fullRegression:true,coverage:'frozen-develop-snapshot-not-every-commit'};
}
function save(receipt){const directory=resolve(process.env.RUNNER_TEMP??'.harness/state','hourly-full');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const sha=requireFrozenDevelop({event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),repository:process.env.GITHUB_REPOSITORY});
  if(!['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'].every(key=>/^[1-9]\d*$/.test(process.env[key]??'')))throw Error('HOURLY_RUN_IDENTITY_REQUIRED');
  const expected=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs['hourly-full-result'].needs;
  const receipt={completedAt:new Date().toISOString(),sourceFrozenAt:JSON.parse(process.env.CI_FULL_NEEDS??'null')?.['freeze-source']?.outputs?.frozen_at??null,...requireHourlyResults(JSON.parse(process.env.CI_FULL_NEEDS??'null'),{expected,sha}),repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT};
  save(receipt);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Full regression receipt\n\nVerified frozen SHA: ${sha}; run ${receipt.runId}, attempt ${receipt.runAttempt}. This does not certify any newer commit or all intermediate commits.\n`);
 }catch(error){
  let needs;try{needs=JSON.parse(process.env.CI_FULL_NEEDS??'null')}catch{}
  const receipt={mode:'full-regression-attempt',fullRegression:false,verifiedSha:null,eventSha:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,sourceFrozenAt:needs?.['freeze-source']?.outputs?.frozen_at??null,completedAt:new Date().toISOString(),reason:error.message,producerResults:Object.fromEntries(Object.entries(needs??{}).map(([name,value])=>[name,value?.result??'missing']))};
  save(receipt);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Full regression incomplete\n\nFrozen event SHA: ${receipt.eventSha}; fullRegression=false; ${receipt.reason}. Skipped/cancelled/missing producers are not passed suites.\n`);
  console.error(error.message);process.exitCode=1;
 }
}
