import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function shardPlan(policy) {
  if (policy?.schemaVersion !== 1 || !Number.isInteger(policy.count) || policy.count < 1 || policy.count > 16) throw Error('INVALID_POLICY');
  return {count:policy.count, shards:Array.from({length:policy.count},(_,i)=>i+1)};
}
export function identities(report) {
  if (report.errors?.length) throw Error('DISCOVERY_ERRORS');
  const rows=[];
  function walk(suites, titles=[]) { for(const suite of suites??[]) { const next=[...titles,suite.title]; for(const spec of suite.specs??[]) for(const test of spec.tests??[]) rows.push(JSON.stringify([test.projectName,spec.file,spec.line,spec.column,next,spec.title,test.annotations?.some(a=>a.type==='fail')?'failed':test.expectedStatus])); walk(suite.suites,next); } }
  walk(report.suites); return rows;
}
export function assertCoverage(full, partitions) {
  if(!full.length || new Set(full).size!==full.length) throw Error('INVALID_FULL_DISCOVERY');
  const seen=new Set(); for(const part of partitions) {if(!part.length) throw Error('EMPTY_SHARD'); for(const id of part) {if(!full.includes(id)||seen.has(id)) throw Error('DUPLICATE_OR_UNEXPECTED_IDENTITY'); seen.add(id);}}
  if(seen.size!==full.length) throw Error('MISSING_IDENTITY');
  return {tests:full.length,counts:partitions.map(p=>p.length)};
}
const sentinel = Object.fromEntries(['API','WEB','MODEL_PROVIDER','DEEP_AGENT_PROVIDER','LOOPBACK_SANDBOX','ASR_PROVIDER','VISION_PROVIDER'].map((name,i)=>[`WORKSPACEX_${name}_PORT`,String(18001+i)]));
export function invoke(shard,count,list=true, options={}) {
  if (!options.config && !/fullyParallel:\s*false/.test(readFileSync(resolve(root,'apps/web/playwright.chat-read.config.ts'),'utf8'))) throw Error('FILE_ISOLATION_REQUIRED');
  const args=['exec','playwright','test','--config',options.config??'playwright.chat-read.config.ts','--reporter=json'];
  if(list) args.push('--list'); else args.push('--max-failures=1');
  if(shard) args.push(`--shard=${shard}/${count}`);
  const result=spawnSync('pnpm',args,{cwd:options.cwd??resolve(root,'apps/web'),env:{...process.env,...(list?sentinel:{}),PLAYWRIGHT_JSON_OUTPUT_NAME:''},encoding:'utf8',timeout:list?120000:3600000,maxBuffer:32*1024*1024});
  if(result.error) throw result.error;
  if(!list && result.stderr) process.stderr.write(result.stderr);
  let report; try { report=JSON.parse(result.stdout); } catch {throw Error(`INVALID_PLAYWRIGHT_REPORT: ${result.stderr}`);}
  if(list&&result.status!==0) throw Error('DISCOVERY_FAILED');
  return {report,status:result.status??1};
}
export function discoverCoverage(plan,options={}) {
  const full=identities(invoke(null,plan.count,true,options).report);
  const partitions=plan.shards.map(i=>identities(invoke(i,plan.count,true,options).report));
  return {...assertCoverage(full,partitions),discoverySha256:createHash('sha256').update([...full].sort().join('\n')).digest('hex'),full,partitions};
}
export const reportHash = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');
export function verifyResults(results,coverage,expected) {
  if(results.length!==coverage.partitions.length) throw Error('MISSING_PRODUCER');
  assertCoverage(coverage.full,coverage.partitions);
  if(coverage.discoverySha256!==createHash('sha256').update([...coverage.full].sort().join('\n')).digest('hex')) throw Error('TAMPERED_DISCOVERY');
  const seen=new Set();
  for(const result of results) {
    if(!result || seen.has(result.shard) || !Number.isInteger(result.shard) || result.shard<1 || result.shard>coverage.partitions.length) throw Error('INVALID_PRODUCER');
    seen.add(result.shard);
    for(const key of ['sha','runId','attempt']) if(!expected[key] || result[key]!==expected[key]) throw Error('WRONG_IDENTITY');
    if(result.discoverySha256!==coverage.discoverySha256 || result.reportHash!==reportHash(result.report) || JSON.stringify(result.stats)!==JSON.stringify(result.report.stats) || JSON.stringify(result.identities)!==JSON.stringify(identities(result.report))) throw Error('TAMPERED_EVIDENCE');
    const wanted=coverage.partitions[result.shard-1];
    const declaredSkipped=wanted.filter(id=>JSON.parse(id).at(-1)==='skipped').length;
    const tests=[]; const collect=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[]) tests.push(...spec.tests);collect(suite.suites);}}; collect(result.report.suites);
    for(const test of tests) {
      const expectedStatus=test.expectedStatus;
      if(!['passed','failed','skipped'].includes(expectedStatus) || !test.results?.length || test.results.some(run=>run.status!==expectedStatus) || test.status!==(expectedStatus==='skipped'?'skipped':'expected')) throw Error('UNEXPECTED_TEST_OUTCOME');
    }
    if(result.status!==0 || result.stats?.unexpected!==0 || result.stats?.skipped!==declaredSkipped || result.stats?.flaky!==0 || result.stats?.expected!==wanted.length-declaredSkipped || JSON.stringify([...result.identities].sort())!==JSON.stringify([...wanted].sort())) throw Error('INCOMPLETE_RESULT');
  }
  return true;
}
export function validateShardEvidence(coverage,results,identity) { return verifyResults(results,coverage,identity); }
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const plan=shardPlan(JSON.parse(readFileSync(resolve(root,'.harness/chat-test-shards.json'),'utf8')));
 const command=process.argv[2];
 if(command==='--plan') {if(!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT_REQUIRED'); writeFileSync(process.env.GITHUB_OUTPUT,`count=${plan.count}\nshards=${JSON.stringify(plan.shards)}\n`,{flag:'a'});}
 else if(command==='--verify') console.log(JSON.stringify(discoverCoverage(plan)));
 else if(command==='--run') {
  const shard=Number(process.argv[3]); if(!plan.shards.includes(shard)) throw Error('INVALID_SHARD');
  const directory=process.env.CI_CHAT_ARTIFACT_DIR; if(!directory) throw Error('ARTIFACT_DIR_REQUIRED'); mkdirSync(directory,{recursive:true});
  const coverage=discoverCoverage(plan);
  const {report,status}=invoke(shard,plan.count,false);
  writeFileSync(resolve(directory,'report.json'),JSON.stringify(report));
  writeFileSync(resolve(directory,'result.json'),JSON.stringify({shard,status,report,reportHash:reportHash(report),discoverySha256:coverage.discoverySha256,sha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,stats:report.stats,identities:identities(report)})); process.exitCode=status;
 } else throw Error('INVALID_COMMAND');
}
