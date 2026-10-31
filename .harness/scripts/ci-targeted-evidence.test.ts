import {expect,it} from 'vitest';
import {unitEvidence,verifyUnitEvidence} from './ci-targeted-evidence.mjs';
const context={sha:'a'.repeat(40),run:'12',attempt:'1'};
const plan={schemaVersion:1,headSha:context.sha,mode:'targeted-ui',planDigest:'c'.repeat(64),policyDigest:'d'.repeat(64),suites:[{id:'web-unit',files:[{file:'tests/ui/a.test.tsx',sha256:'test-hash'}]}]};
const report={success:true,numPassedTests:1,testResults:[{name:'/web/tests/ui/a.test.tsx',status:'passed',assertionResults:[{status:'passed'}]}]};
it('binds actual selected unit reports to source, run, attempt and plan',()=>{
 const evidence=unitEvidence(plan,report,'/web',context);
 expect(verifyUnitEvidence(plan,evidence,context)).toBe(true);
 for(const patch of [{sha:'b'.repeat(40)},{attempt:'2'},{run:'13'},{planDigest:'old'},{policyDigest:'old'},{report:{...report,success:false}}])expect(()=>verifyUnitEvidence(plan,{...evidence,...patch},context)).toThrow();
 expect(()=>unitEvidence(plan,{...report,testResults:[]},'/web',context)).toThrow();
});

import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {invoke} from './ci-chat-shards.mjs';
import {browserEvidence,verifyBrowserEvidence,verifyEvidence} from './ci-targeted-evidence.mjs';
it('executes a real selected browser fixture and rejects missing, replayed and changed suite evidence',()=>{
 const cwd=resolve('apps/web'),dir=mkdtempSync(resolve(cwd,'.targeted-browser-'));
 try{
  writeFileSync(resolve(dir,'playwright.config.ts'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'.',workers:1,projects:[{name:'selected'}]});`);
  for(const file of ['a','b'])writeFileSync(resolve(dir,file+'.spec.ts'),`import {test,expect} from '@playwright/test';test('actual ${file}',()=>expect(1).toBe(1));`);
  const file=relative(cwd,resolve(dir,'a.spec.ts'));
  const options={cwd,config:resolve(dir,'playwright.config.ts'),files:[file]};
  const p={...plan,suites:[...plan.suites,{id:'chat-ui',files:[{file,sha256:'e'.repeat(64)}]}]};
  const discovery=invoke(null,1,true,options).report,run=invoke(null,1,false,options);
  expect(run.report.stats.expected).toBe(1);
  const browser=browserEvidence(p,discovery,run.report,cwd,context,run.status);
  const unit=unitEvidence(p,report,'/web',context);
  expect(verifyEvidence(p,[unit,browser],context)).toBe(true);
  for(const entries of [[unit],[browser,browser]])expect(()=>verifyEvidence(p,entries,context)).toThrow();
  for(const patch of [{attempt:'2'},{sha:'b'.repeat(40)},{reportHash:'bad'},{schemaVersion:2},{status:1},{coverage:{...browser.coverage,full:[]}}])expect(()=>verifyBrowserEvidence(p,{...browser,...patch},context)).toThrow();
  expect(()=>invoke(null,1,true,{...options,files:['--project=other']})).toThrow('INVALID_FILE_SELECTION');
  expect(()=>browserEvidence(p,discovery,{...run.report,stats:{...run.report.stats,expected:0}},cwd,context,0)).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
