/** Narrow opt-in UI selection. Unknown changes always keep full regression. */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..');
export const policy=JSON.parse(readFileSync(new URL('../config/ci-targeted-ui.json',import.meta.url),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const forbidden=new Set(['window','document','globalThis','global','fetch','process','require','eval','Function','XMLHttpRequest','WebSocket','navigator','location']);
const allowedCalls=new Set(['cn','onUseTemplate','TASK_WORKBENCH_TEMPLATES.map']);
function structure(text,allowedImports){
 const source=ts.createSourceFile('ui.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 if(source.parseDiagnostics.length)return null;
 const imports=[],api=[],tags=new Set(),attrs=new Set(),names=new Set();let safe=true;
 for(const node of source.statements){
  if(ts.isImportDeclaration(node)){
   const module=node.moduleSpecifier.text,clause=node.importClause?.getText(source).replace(/\s/g,'');
   if(typeof module!=='string'||allowedImports[module]?.replace(/\s/g,'')!==clause)safe=false;
   imports.push([module,clause]);
  }
  if(ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
   if(ts.isFunctionDeclaration(node))api.push(['function',node.name?.text,node.typeParameters?.map(x=>x.getText(source)),node.parameters.map(x=>x.getText(source)),node.type?.getText(source)]);
   else if(ts.isVariableStatement(node))api.push(['variable',node.declarationList.declarations.map(x=>[x.name.getText(source),x.type?.getText(source)])]);
   else if(ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node))api.push(node.getText(source));
   else safe=false;
  }
 }
 function visit(node){
  if(ts.isIdentifier(node)){names.add(node.text);if(forbidden.has(node.text))safe=false;}
  if(ts.isCallExpression(node)&&!allowedCalls.has(node.expression.getText(source)))safe=false;
  if(ts.isNewExpression(node)||ts.isJsxSpreadAttribute(node))safe=false;
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))tags.add(node.tagName.getText(source));
  if(ts.isJsxAttribute(node))attrs.add(node.name.getText(source));
  ts.forEachChild(node,visit);
 }
 visit(source);return {safe,imports,api,tags,attrs,names};
}
export function inspectUiBoundary(before,after,allowedImports=policy.imports){
 const a=structure(before,allowedImports),b=structure(after,allowedImports);
 return !!a?.safe&&!!b?.safe&&a.imports.length===Object.keys(allowedImports).length&&JSON.stringify(a.imports)===JSON.stringify(b.imports)&&JSON.stringify(a.api)===JSON.stringify(b.api)&&[...b.tags].every(x=>a.tags.has(x))&&[...b.attrs].every(x=>a.attrs.has(x))&&[...b.names].every(x=>a.names.has(x));
}
function checkPolicy(p){
 if(!p.imports||typeof p.imports!=='object'||Object.values(p.imports).some(x=>typeof x!=='string')||p.schemaVersion!==1||typeof p.enabled!=='boolean'||typeof p.sourceFile!=='string'||!p.sourceFile.startsWith('apps/web/components/')||!p.sourceFile.endsWith('.tsx'))throw Error('UNKNOWN_POLICY');
 const paths=[p.sourceFile,...(p.unitTests??[]),...(p.browserTests??[])];
 if(!p.unitTests?.length||!p.browserTests?.length||new Set(paths).size!==paths.length||paths.some(x=>typeof x!=='string'||x.startsWith('/')||x.split('/').includes('..'))||p.unitTests.some(x=>!/^tests\/.+\.test\.tsx?$/.test(x))||p.browserTests.some(x=>!/^e2e\/.+\.spec\.ts$/.test(x)))throw Error('UNKNOWN_POLICY');
}
export function planTargeted({baseSha,headSha,enabled=policy.enabled,policyInput=policy,git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})}){
 const common={schemaVersion:1,baseSha:baseSha??null,headSha:headSha??null,policyDigest:hash(JSON.stringify(policyInput))};
 const finish=(mode,reason,suites)=>{const plan={...common,mode,reason,suites};return {...plan,planDigest:hash(JSON.stringify(plan))}};
 const full=reason=>finish('full',reason,[{id:'full-regression'}]);
 try{
  checkPolicy(policyInput);
  if(!enabled)return full('rollout-disabled');
  if(![baseSha,headSha].every(x=>/^[a-f0-9]{40}$/.test(x??'')&&!/^0+$/.test(x)))return full('explicit-history-required');
  for(const sha of [baseSha,headSha])git(['cat-file','-e',`${sha}^{commit}`]);
  git(['merge-base','--is-ancestor',baseSha,headSha]);
  const paths=git(['diff','--no-renames','--name-status','-z',baseSha,headSha]).split('\0').filter(Boolean);
  if(JSON.stringify(paths)!==JSON.stringify(['M',policyInput.sourceFile]))return full('outside-reviewed-input-boundary');
  const read=(sha,path)=>{
   const tree=git(['ls-tree','-z',sha,'--',path]);
   if(!tree.startsWith('100644 blob ')||!tree.endsWith(`\t${path}\0`))throw Error('NON_REGULAR_INPUT');
   return git(['show',`${sha}:${path}`]);
  };
  if(!inspectUiBoundary(read(baseSha,policyInput.sourceFile),read(headSha,policyInput.sourceFile),policyInput.imports))return full('runtime-or-public-boundary-changed');
  const suite=(id,files)=>({id,files:files.map(file=>({file,sha256:hash(read(headSha,`apps/web/${file}`))}))});
  return finish('targeted-ui','reviewed-local-ui-change',[suite('web-unit',policyInput.unitTests),suite('chat-ui',policyInput.browserTests)]);
 }catch{return full('unavailable-or-unrecognized-input');}
}
export function verifyTargetedPlan(plan,options){
 if(!options||!options.baseSha||!options.headSha||plan?.mode!=='targeted-ui')throw Error('TARGETED_PLAN_REQUIRED');
 const expected=planTargeted(options);
 if(expected.mode!=='targeted-ui'||JSON.stringify(plan)!==JSON.stringify(expected))throw Error('TARGETED_PLAN_MISMATCH');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??''))throw Error('SOURCE_SHA_REQUIRED');
 console.log(JSON.stringify(planTargeted({baseSha:process.env.CI_SCOPE_BASE_SHA,headSha:process.env.GITHUB_SHA}),null,2));
}
