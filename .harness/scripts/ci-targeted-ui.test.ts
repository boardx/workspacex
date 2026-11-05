import {expect,it} from 'vitest';
import {inspectUiBoundary,inspectPresentationBoundary,inspectMessageBoundary,planTargeted,verifyTargetedPlan} from './ci-targeted-ui.mjs';
const original='import * as React from "react"; import {cn} from "@/lib/utils"; export function UI({onUseTemplate}:{onUseTemplate:(x:string)=>void}){return <button className={cn("a")} onClick={()=>onUseTemplate("a")}>Hello</button>}';
it('permits local display changes but rejects new runtime edges and public API changes',()=>{
 const copy=original.replace('Hello','Hi'),classes=original.replace('cn("a")','cn("b")');
 expect(copy).not.toBe(original);expect(classes).not.toBe(original);
 expect(inspectUiBoundary(original,copy)).toBe(true);
 expect(inspectUiBoundary(original,classes)).toBe(true);
 expect(inspectUiBoundary(original,original.replace('onUseTemplate("a")','onUseTemplate("b")'))).toBe(false);
 expect(inspectUiBoundary(original.replace('react','other'),original.replace('react','other'))).toBe(false);
 for(const changed of [original.replace('Hello','<iframe/>'),original.replace('Hello','{fetch("/api")}'),original.replace('react','other'),original.replace('onUseTemplate:(x:string)','onUseTemplate:(x:number)'),original.replace('<button','<button onMouseOver={()=>onUseTemplate("x")}'),original.replace('Hello','{eval("x")}'),original.replace('Hello','{localStorage.length}')])expect(inspectUiBoundary(original,changed)).toBe(false);
});
it('fails closed for the actual source after i18n introduced runtime imports and calls',()=>{
 const component=readFileSync(JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8')).sourceFile,'utf8');
 expect(component).toContain('useI18n');expect(component).toContain('localizedTaskTemplates');
 expect(inspectUiBoundary(component,component)).toBe(false);
});
it('allows presentation edits in an already-localized component without relaxing runtime syntax',()=>{
 const source='"use client"; import {useI18n} from "@/lib/i18n/provider"; export function UI({canWrite,onClick}:{canWrite:boolean;onClick:()=>void}){const {t}=useI18n();return <section className="px-2"><h2>Title</h2>{canWrite&&<button onClick={onClick}>{t("common.title")}</button>}</section>}';
 expect(inspectPresentationBoundary(source,source.replace('px-2','px-3').replace('>Title<','>Heading<'))).toBe(true);
 for(const changed of [source.replace('canWrite&&','!canWrite&&'),source.replace('onClick={onClick}','onClick={()=>onClick()}'),source.replace('common.title','common.other'),source.replace('<button','<button href="/admin"'),source+'\nfetch("/api");',source.replace('px-2','bg-[url(https://evil.invalid)]'),'// @jsxImportSource evil\n'+source])expect(inspectPresentationBoundary(source,changed),changed).toBe(false);
 expect(inspectPresentationBoundary('invalid {','invalid {')).toBe(false);
 const business='const value=cn("route");';
 expect(inspectPresentationBoundary(business,business.replace('route','other'))).toBe(false);
});
it('supports explicit rollback and fails closed on missing history',()=>{
 expect(planTargeted({baseSha:'a'.repeat(40),headSha:'b'.repeat(40),enabled:false}).mode).toBe('full');
 expect(planTargeted({baseSha:'bad',headSha:'b'.repeat(40),enabled:true}).mode).toBe('full');
});

import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
it('uses real source history and suite hashes; unknown, missing, renamed and nonregular inputs fall back',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'targeted-ui-history-'));
 const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));
 const actualComponent=readFileSync(p.sourceFile,'utf8');
 const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const put=(file:string,text:string)=>{mkdirSync(dirname(resolve(dir,file)),{recursive:true});writeFileSync(resolve(dir,file),text)};
 const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()};
 try{
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
  put(p.sourceFile,original);for(const file of [...p.unitTests,...p.browserTests])put(`apps/web/${file}`,'export {};');
  const base=commit();put(p.sourceFile,original.replace('Hello','Hi'));const head=commit();
  const inspect=(b:string,h:string)=>planTargeted({baseSha:b,headSha:h,enabled:true,policyInput:p,git});
  const selected=inspect(base,head);expect(selected.mode).toBe('targeted-ui');expect(selected.suites.map(x=>x.id)).toEqual(['web-unit','chat-ui']);
  put('docs/design/i18n-copy/notes.md','Copy review evidence');put('evidence/i18n-copy/source-audit.json','{"sourceOnly":true}');const documented=commit();
  expect(inspect(base,documented).mode).toBe('targeted-ui');
  put(p.sourceFile,original.replace('Hello','Updated'));git(['mv','docs/design/i18n-copy/notes.md','docs/design/i18n-copy/moved.md']);expect(inspect(documented,commit()).mode).toBe('full');
  git(['reset','--hard',documented]);rmSync(resolve(dir,'docs/design/i18n-copy/notes.md'));symlinkSync('missing',resolve(dir,'docs/design/i18n-copy/notes.md'));put(p.sourceFile,original.replace('Hello','Updated'));expect(inspect(documented,commit()).mode).toBe('full');
  git(['reset','--hard',documented]);
  put('apps/api/src/prompt.ts','export const prompt="change"');expect(inspect(base,commit()).mode).toBe('full');
  git(['reset','--hard',head]);
  git(['branch','fixture-ui',head]);git(['checkout','-qb','fixture-api',base]);
  put('apps/api/src/prompt.ts','export const prompt="different"');commit();
  git(['checkout','fixture-ui']);git(['merge','--no-ff','-m','candidate-group','fixture-api']);
  expect(inspect(base,git(['rev-parse','HEAD']).trim()).mode).toBe('full');
  git(['reset','--hard',head]);
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
  git(['reset','--hard',base]);
  expect(planTargeted({baseSha:base,headSha:head,enabled:true,policyInput:{...p,messageFiles:[{...p.messageFiles[0],browserConfig:'unknown.ts'}]},git}).mode).toBe('full');
  const registration=p.messageFiles[0];
  put(registration.file,'export const en={"common.language":"Hello {name}"} as const;');
  for(const file of [...registration.unitTests,...registration.browserTests])put(`apps/web/${file}`,'export {};');
  put(`apps/web/${registration.browserConfig}`,'export default {};');
  const dictionaryBase=commit();put(registration.file,'export const en={"common.language":"Welcome {name}"} as const;');
  const dictionaryHead=commit(),dictionaryPlan=inspect(dictionaryBase,dictionaryHead);
  expect(dictionaryPlan.mode).toBe('targeted-ui');expect(dictionaryPlan.browserConfig.file).toBe(registration.browserConfig);
  expect(verifyTargetedPlan(dictionaryPlan,{baseSha:dictionaryBase,headSha:dictionaryHead,enabled:true,policyInput:p,git})).toBe(true);
  expect(()=>verifyTargetedPlan({...dictionaryPlan,browserConfig:{...dictionaryPlan.browserConfig,sha256:'bad'}},{baseSha:dictionaryBase,headSha:dictionaryHead,enabled:true,policyInput:p,git})).toThrow();
  put('packages/contracts/src/locale.ts','export const locales=[]');expect(inspect(dictionaryBase,commit()).mode).toBe('full');

  git(['reset','--hard',base]);put(p.sourceFile,actualComponent);
  const actualPlan=inspect(base,commit());
  expect(actualPlan.mode).toBe('full');expect(actualPlan.reason).toBe('runtime-or-public-boundary-changed');

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
it('rejects tagged-template execution and non-presentation edits without executing payloads',()=>{
 const component='"use client"; import * as React from "react"; import {cn} from "@/lib/utils"; export function UI({onUseTemplate,materialsCount,skillsCount}:{onUseTemplate:(x:string)=>void;materialsCount:number;skillsCount:number}){return <button className={cn("bg-card px-2")} onClick={()=>onUseTemplate("a")}>材料 {materialsCount}</button>}';
 const payload='cn["constructor"]`return globalThis.fetch("/api/admin/action", {method:"POST"})```;';
 expect(inspectUiBoundary(component,component)).toBe(true);
 for(const changed of [component.replace('return <button',`${payload}\nreturn <button`),component.replace('"use client"','"use server"'),component.replace('材料 {materialsCount}','材料 {skillsCount}'),component.replace('bg-card px-2','bg-[url(https://example.invalid)] px-2')]){
  expect(changed).not.toBe(component);expect(inspectUiBoundary(component,changed)).toBe(false);
 }
});
it('accepts only literal dictionary value edits with stable keys and interpolation',async()=>{
 const {inspectMessageBoundary}=await import('./ci-targeted-ui.mjs');
 const before='export const en = {"ui.name":"Hello {name}"} as const;';
 expect(inspectMessageBoundary(before,before.replace('Hello','Welcome'))).toBe(true);
 expect(inspectMessageBoundary(before,before.replace('Hello','Welcome'),['different.key'])).toBe(false);
 for(const after of [before.replace('{name}','{other}'),before.replace('ui.name','ui.role'),before.replace('"Hello {name}"','fetch("/api")'),before+'\nfetch("/api");',before.replace('Hello','https://evil.invalid/'),before.replace('export const','import {x} from "x"; export const'),before.replace('{"ui.name"','{...x,"ui.name"'),before.replace('export const','// @ts-nocheck\nexport const')])expect(inspectMessageBoundary(before,after)).toBe(false);
});

it('admits actual registered dictionary copy edits, rather than only synthetic policies',async()=>{
 const {inspectMessageBoundary}=await import('./ci-targeted-ui.mjs');
 const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));
 for(const r of p.messageFiles){
  const source=readFileSync(r.file,'utf8');
  const entry=[...source.matchAll(/"([^"\n]+)": "([^"\n]+)"/g)].find(x=>r.messageKeys?r.messageKeys.includes(x[1]):r.messagePrefixes.some(prefix=>x[1].startsWith(prefix)));
  expect(entry,`registered keys must exist in ${r.file}`).toBeDefined();
  const changed=source.replace(entry![0],`"${entry![1]}": "${entry![2]}!"`);
  expect(changed).not.toBe(source);
  expect(inspectMessageBoundary(source,changed,r.messageKeys??{prefixes:r.messagePrefixes}),r.file).toBe(true);
 }
 for(const r of p.presentationFiles){
  const source=readFileSync(r.file,'utf8');
  const changed=source.replace(/className="([^"]+)"/,(_,classes)=>`className="${classes} mt-1"`);
  expect(changed,r.file).not.toBe(source);
  expect(inspectPresentationBoundary(source,changed),r.file).toBe(true);
 }
});

it('combines registered locale-only edits into one plan and unions required suites',()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'targeted-locales-'));
 const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));
 const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const put=(file:string,text:string)=>{mkdirSync(dirname(resolve(dir,file)),{recursive:true});writeFileSync(resolve(dir,file),text);};
 const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim();};
 const first=p.messageFiles[0];
 p.messageFiles=[first,{...first,file:'apps/web/lib/i18n/messages/zh-CN.ts'}];
 try{
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
  for(const registration of p.messageFiles)put(registration.file,'export const messages={"common.language":"Language {name}"};');
  for(const file of [...first.unitTests,...first.browserTests,first.browserConfig])put(`apps/web/${file}`,'export {};');
  for(const registration of p.presentationFiles){
   put(registration.file,'export function UI(){return <p className="p-2">Copy</p>}');
   for(const file of [...registration.unitTests,...registration.browserTests,registration.browserConfig])put(`apps/web/${file}`,'export {};');
  }
  const base=commit();
  for(const registration of p.messageFiles)put(registration.file,'export const messages={"common.language":"Locale {name}"};');
  const head=commit(),context={baseSha:base,headSha:head,enabled:true,policyInput:p,git};
  const plan=planTargeted(context);
  expect(plan.mode).toBe('targeted-ui');
  expect(plan.suites[0].files.map(x=>x.file)).toEqual(first.unitTests);
  expect(plan.suites[1].files.map(x=>x.file)).toEqual(first.browserTests);
  expect(verifyTargetedPlan(plan,context)).toBe(true);
  put('apps/api/src/auth.ts','export const allow=true;');
  expect(planTargeted({...context,headSha:commit()}).mode).toBe('full');
  git(['reset','--hard',head]);put(first.file,'export const messages={"common.language":"Locale {other}"};');
  expect(planTargeted({...context,headSha:commit()}).mode).toBe('full');
  git(['reset','--hard',base]);
  for(const registration of p.presentationFiles)put(registration.file,'export function UI(){return <p className="p-3">Updated copy</p>}');
  const presentationHead=commit(),presentationPlan=planTargeted({...context,headSha:presentationHead});
  expect(presentationPlan.mode).toBe('targeted-ui');
  expect(presentationPlan.suites[0].files.map(x=>x.file)).toEqual([...new Set(p.presentationFiles.flatMap(x=>x.unitTests))]);
  expect(presentationPlan.suites[1].files.map(x=>x.file)).toEqual([...new Set(p.presentationFiles.flatMap(x=>x.browserTests))]);
  put(p.presentationFiles[0].unitTests[0].replace(/^/,'apps/web/'),'export const noTests=true;');
  expect(planTargeted({...context,headSha:commit()}).mode).toBe('full');
  git(['reset','--hard',presentationHead]);put(p.presentationFiles[0].file,'export function UI(){fetch("/api");return <p>Copy</p>}');
  expect(planTargeted({...context,headSha:commit()}).mode).toBe('full');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('supports existing top-level message literals beside unchanged runtime expressions without executing the module',()=>{
 const before='import {FILTERS} from "./filters"; const existing=FILTERS.map(x=>x.label); export const messages={"projectOverview.title":"Title {name}","projectOverview.filter":FILTERS[0].label} as const;';
 expect(inspectMessageBoundary(before,before.replace('Title {name}','Heading {name}'),{prefixes:['projectOverview.']})).toBe(true);
 for(const after of [before.replace('FILTERS.map','FILTERS.filter'),before.replace('FILTERS[0]','FILTERS[1]'),before.replace('{name}','{other}'),before.replace('projectOverview.title','projectOverview.other'),before+'\nfetch("/api");']){
  expect(inspectMessageBoundary(before,after,{prefixes:['projectOverview.']})).toBe(false);
 }
 const nested='export function runtime(){return {"projectOverview.title":"business-control"};}';
 expect(inspectMessageBoundary(nested,nested.replace('business-control','changed'),{prefixes:['projectOverview.']})).toBe(false);
 const computed='export const messages={["projectOverview.title"]:"Title"};';
 expect(inspectMessageBoundary(computed,computed.replace('"Title"','"Changed"'),{prefixes:['projectOverview.']})).toBe(false);
});
it('registers overview and public-share copy against their existing page tests',()=>{
 const p=JSON.parse(readFileSync('.harness/config/ci-targeted-ui.json','utf8'));
 for(const [file,browser,unit] of [
  ['project-overview','e2e/i18n-project-general-overview.spec.ts','tests/ui/project-general-overview-i18n.test.tsx'],
  ['public-design-share','e2e/i18n-public-design-share.spec.ts','tests/ui/public-design-share-i18n.test.tsx'],
 ]){
  const registration=p.messageFiles.find((x:any)=>x.file===`apps/web/lib/i18n/namespaces/${file}.ts`);
  expect(registration).toBeDefined();expect(registration.browserTests).toContain(browser);expect(registration.unitTests).toContain(unit);
 }
});
