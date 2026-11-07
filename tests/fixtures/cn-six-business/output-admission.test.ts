import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {admitOutputs} from './output-admission';
const require=createRequire(import.meta.url);
function fixture(){const root=mkdtempSync(resolve('tests/.six-output-'));return {root,report:join(root,'report.json'),output:join(root,'results'),policy:{prefix:root+'/',owners:[0,process.getuid!()]}};}
test('real Playwright coordinator and worker both load output admission without browser',()=>{
 const f=fixture();try{
  const source=resolve('tests/fixtures/cn-six-business/output-admission.ts');
  const testPackage=require.resolve('@playwright/test',{paths:[resolve('apps/web')]});
  const config=join(f.root,'playwright.config.ts');
  writeFileSync(config,`import {defineConfig} from ${JSON.stringify(testPackage)};import {admitOutputs} from ${JSON.stringify(source)};admitOutputs(${JSON.stringify(f.report)},${JSON.stringify(f.output)},process.env.TEST_WORKER_INDEX,${JSON.stringify(f.policy)});export default defineConfig({testDir:${JSON.stringify(f.root)},testMatch:'probe.spec.ts',outputDir:${JSON.stringify(f.output)},workers:1,retries:0,reporter:[['json',{outputFile:${JSON.stringify(f.report)}}]]});`);
  writeFileSync(join(f.root,'probe.spec.ts'),`import {test,expect} from ${JSON.stringify(testPackage)};test('actual worker reload',()=>{expect(process.env.TEST_WORKER_INDEX).toMatch(/^[0-9]+$/);});`);
  const cli=join(dirname(require.resolve('@playwright/test/package.json',{paths:[resolve('apps/web')]})),'cli.js');
  const env={...process.env};delete env.TEST_WORKER_INDEX;delete env.TEST_PARALLEL_INDEX;
  const run=spawnSync(process.execPath,[cli,'test','--config',config],{env,encoding:'utf8',timeout:30000,maxBuffer:65536});
  assert.equal(run.status,0,run.stdout+run.stderr);
  const report=JSON.parse(readFileSync(f.report,'utf8'));assert.equal(report.stats.expected,1);assert.equal(report.stats.unexpected,0);assert.equal(report.stats.skipped,0);
  const stale=spawnSync(process.execPath,[cli,'test','--config',config],{env,encoding:'utf8',timeout:30000,maxBuffer:65536});
  assert.notEqual(stale.status,0);assert.match(stale.stdout+stale.stderr,/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('stale directory and dangling output symlink rejected at first admission',()=>{
 for(const link of [false,true]){const f=fixture();try{if(link)symlinkSync(join(f.root,'missing'),f.output);else mkdirSync(f.output);assert.throws(()=>admitOutputs(f.report,f.output,undefined,f.policy),/NEW_PRIVATE_OUTPUT_REQUIRED/);}finally{rmSync(f.root,{recursive:true,force:true});}}
});
test('worker requires exact prior admission and rejects symlink or changed path',()=>{
 const f=fixture();try{
  assert.throws(()=>admitOutputs(f.report,f.output,'0',f.policy));
  admitOutputs(f.report,f.output,undefined,f.policy);
  symlinkSync(join(f.root,'missing'),f.output);assert.throws(()=>admitOutputs(f.report,f.output,'0',f.policy),/PRIVATE_OUTPUT_CHANGED/);rmSync(f.output);
  assert.throws(()=>admitOutputs(f.report,join(f.root,'other'),'0',f.policy),/OUTPUT_ADMISSION_CHANGED/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
