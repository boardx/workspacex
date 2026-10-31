import {expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {runUnit,runIdentity} from './ci-targeted-runner.mjs';
const context={sha:'a'.repeat(40),run:'12',attempt:'1'};
it('requires real current run identity',()=>{expect(()=>runIdentity({})).toThrow();expect(()=>runIdentity({GITHUB_SHA:context.sha,GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'1'})).toThrow();});
it('executes selected Vitest files rather than relying on a declared plan',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'targeted-unit-'));
 try{
  const vitest=resolve('node_modules/vitest/dist/index.js');
  writeFileSync(resolve(dir,'vitest.config.mjs'),"export default {test:{include:['*.test.ts'],maxWorkers:1,minWorkers:1}}");
  writeFileSync(resolve(dir,'a.test.ts'),`import {test,expect,describe} from ${JSON.stringify(vitest)};describe('nested group',()=>test('actual selected assertion',()=>expect(1).toBe(1))); `);
  writeFileSync(resolve(dir,'unselected.test.ts'),`import {test} from ${JSON.stringify(vitest)};test('must not execute',()=>{throw Error('unselected')});`);
  const plan={schemaVersion:1,headSha:context.sha,mode:'targeted-ui',planDigest:'c'.repeat(64),policyDigest:'d'.repeat(64),suites:[{id:'web-unit',files:[{file:'a.test.ts',sha256:'e'.repeat(64)}]}]};
  const output=resolve(dir,'out');const result=runUnit(plan,output,dir,context);
  expect(result.report.numPassedTests).toBe(1);expect(JSON.parse(readFileSync(resolve(output,'evidence.json'),'utf8')).sha).toBe(context.sha);
  writeFileSync(resolve(dir,'a.test.ts'),`import {test} from ${JSON.stringify(vitest)};test('selected failure',()=>{throw Error('real failure')});`);
  expect(()=>runUnit(plan,output,dir,context)).toThrow('TARGETED_UNIT_FAILED');
  expect(existsSync(resolve(output,'evidence.json'))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);

import {verifyDirectory} from './ci-targeted-runner.mjs';
it('does not retain an old success receipt when current evidence is missing',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'targeted-stale-receipt-'));try{writeFileSync(resolve(dir,'receipt.json'),'old success');expect(()=>verifyDirectory(dir,{GITHUB_SHA:context.sha,GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1'})).toThrow();expect(existsSync(resolve(dir,'receipt.json'))).toBe(false);}finally{rmSync(dir,{recursive:true,force:true});}
});
