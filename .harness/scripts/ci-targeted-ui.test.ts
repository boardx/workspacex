import {expect,it} from 'vitest';
import {inspectUiBoundary,planTargeted} from './ci-targeted-ui.mjs';
const original='import * as React from "react"; import {cn} from "@/lib/utils"; export function UI({onUseTemplate}:{onUseTemplate:(x:string)=>void}){return <button className={cn("a")} onClick={()=>onUseTemplate("a")}>Hello</button>}';
it('permits local display changes but rejects new runtime edges and public API changes',()=>{
 expect(inspectUiBoundary(original,original.replace('Hello','Hi'))).toBe(true);
 expect(inspectUiBoundary(original.replace('react','other'),original.replace('react','other'))).toBe(false);
 for(const changed of [original.replace('Hello','<iframe/>'),original.replace('Hello','{fetch("/api")}'),original.replace('react','other'),original.replace('onUseTemplate:(x:string)','onUseTemplate:(x:number)'),original.replace('<button','<button onMouseOver={()=>onUseTemplate("x")}'),original.replace('Hello','{eval("x")}')])expect(inspectUiBoundary(original,changed)).toBe(false);
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
  put('pnpm-lock.yaml','changed');expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);put(p.sourceFile,original.replace('react','other'));expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);git(['mv',p.sourceFile,p.sourceFile+'.moved']);expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',base]);rmSync(resolve(dir,p.sourceFile));symlinkSync('missing',resolve(dir,p.sourceFile));expect(inspect(base,commit()).mode).toBe('full');
  expect(inspect('f'.repeat(40),head).mode).toBe('full');
  expect(inspect(head,base).mode).toBe('full');
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
