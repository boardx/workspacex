import {expect,it} from 'vitest';
import {inspectUiBoundary,planTargeted,verifyTargetedPlan} from './ci-targeted-ui.mjs';
const original='import * as React from "react"; import {cn} from "@/lib/utils"; export function UI({onUseTemplate}:{onUseTemplate:(x:string)=>void}){return <button className={cn("a")} onClick={()=>onUseTemplate("a")}>Hello</button>}';
it('permits local display changes but rejects new runtime edges and public API changes',()=>{
 const actual=readFileSync('.harness/config/ci-targeted-ui.json','utf8');
 const component=readFileSync(JSON.parse(actual).sourceFile,'utf8');
 expect(inspectUiBoundary(component,component.replace('今天，想完成什么？','今天，你想完成什么？'))).toBe(true);
 expect(inspectUiBoundary(original,original.replace('Hello','Hi'))).toBe(true);
 expect(inspectUiBoundary(original.replace('react','other'),original.replace('react','other'))).toBe(false);
 for(const changed of [original.replace('Hello','<iframe/>'),original.replace('Hello','{fetch("/api")}'),original.replace('react','other'),original.replace('onUseTemplate:(x:string)','onUseTemplate:(x:number)'),original.replace('<button','<button onMouseOver={()=>onUseTemplate("x")}'),original.replace('Hello','{eval("x")}'),original.replace('Hello','{localStorage.length}')])expect(inspectUiBoundary(original,changed)).toBe(false);
});
it('keeps rollout disabled and fails closed on missing history',()=>{
 expect(planTargeted({baseSha:'a'.repeat(40),headSha:'b'.repeat(40)}).mode).toBe('full');
 expect(planTargeted({baseSha:'bad',headSha:'b'.repeat(40),enabled:true}).mode).toBe('full');
});

import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
it('uses real source history and suite hashes; unknown, missing, renamed and nonregular inputs fall back',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'targeted-ui-history-'));
 const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));
 const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const put=(file:string,text:string)=>{mkdirSync(dirname(resolve(dir,file)),{recursive:true});writeFileSync(resolve(dir,file),text)};
 const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()};
 try{
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
  put(p.sourceFile,original);for(const file of [...p.unitTests,...p.browserTests])put(`apps/web/${file}`,'export {};');
  const base=commit();put(p.sourceFile,original.replace('Hello','Hi'));const head=commit();
  const inspect=(b:string,h:string)=>planTargeted({baseSha:b,headSha:h,enabled:true,policyInput:p,git});
  const selected=inspect(base,head);expect(selected.mode).toBe('targeted-ui');expect(selected.suites.map(x=>x.id)).toEqual(['web-unit','chat-ui']);
  expect(selected.suites[0].files[0].sha256).toMatch(/^[a-f0-9]{64}$/);expect(selected.planDigest).toMatch(/^[a-f0-9]{64}$/);
  const context={baseSha:base,headSha:head,enabled:true,policyInput:p,git};
  expect(verifyTargetedPlan(selected,context)).toBe(true);
  const preflight=planTargeted({...context,preflight:true});expect(preflight.mode).toBe('candidate-ui');expect(()=>verifyTargetedPlan(preflight,context)).toThrow();
  for(const patch of [{headSha:base},{planDigest:'bad'},{suites:[]},{policyDigest:'bad'},{baseSha:head}])expect(()=>verifyTargetedPlan({...selected,...patch},context)).toThrow();
  expect(()=>verifyTargetedPlan(selected,{...context,enabled:false})).toThrow();
  put('pnpm-lock.yaml','changed');expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);put(p.sourceFile,original.replace('react','other'));expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);git(['mv',p.sourceFile,p.sourceFile+'.moved']);expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);rmSync(resolve(dir,p.sourceFile));symlinkSync('missing',resolve(dir,p.sourceFile));expect(inspect(base,commit()).mode).toBe('full');
  expect(inspect('f'.repeat(40),head).mode).toBe('full');
  expect(inspect(head,base).mode).toBe('full');
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
it('keeps disabled/full preflight dependency-free and never publishes an invalid source identity',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'ui-preflight-cli-'));
 try{
  const script=resolve(dir,'.harness/scripts/ci-targeted-ui.mjs');mkdirSync(dirname(script),{recursive:true});
  writeFileSync(script,readFileSync('.harness/scripts/ci-targeted-ui.mjs'));
  mkdirSync(resolve(dir,'.harness/config'),{recursive:true});
  const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));p.enabled=false;
  writeFileSync(resolve(dir,'.harness/config/ci-targeted-ui.json'),JSON.stringify(p));
  const output=resolve(dir,'output'),env={...process.env,GITHUB_SHA:'a'.repeat(40),GITHUB_OUTPUT:output};
  expect(JSON.parse(execFileSync(process.execPath,[script,'--preflight'],{env,encoding:'utf8'})).candidate).toBe(false);
  expect(readFileSync(output,'utf8')).toContain('candidate=false');
  const planFile=resolve(dir,'plan.json');execFileSync(process.execPath,[script,planFile],{env});
  expect(JSON.parse(readFileSync(planFile,'utf8')).mode).toBe('full');
  expect(()=>execFileSync(process.execPath,[script],{env:{...env,GITHUB_SHA:'0'.repeat(40)},stdio:'pipe'})).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
